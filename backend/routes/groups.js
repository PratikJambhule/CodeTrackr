const express = require('express');
const router = express.Router();
const Group = require('../models/Group');
const GroupMember = require('../models/GroupMember');
const User = require('../models/user');
const Activity = require('../models/Activity');
const { isAuthenticated } = require('../middleware/auth');
const { hashPassword, verifyPassword, isHashed } = require('../services/passwordHash');
const { containsRegex } = require('../services/textQuery');

// Discover is an unbounded browse of every group in the system. Cap it so the
// response cannot grow with the size of the install.
const DISCOVER_LIMIT = 100;

// Create a new group
router.post('/create', isAuthenticated, async (req, res, next) => {
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
            password: visibility === 'private' ? await hashPassword(password) : null,
            createdBy: req.user._id
        });

        await group.save();

        // Automatically add creator as member
        const groupMember = new GroupMember({
            groupId: group._id,
            userId: req.user._id
        });
        await groupMember.save();

        const { password: _omitCreate, ...safeGroup } = group.toObject();
        res.status(201).json({
            success: true,
            message: 'Group created successfully',
            group: safeGroup
        });
    } catch (error) {
        // Was a blanket 400 "Error creating group", which reported a database
        // outage as a client mistake. Schema failures still surface as 400 via
        // the central handler's ValidationError mapping.
        return next(error);
    }
});

// Get all groups where the logged-in user is a member (My Groups)
router.get('/my-groups', isAuthenticated, async (req, res, next) => {
    try {
        const memberships = await GroupMember.find({ userId: req.user._id })
            .populate({
                path: 'groupId',
                select: '-password',
                populate: { path: 'createdBy', select: 'name email' }
            });

        const groups = memberships
            .map(m => m.groupId)
            .filter(g => g !== null); // Filter out null groups (if deleted)

        res.json({ success: true, groups });
    } catch (error) {
        console.error('Error fetching my groups:', error);
        return next(error);
    }
});

// Get all groups the user is NOT a member of (Discover Groups)
router.get('/discover', isAuthenticated, async (req, res, next) => {
    try {
        const { search } = req.query;

        // Get groups user is already a member of
        const memberships = await GroupMember.find({ userId: req.user._id }).select('groupId');
        const joinedGroupIds = memberships.map(m => m.groupId);

        // Find groups user is not a member of
        let query = { _id: { $nin: joinedGroupIds } };

        // Escaped: `$regex: search` let the caller compile their own pattern,
        // so `(a+)+$` backtracked catastrophically and stalled the event loop.
        const nameRe = containsRegex(search);
        if (nameRe) {
            query.name = nameRe;
        }

        const groups = await Group.find(query)
            .select('-password')
            .populate('createdBy', 'name email')
            .sort({ createdAt: -1 })
            .limit(DISCOVER_LIMIT);

        res.json({ success: true, groups });
    } catch (error) {
        console.error('Error fetching discover groups:', error);
        return next(error);
    }
});

