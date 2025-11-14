const express = require('express');
const router = express.Router();
const Goal = require('../models/Goal');
const Activity = require('../models/Activity');
const { isAuthenticated } = require('../middleware/auth');

// Create a new goal
router.post('/create', isAuthenticated, async (req, res) => {
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
        res.status(500).json({ message: 'Error creating goal', error: error.message });
    }
});

// Get all goals for the logged-in user
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const goals = await Goal.find({ userId: req.user.id });
        res.json(goals);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching goals', error: error.message });
    }
});

// Get progress for a specific goal
router.get('/:goalId/progress', isAuthenticated, async (req, res) => {
    try {
        const { goalId } = req.params;
        const goal = await Goal.findById(goalId);

        if (!goal) {
            return res.status(404).json({ message: 'Goal not found' });
        }

        const activities = await Activity.find({
            userId: req.user.id,
            language: goal.techStack,
            timestamp: { $lte: goal.deadline }
        });

        const totalMinutes = activities.reduce((sum, activity) => sum + activity.duration, 0);
        const progress = (totalMinutes / 60) / goal.targetHours * 100;

        res.json({
            goal,
            currentHours: totalMinutes / 60,
            progress: Math.min(progress, 100) // Cap progress at 100%
        });

    } catch (error) {
        res.status(500).json({ message: 'Error fetching goal progress', error: error.message });
    }
});

module.exports = router;
