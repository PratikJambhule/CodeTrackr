const express = require('express');
const router = express.Router();
const Group = require('../models/Group');
const GroupMember = require('../models/GroupMember');
const User = require('../models/user');
const Activity = require('../models/Activity');
const { isAuthenticated } = require('../middleware/auth');
const { hashPassword, verifyPassword, isHashed } = require('../services/passwordHash');
const { containsRegex } = require('../services/textQuery');
const { parseBoardWindow } = require('../services/boardWindow');
const UserStats = require('../models/UserStats');
const { matchActivityUsers, USER_KEY } = require('../services/activityUser');
const rateLimit = require('express-rate-limit');
const { userKey } = require('../services/rateLimitKeys');

// Discover is an unbounded browse of every group in the system. Cap it so the
// response cannot grow with the size of the install.
const DISCOVER_LIMIT = 100;

// A private group is gated by one shared password, so /join is a brute-force
// surface. Ten attempts per USER per 15 minutes is far above honest use. It runs
// after isAuthenticated so it can key by user: per IP, a whole campus on one
// Wi-Fi (or everyone behind the Vercel proxy) shared ten attempts (H-20).
const joinLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    skip: () => process.env.NODE_ENV === 'test',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: userKey,
});

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
                populate: { path: 'createdBy', select: 'name' }
            });

        const groups = memberships
            .map(m => m.groupId)
            .filter(g => g !== null); // Filter out null groups (if deleted)

        res.json({ success: true, groups });
    } catch (error) {
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
            .populate('createdBy', 'name')
            .sort({ createdAt: -1 })
            .limit(DISCOVER_LIMIT);

        res.json({ success: true, groups });
    } catch (error) {
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
        const group = await Group.findById(groupId).populate('createdBy', 'name');

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        // Get all members
        const members = await GroupMember.find({ groupId })
            .populate('userId', 'name')
            .sort({ joinedAt: 1 });

        const membersList = members.map(m => ({
            id: m.userId._id,
            name: m.userId.name,
            joinedAt: m.joinedAt
        }));

        // Get member IDs for leaderboard
        const memberIds = members.map(m => m.userId._id.toString());

        // Leaderboard: hours, lines, commits and build/command failures per
        // member -- "who's hitting the most errors" is the point of the group
        // feature (M-21). Three sources:
        //   ?from=&to=  a contest window: aggregate members' activity in it
        //   all-time    members' `userstats` running totals: O(members), no scan (H-8)
        //   all-time before the userstats backfill: the old full aggregate
        const board = parseBoardWindow(req.query);
        if (!board.ok) {
            return res.status(400).json({ message: board.error });
        }

        const activityMap = {};
        let source;
        if (!board.from && (await UserStats.estimatedDocumentCount()) > 0) {
            source = 'userstats';
            const stats = await UserStats.find({ userId: { $in: members.map(m => m.userId._id) } }).lean();
            for (const st of stats) {
                activityMap[st.userId.toString()] = {
                    totalHours: (st.totalSeconds || 0) / 3600,
                    totalLinesAdded: st.linesAdded || 0,
                    failedCommands: st.failedCommands || 0,
                    totalCommands: st.totalCommands || 0,
                    failedBuilds: st.failedBuilds || 0,
                    buildRuns: st.buildRuns || 0,
                    commits: st.commits || 0
                };
            }
        } else {
            source = 'scan';
            const match = { userId: matchActivityUsers(memberIds), duration: { $gte: 0 } };
            if (board.from) match.timestamp = { $gte: board.from, $lt: board.to };
            const activityData = await Activity.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: USER_KEY,
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
        }

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
            leaderboard: leaderboardWithUsers,
            window: board.from ? { from: board.from, to: board.to } : null,
            source
        });
    } catch (error) {
        return next(error);
    }
});

// Join a group
router.post('/:groupId/join', isAuthenticated, joinLimiter, async (req, res, next) => {
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

        // The creator is the only admin: hand the group to the longest-standing
        // member so it is never left without one (roadmap item 12).
        const group = await Group.findById(groupId);
        if (group && group.createdBy.toString() === req.user._id.toString()) {
            const heir = await GroupMember.findOne({ groupId }).sort({ joinedAt: 1, _id: 1 });
            if (heir) {
                group.createdBy = heir.userId;
                await group.save();
            }
        }

        res.json({ 
            success: true, 
            message: 'Successfully left the group' 
        });
    } catch (error) {
        return next(error);
    }
});

// ---- Admin: the group's creator (roadmap item 12) ----------------------------

const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;

/** Loads the group and checks the caller is its creator; answers and returns null otherwise. */
async function loadOwnedGroup(req, res) {
    const group = await Group.findById(req.params.groupId);
    if (!group) {
        res.status(404).json({ message: 'Group not found' });
        return null;
    }
    if (group.createdBy.toString() !== req.user._id.toString()) {
        res.status(403).json({ message: 'Only the group admin can do that' });
        return null;
    }
    return group;
}

// Rename / re-describe a group
router.patch('/:groupId', isAuthenticated, async (req, res, next) => {
    try {
        const { groupName, groupDescription } = req.body || {};
        const name = typeof groupName === 'string' ? groupName.trim() : undefined;
        const description = typeof groupDescription === 'string' ? groupDescription.trim() : undefined;
        if (name !== undefined && (name.length < 1 || name.length > MAX_NAME)) {
            return res.status(400).json({ message: `Name must be 1-${MAX_NAME} characters` });
        }
        if (description !== undefined && (description.length < 1 || description.length > MAX_DESCRIPTION)) {
            return res.status(400).json({ message: `Description must be 1-${MAX_DESCRIPTION} characters` });
        }
        if (name === undefined && description === undefined) {
            return res.status(400).json({ message: 'Nothing to update' });
        }

        const group = await loadOwnedGroup(req, res);
        if (!group) return;
        if (name !== undefined) group.name = name;
        if (description !== undefined) group.description = description;
        await group.save();

        const { password: _omit, ...safeGroup } = group.toObject();
        res.json({ success: true, group: safeGroup });
    } catch (error) {
        return next(error);
    }
});

// Remove a member
router.delete('/:groupId/members/:userId', isAuthenticated, async (req, res, next) => {
    try {
        const group = await loadOwnedGroup(req, res);
        if (!group) return;
        if (req.params.userId === req.user._id.toString()) {
            return res.status(400).json({ message: 'Use Leave to remove yourself' });
        }
        const removed = await GroupMember.findOneAndDelete({ groupId: group._id, userId: req.params.userId });
        if (!removed) {
            return res.status(404).json({ message: 'That user is not a member of this group' });
        }
        res.json({ success: true, message: 'Member removed' });
    } catch (error) {
        return next(error);
    }
});

module.exports = router;
