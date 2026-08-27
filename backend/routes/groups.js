const express = require('express');
const router = express.Router();
const Group = require('../models/Group');
const GroupMember = require('../models/GroupMember');
const User = require('../models/user');
const Activity = require('../models/Activity');
const { isAuthenticated } = require('../middleware/auth');

// Create a new group
router.post('/create', isAuthenticated, async (req, res) => {
    try {
        const { groupName, groupDescription, visibility, password } = req.body;

        // Validation
        if (!groupName || !groupDescription || !visibility) {
            return res.status(400).json({ message: 'Name, description, and visibility are required' });
        }

        if (visibility === 'private' && !password) {
            return res.status(400).json({ message: 'Password is required for private groups' });
        }

        const group = new Group({
            name: groupName,
            description: groupDescription,
            visibility,
            password: visibility === 'private' ? password : null,
            createdBy: req.user._id
        });

        await group.save();

        // Automatically add creator as member
        const groupMember = new GroupMember({
            groupId: group._id,
            userId: req.user._id
        });
        await groupMember.save();

        res.status(201).json({ 
            success: true, 
            message: 'Group created successfully', 
            group 
        });
    } catch (error) {
        console.error('Error creating group:', error);
        res.status(400).json({ message: 'Error creating group', error: error.message });
    }
});

// Get all groups where the logged-in user is a member (My Groups)
router.get('/my-groups', isAuthenticated, async (req, res) => {
    try {
        const memberships = await GroupMember.find({ userId: req.user._id })
            .populate({
                path: 'groupId',
                populate: { path: 'createdBy', select: 'name email' }
            });

        const groups = memberships
            .map(m => m.groupId)
            .filter(g => g !== null); // Filter out null groups (if deleted)

        res.json({ success: true, groups });
    } catch (error) {
        console.error('Error fetching my groups:', error);
        res.status(500).json({ message: 'Error fetching your groups', error: error.message });
    }
});

// Get all groups the user is NOT a member of (Discover Groups)
router.get('/discover', isAuthenticated, async (req, res) => {
    try {
        const { search } = req.query;

        // Get groups user is already a member of
        const memberships = await GroupMember.find({ userId: req.user._id }).select('groupId');
        const joinedGroupIds = memberships.map(m => m.groupId);

        // Find groups user is not a member of
        let query = { _id: { $nin: joinedGroupIds } };
        
        if (search) {
            query.name = { $regex: search, $options: 'i' };
        }

        const groups = await Group.find(query)
            .populate('createdBy', 'name email')
            .sort({ createdAt: -1 });

        res.json({ success: true, groups });
    } catch (error) {
        console.error('Error fetching discover groups:', error);
        res.status(500).json({ message: 'Error fetching groups', error: error.message });
    }
});

