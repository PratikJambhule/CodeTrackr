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

        const activities = await Activity.find({
            userId: req.user.id,
            language: goal.techStack,
            timestamp: { $lte: goal.deadline }
        });

        // Activity.duration is stored in SECONDS.
        const totalSeconds = activities.reduce((sum, activity) => sum + (activity.duration || 0), 0);
        const currentHours = totalSeconds / 3600;
        const progress = goal.targetHours > 0 ? (currentHours / goal.targetHours) * 100 : 0;

        res.json({
            goal,
            currentHours: parseFloat(currentHours.toFixed(2)),
            progress: Math.min(progress, 100) // Cap progress at 100%
        });

    } catch (error) {
        return next(error);
    }
});

module.exports = router;
