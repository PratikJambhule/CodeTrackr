const express = require('express');
const router = express.Router();
const Goal = require('../models/Goal');
const Activity = require('../models/Activity');
const { isAuthenticated } = require('../middleware/auth');

// Create a new goal
router.post('/create', isAuthenticated, async (req, res, next) => {
    try {
        const { title, description, targetHours, techStack, deadline } = req.body;
        const userId = req.user.id;

        const newGoal = new Goal({
            userId,
            title,
            description,
            targetHours,
            techStack,
            deadline
        });

        await newGoal.save();
        res.status(201).json(newGoal);
    } catch (error) {
        return next(error);
    }
});

// Get all goals for the logged-in user
router.get('/', isAuthenticated, async (req, res, next) => {
    try {
        const goals = await Goal.find({ userId: req.user.id });
        res.json(goals);
    } catch (error) {
        return next(error);
    }
});

/**
 * Match activity belonging to a goal.
 *
 * FIXED 2026-09-10. The old query was `{ language: goal.techStack, timestamp:
 * { $lte: goal.deadline } }` — an exact, case-sensitive match on a free-text
 * field with **no lower bound**, so a goal tagged "React" matched nothing at
 * all (activity is logged as `typescript`/`javascript`) while a goal tagged
 * "javascript" matched every hour ever logged, back to the first ever flush.
 *
 * Now: case-insensitive match on language *or* project name, bounded to the
 * goal's own lifetime (creation → completion, or → deadline while open).
 */
function goalActivityQuery(goal, userIdStr) {
    const stack = String(goal.techStack || '').trim();
    if (!stack) return null;

    const from = goal.createdAt ? new Date(goal.createdAt) : null;
    const to = new Date(goal.completedAt || goal.deadline || Date.now());
    if (!from || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;

    const stackRe = new RegExp(`^${stack.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    return {
        userId: userIdStr,
        timestamp: { $gte: from, $lte: to },
        $or: [{ language: stackRe }, { projectName: stackRe }],
    };
}

// Get progress for a specific goal
router.get('/:goalId/progress', isAuthenticated, async (req, res, next) => {
    try {
        const { goalId } = req.params;
        // Scope by owner: findById leaked another user's goal title,
        // description, targetHours and deadline (H-11).
        const goal = await Goal.findOne({ _id: goalId, userId: req.user.id });

        if (!goal) {
            return res.status(404).json({ message: 'Goal not found' });
        }

        const query = goalActivityQuery(goal, String(req.user._id));
        let totalSeconds = 0;
        if (query) {
            const [row] = await Activity.aggregate([
                { $match: query },
                { $group: { _id: null, seconds: { $sum: '$duration' } } },
            ]);
            totalSeconds = row?.seconds || 0;
        }

        // Activity.duration is stored in SECONDS.
        const currentHours = totalSeconds / 3600;
        const progress = goal.targetHours > 0 ? (currentHours / goal.targetHours) * 100 : 0;

        res.json({
            goal,
            currentHours: parseFloat(currentHours.toFixed(2)),
            progress: Math.min(progress, 100), // Cap progress at 100%
            matched: Boolean(query),
        });

    } catch (error) {
        return next(error);
    }
});

/**
 * Mark a goal complete.
 *
 * NEW 2026-09-10. Nothing in the application ever set `status: 'completed'` —
 * only `scripts/seed-demo-insights.js` did. That made `estimationCalibration`
 * permanently unreachable in production: it needs completed goals and none
 * could exist. This is the missing state transition.
 */
router.patch('/:goalId/complete', isAuthenticated, async (req, res, next) => {
    try {
        const goal = await Goal.findOne({ _id: req.params.goalId, userId: req.user.id });
        if (!goal) return res.status(404).json({ message: 'Goal not found' });
        if (goal.status === 'completed') {
            return res.status(200).json({ success: true, goal, alreadyCompleted: true });
        }

        goal.status = 'completed';
        goal.completedAt = new Date();
        await goal.save();

        res.json({ success: true, goal });
    } catch (error) {
        return next(error);
    }
});

/** Undo a completion (the button is one click; let it be reversible). */
router.patch('/:goalId/reopen', isAuthenticated, async (req, res, next) => {
    try {
        const goal = await Goal.findOne({ _id: req.params.goalId, userId: req.user.id });
        if (!goal) return res.status(404).json({ message: 'Goal not found' });

        goal.status = 'in-progress';
        goal.completedAt = null;
        await goal.save();

        res.json({ success: true, goal });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
module.exports.goalActivityQuery = goalActivityQuery;