// Get group details with members and leaderboard
router.get('/:groupId/details', isAuthenticated, async (req, res) => {
    try {
        const { groupId } = req.params;

        // Check if user is a member
        const membership = await GroupMember.findOne({ 
            groupId, 
            userId: req.user._id 
        });

        if (!membership) {
            return res.status(403).json({ message: 'You must be a member to view group details' });
        }

        // Get group info
        const group = await Group.findById(groupId).populate('createdBy', 'name email');

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // Get all members
        const members = await GroupMember.find({ groupId })
            .populate('userId', 'name email')
            .sort({ joinedAt: 1 });

        const membersList = members.map(m => ({
            id: m.userId._id,
            name: m.userId.name,
            email: m.userId.email,
            joinedAt: m.joinedAt
        }));

        // Get member IDs for leaderboard
        const memberIds = members.map(m => m.userId._id.toString());

        // Calculate leaderboard based on coding hours
        const activityData = await Activity.aggregate([
            { $match: { userId: { $in: memberIds } } },
            {
                $group: {
                    _id: '$userId',
                    totalHours: { $sum: { $divide: ['$duration', 3600] } },
                    totalLinesAdded: { $sum: '$linesAdded' }
                }
            }
        ]);

        // Create a map of userId to activity stats
        const activityMap = {};
        activityData.forEach(entry => {
            activityMap[entry._id.toString()] = {
                totalHours: entry.totalHours,
                totalLinesAdded: entry.totalLinesAdded
            };
        });

        // Build leaderboard with ALL members (including those with no activity)
        const leaderboardWithUsers = await Promise.all(
            members.map(async (member) => {
                const userId = member.userId._id.toString();
                const stats = activityMap[userId] || { totalHours: 0, totalLinesAdded: 0 };
                
                return {
                    userId: userId,
                    userName: member.userId.name,
                    email: member.userId.email,
                    codingHours: parseFloat(stats.totalHours.toFixed(2)),
                    totalLinesAdded: stats.totalLinesAdded
                };
            })
        );

        // Sort by hours and add rank
        leaderboardWithUsers.sort((a, b) => b.codingHours - a.codingHours);
        leaderboardWithUsers.forEach((entry, index) => {
            entry.rank = index + 1;
        });

        res.json({
            success: true,
            group: {
                _id: group._id,
                name: group.name,
                description: group.description,
                visibility: group.visibility,
                createdBy: group.createdBy,
                createdAt: group.createdAt
            },
            members: membersList,
            leaderboard: leaderboardWithUsers
        });
    } catch (error) {
        console.error('Error fetching group details:', error);
        res.status(500).json({ message: 'Error fetching group details', error: error.message });
    }
});

// Join a group
router.post('/:groupId/join', isAuthenticated, async (req, res) => {
    try {
        const { groupId } = req.params;
        const { password } = req.body;

        const group = await Group.findById(groupId);
        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // Check if already a member
        const existingMembership = await GroupMember.findOne({ 
            groupId, 
            userId: req.user._id 
        });

        if (existingMembership) {
            return res.status(400).json({ message: 'You are already a member of this group' });
        }

        // Check password for private groups
        if (group.visibility === 'private') {
            if (!password) {
                return res.status(400).json({ message: 'Password is required for private groups' });
            }
            if (password !== group.password) {
                return res.status(401).json({ message: 'Incorrect password' });
            }
        }

        // Add user to group
        const groupMember = new GroupMember({
            groupId,
            userId: req.user._id
        });
        await groupMember.save();

        res.json({ 
            success: true, 
            message: 'Successfully joined the group',
            group 
        });
    } catch (error) {
        console.error('Error joining group:', error);
        res.status(500).json({ message: 'Error joining group', error: error.message });
    }
});

// Leave a group
router.post('/:groupId/leave', isAuthenticated, async (req, res) => {
    try {
        const { groupId } = req.params;
        console.log(`Leave group request: groupId=${groupId}, userId=${req.user._id}`);

        const membership = await GroupMember.findOneAndDelete({ 
            groupId, 
            userId: req.user._id 
        });

        if (!membership) {
            console.log(`Membership not found for user ${req.user._id} in group ${groupId}`);
            return res.status(400).json({ message: 'You are not a member of this group' });
        }

        console.log(`Membership deleted successfully`);

        // Check if group has any members left
        const remainingMembers = await GroupMember.countDocuments({ groupId });
        console.log(`Remaining members in group: ${remainingMembers}`);

        // If no members left, delete the group
        if (remainingMembers === 0) {
            await Group.findByIdAndDelete(groupId);
            console.log(`Group ${groupId} deleted as no members remain`);
            return res.json({ 
                success: true, 
                message: 'Group left and deleted as there were no remaining members' 
            });
        }

        res.json({ 
            success: true, 
            message: 'Successfully left the group' 
        });
    } catch (error) {
        console.error('Error leaving group:', error);
        res.status(500).json({ message: 'Error leaving group', error: error.message });
    }
});

module.exports = router;