// Get group details with members and leaderboard
router.get('/:groupId/details', isAuthenticated, async (req, res, next) => {
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

        // Calculate leaderboard based on coding hours.
        //
        // Also surfaces build/command failures. That is the point of the whole
        // group feature -- "who's hitting the most errors" -- and the extension
        // has always collected it in terminalAnalytics; nothing read it back.
        const activityData = await Activity.aggregate([
            { $match: { userId: { $in: memberIds }, duration: { $gte: 0 } } },
            {
                $group: {
                    _id: '$userId',
                    totalHours: { $sum: { $divide: ['$duration', 3600] } },
                    totalLinesAdded: { $sum: '$linesAdded' },
                    failedCommands: { $sum: { $ifNull: ['$terminalAnalytics.failedCommands', 0] } },
                    totalCommands: { $sum: { $ifNull: ['$terminalAnalytics.totalCommands', 0] } },
                    failedBuilds: { $sum: { $ifNull: ['$terminalAnalytics.failedBuilds', 0] } },
                    buildRuns: { $sum: { $ifNull: ['$terminalAnalytics.buildRuns', 0] } },
                    commits: {
                        $sum: {
                            $ifNull: [
                                '$gitAnalytics.commits',
                                { $ifNull: ['$terminalAnalytics.gitActivity.commits', 0] },
                            ],
                        },
                    }
                }
            }
        ]);

        // Create a map of userId to activity stats
        const activityMap = {};
        activityData.forEach(entry => {
            activityMap[entry._id.toString()] = {
                totalHours: entry.totalHours || 0,
                totalLinesAdded: entry.totalLinesAdded || 0,
                failedCommands: entry.failedCommands || 0,
                totalCommands: entry.totalCommands || 0,
                failedBuilds: entry.failedBuilds || 0,
                buildRuns: entry.buildRuns || 0,
                commits: entry.commits || 0
            };
        });

        // Build leaderboard with ALL members (including those with no activity).
        // Nothing here awaits, so no Promise.all is needed.
        const EMPTY_STATS = {
            totalHours: 0, totalLinesAdded: 0, failedCommands: 0,
            totalCommands: 0, failedBuilds: 0, buildRuns: 0, commits: 0
        };

        const leaderboardWithUsers = members.map((member) => {
            const userId = member.userId._id.toString();
            const stats = activityMap[userId] || EMPTY_STATS;

            // Rates are null (not 0) when nothing ran -- "never failed a build"
            // and "never ran a build" must not render identically.
            const commandFailureRate = stats.totalCommands > 0
                ? Math.round((stats.failedCommands / stats.totalCommands) * 100) / 100
                : null;
            const buildFailureRate = stats.buildRuns > 0
                ? Math.round((stats.failedBuilds / stats.buildRuns) * 100) / 100
                : null;

            return {
                userId: userId,
                userName: member.userId.name,
                email: member.userId.email,
                codingHours: parseFloat(stats.totalHours.toFixed(2)),
                totalLinesAdded: stats.totalLinesAdded,
                commits: stats.commits,
                failedCommands: stats.failedCommands,
                totalCommands: stats.totalCommands,
                commandFailureRate,
                failedBuilds: stats.failedBuilds,
                buildRuns: stats.buildRuns,
                buildFailureRate
            };
        });

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
        return next(error);
    }
});

// Join a group
router.post('/:groupId/join', isAuthenticated, async (req, res, next) => {
    try {
        const { groupId } = req.params;
        const { password } = req.body;

        const group = await Group.findById(groupId).select('+password');
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
            const ok = await verifyPassword(password, group.password);
            if (!ok) {
                return res.status(401).json({ message: 'Incorrect password' });
            }
            // Opportunistic migration off legacy plaintext (H-9).
            if (!isHashed(group.password)) {
                group.password = await hashPassword(password);
                await group.save();
            }
        }

        // Add user to group
        const groupMember = new GroupMember({
            groupId,
            userId: req.user._id
        });
        await groupMember.save();

        const { password: _omitJoin, ...safeJoined } = group.toObject();
        res.json({
            success: true,
            message: 'Successfully joined the group',
            group: safeJoined
        });
    } catch (error) {
        if (error && error.code === 11000) {
            return res.status(409).json({ message: 'You are already a member of this group' });
        }
        return next(error);
    }
});

// Leave a group
router.post('/:groupId/leave', isAuthenticated, async (req, res, next) => {
    try {
        const { groupId } = req.params;

        const membership = await GroupMember.findOneAndDelete({
            groupId,
            userId: req.user._id
        });

        if (!membership) {
            return res.status(400).json({ message: 'You are not a member of this group' });
        }

        // Check if group has any members left
        const remainingMembers = await GroupMember.countDocuments({ groupId });

        // If no members left, delete the group
        if (remainingMembers === 0) {
            await Group.findByIdAndDelete(groupId);
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
        return next(error);
    }
});

module.exports = router;
