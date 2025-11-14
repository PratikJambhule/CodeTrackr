const express = require('express');
const router = express.Router();
const Team = require('../models/Team');
const User = require('../models/user');
const mongoose = require('mongoose');
const { isAuthenticated } = require('../middleware/auth');

// Create a new team
router.post('/create', isAuthenticated, async (req, res) => {
    try {
        const { name, description } = req.body;
        const createdBy = req.user.id;

        const newTeam = new Team({
            name,
            description,
            createdBy,
            members: [createdBy] // Creator is a member by default
        });

        await newTeam.save();
        res.status(201).json(newTeam);
    } catch (error) {
        res.status(500).json({ message: 'Error creating team', error: error.message });
    }
});

// Get all teams for the logged-in user
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const teams = await Team.find({ members: req.user.id }).populate('members', 'name profilePictureUrl');
        res.json(teams);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching teams', error: error.message });
    }
});

// Get a single team's details
router.get('/:teamId', isAuthenticated, async (req, res) => {
    try {
        const { teamId } = req.params;
        const team = await Team.findById(teamId).populate('members', 'name email profilePictureUrl');
        if (!team) {
            return res.status(404).json({ message: 'Team not found' });
        }
        res.json(team);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching team details', error: error.message });
    }
});

// Add a member to a team
router.post('/:teamId/members', isAuthenticated, async (req, res) => {
    try {
        const { teamId } = req.params;
        const { email } = req.body;

        const team = await Team.findById(teamId);
        if (!team) {
            return res.status(404).json({ message: 'Team not found' });
        }

        // Check if the current user is the creator of the team (admin)
        if (team.createdBy.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Only the team admin can add members' });
        }

        const userToAdd = await User.findOne({ email });
        if (!userToAdd) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (team.members.includes(userToAdd.id)) {
            return res.status(400).json({ message: 'User is already in the team' });
        }

        team.members.push(userToAdd.id);
        await team.save();
        res.json(team);

    } catch (error) {
        res.status(500).json({ message: 'Error adding member', error: error.message });
    }
});

module.exports = router;
