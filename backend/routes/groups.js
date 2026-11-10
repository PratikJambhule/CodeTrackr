const express = require('express');
const router = express.Router();
const Group = require('../models/Group');
const GroupMember = require('../models/GroupMember');
const GroupInvite = require('../models/GroupInvite');
const GroupAuditLog = require('../models/GroupAuditLog');
const mongoose = require('mongoose');
const User = require('../models/user');
const Activity = require('../models/Activity');
const { isAuthenticated } = require('../middleware/auth');
const { hashPassword, verifyPassword, isHashed } = require('../services/passwordHash');
const { containsRegex } = require('../services/textQuery');
const { parseBoardWindow } = require('../services/boardWindow');
const { groupDaily } = require('../services/groupDaily');
const UserStats = require('../models/UserStats');
const { statsComplete } = require('../services/userStats');
const { matchActivityUsers, USER_KEY } = require('../services/activityUser');
const rateLimit = require('express-rate-limit');
const { userKey } = require('../services/rateLimitKeys');
const { roleOf, atLeast, canManage, newInviteToken, hashInviteToken, parseInviteOptions } = require('../services/groupRoles');
const { log } = require('../services/logger');

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

/** Records an admin action. A failed log line must not undo or fail the action itself. */
async function audit(groupId, actorId, action, targetId = null, detail = null) {
    try {
        await GroupAuditLog.create({ groupId, actorId, action, targetId, detail });
    } catch (err) {
        log.error('group audit write failed', { action, err });
    }
}

// ---- Invite links (plan slice 1) -------------------------------------------
// These two sit before the /:groupId routes: POST /invites/join would otherwise match /:groupId/join.

/** The invite for this token if it can still be used, else null. */
async function usableInvite(token) {
    if (typeof token !== 'string' || !token) return null;
    const invite = await GroupInvite.findOne({ tokenHash: hashInviteToken(token), expiresAt: { $gt: new Date() } });
    return invite && invite.uses < invite.maxUses ? invite : null;
}

router.get('/invites/:token/preview', isAuthenticated, joinLimiter, async (req, res, next) => {
    try {
        const invite = await usableInvite(req.params.token);
        const group = invite && await Group.findById(invite.groupId).populate('createdBy', 'name');
        if (!group) return res.status(404).json({ message: 'This invite link is not valid any more' });
        const [memberCount, isMember] = await Promise.all([
            GroupMember.countDocuments({ groupId: group._id }),
            GroupMember.exists({ groupId: group._id, userId: req.user._id }),
        ]);
        res.json({
            group: { _id: group._id, name: group.name, description: group.description, createdByName: group.createdBy && group.createdBy.name },
            memberCount,
            isMember: Boolean(isMember),
        });
    } catch (error) {
        return next(error);
    }
});

router.post('/invites/join', isAuthenticated, joinLimiter, async (req, res, next) => {
    try {
        const token = req.body && req.body.token;
        const invite = await GroupInvite.findOne({ tokenHash: hashInviteToken(token) });
        const target = invite && await Group.findById(invite.groupId, { eventId: 1 }).lean();
        if (!target) {
            return res.status(410).json({ message: 'This invite link is not valid any more' });
        }
        if (target.eventId) {
            return res.status(409).json({ message: 'This is a hackathon team. Join it from the event page' });
        }
        if (await GroupMember.exists({ groupId: invite.groupId, userId: req.user._id })) {
            return res.status(409).json({ message: 'You are already a member of this group', groupId: invite.groupId });
        }
        // One atomic update claims a use, so two people can't both take the last one.
        const claimed = await GroupInvite.findOneAndUpdate(
            { _id: invite._id, expiresAt: { $gt: new Date() }, $expr: { $lt: ['$uses', '$maxUses'] } },
            { $inc: { uses: 1 } }
        );
        if (!claimed) return res.status(410).json({ message: 'This invite link is not valid any more' });
        try {
            await GroupMember.create({ groupId: invite.groupId, userId: req.user._id });
        } catch (error) {
            await GroupInvite.updateOne({ _id: invite._id }, { $inc: { uses: -1 } }); // give the use back
            if (error.code === 11000) return res.status(409).json({ message: 'You are already a member of this group', groupId: invite.groupId });
            throw error;
        }
        await audit(invite.groupId, req.user._id, 'joined_by_invite');
        res.json({ success: true, groupId: invite.groupId });
    } catch (error) {
        return next(error);
    }
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
        let query = { _id: { $nin: joinedGroupIds }, eventId: null }; // hackathon teams are joined from their event

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
            joinedAt: m.joinedAt,
            role: roleOf(group, m)
        }));

        // Get member IDs for leaderboard
        const memberIds = members.map(m => m.userId._id.toString());

        // Leaderboard: hours, lines, commits and build/command failures per
        // member -- "who's hitting the most errors" is the point of the group
        // feature (M-21). Three sources:
        //   ?from=&to=  a contest window: aggregate members' activity in it
        //   all-time    members' `userstats` running totals: O(members), no scan (H-8)
        //   all-time before the userstats backfill has finished: the old full aggregate
        const board = parseBoardWindow(req.query);
        if (!board.ok) {
            return res.status(400).json({ message: board.error });
        }

        const activityMap = {};
        let source;
        if (!board.from && (await statsComplete())) {
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

        // Seconds per member per local day: the standings tower's day cells and
        // the race chart (redesign spec §6). The window's days, or the last 7.
        const offset = Number.parseInt(req.query.timezone, 10);
        const daily = await groupDaily({
            memberIds,
            from: board.from,
            to: board.to,
            offsetMinutes: Number.isFinite(offset) ? offset : 0,
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
            myRole: roleOf(group, membership),
            leaderboard: leaderboardWithUsers,
            window: board.from ? { from: board.from, to: board.to } : null,
            daily,
            source
        });
    } catch (error) {
        return next(error);
    }
});

// Preview a group for an invite link (/join/:groupId on the website): what it
// is and whether the caller already belongs. Exposes no more than Discover does
// (name, description, visibility, creator's name) plus a member count: no
// member list, no emails, never the password.
router.get('/:groupId/preview', isAuthenticated, async (req, res, next) => {
    try {
        const group = await Group.findById(req.params.groupId).populate('createdBy', 'name');
        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }
        const [memberCount, membership] = await Promise.all([
            GroupMember.countDocuments({ groupId: group._id }),
            GroupMember.exists({ groupId: group._id, userId: req.user._id }),
        ]);
        res.json({
            success: true,
            group: {
                _id: group._id,
                name: group.name,
                description: group.description,
                visibility: group.visibility,
                createdBy: group.createdBy ? { _id: group.createdBy._id, name: group.createdBy.name } : null,
                createdAt: group.createdAt,
            },
            memberCount,
            isMember: Boolean(membership),
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

        // The owner left: hand the group to the longest-standing admin, or else
        // the longest-standing member, so it is never left without an owner.
        const group = await Group.findById(groupId);
        if (group && group.createdBy.toString() === req.user._id.toString()) {
            const heir = await GroupMember.findOne({ groupId, role: 'admin' }).sort({ joinedAt: 1, _id: 1 })
                || await GroupMember.findOne({ groupId }).sort({ joinedAt: 1, _id: 1 });
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

// ---- Admin: owner and admins (plan slice 1) ----------------------------------

const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;

/** Loads the group and checks the caller's role; answers and returns null otherwise. */
async function loadGroupAs(req, res, minRole) {
    const group = await Group.findById(req.params.groupId);
    if (!group) {
        res.status(404).json({ message: 'Group not found' });
        return null;
    }
    const membership = await GroupMember.findOne({ groupId: group._id, userId: req.user._id });
    const role = roleOf(group, membership);
    if (!atLeast(role, minRole)) {
        res.status(403).json({ message: minRole === 'owner' ? 'Only the group owner can do that' : 'Only a group admin can do that' });
        return null;
    }
    return { group, role };
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

        const access = await loadGroupAs(req, res, 'admin');
        if (!access) return;
        const { group } = access;
        if (name !== undefined) group.name = name;
        if (description !== undefined) group.description = description;
        await group.save();
        await audit(group._id, req.user._id, 'group_renamed');

        const { password: _omit, ...safeGroup } = group.toObject();
        res.json({ success: true, group: safeGroup });
    } catch (error) {
        return next(error);
    }
});

// Remove a member
router.delete('/:groupId/members/:userId', isAuthenticated, async (req, res, next) => {
    try {
        const access = await loadGroupAs(req, res, 'admin');
        if (!access) return;
        const { group, role } = access;
        if (req.params.userId === req.user._id.toString()) {
            return res.status(400).json({ message: 'Use Leave to remove yourself' });
        }
        const target = await GroupMember.findOne({ groupId: group._id, userId: req.params.userId });
        if (!target) {
            return res.status(404).json({ message: 'That user is not a member of this group' });
        }
        if (!canManage(role, roleOf(group, target))) {
            return res.status(403).json({ message: 'You can only remove people below your own role' });
        }
        await target.deleteOne();
        await audit(group._id, req.user._id, 'member_removed', req.params.userId);
        res.json({ success: true, message: 'Member removed' });
    } catch (error) {
        return next(error);
    }
});

// Make someone an admin, or back to a member. Owner only.
router.patch('/:groupId/members/:userId/role', isAuthenticated, async (req, res, next) => {
    try {
        const newRole = req.body && req.body.role;
        if (newRole !== 'admin' && newRole !== 'member') {
            return res.status(400).json({ message: 'role must be admin or member' });
        }
        const access = await loadGroupAs(req, res, 'owner');
        if (!access) return;
        const { group } = access;
        const target = await GroupMember.findOne({ groupId: group._id, userId: req.params.userId });
        if (!target) return res.status(404).json({ message: 'That user is not a member of this group' });
        if (roleOf(group, target) === 'owner') return res.status(400).json({ message: 'The owner has no other role. Transfer ownership instead' });
        target.role = newRole;
        await target.save();
        await audit(group._id, req.user._id, 'role_changed', req.params.userId, newRole);
        res.json({ success: true });
    } catch (error) {
        return next(error);
    }
});

// Hand the group to another member. The old owner stays on as an admin.
router.post('/:groupId/transfer', isAuthenticated, async (req, res, next) => {
    try {
        const access = await loadGroupAs(req, res, 'owner');
        if (!access) return;
        const { group } = access;
        const userId = req.body && req.body.userId;
        const target = typeof userId === 'string' && mongoose.isValidObjectId(userId)
            ? await GroupMember.findOne({ groupId: group._id, userId })
            : null;
        if (!target) return res.status(404).json({ message: 'That user is not a member of this group' });
        if (userId === req.user._id.toString()) return res.status(400).json({ message: 'You already own this group' });
        group.createdBy = target.userId;
        await group.save();
        await GroupMember.updateOne({ groupId: group._id, userId: req.user._id }, { $set: { role: 'admin' } });
        await audit(group._id, req.user._id, 'ownership_transferred', userId);
        res.json({ success: true });
    } catch (error) {
        return next(error);
    }
});

// Create an invite link. The token is returned this once and never again.
router.post('/:groupId/invites', isAuthenticated, async (req, res, next) => {
    try {
        const access = await loadGroupAs(req, res, 'admin');
        if (!access) return;
        const options = parseInviteOptions(req.body);
        if (!options.ok) return res.status(400).json({ message: options.error });
        const token = newInviteToken();
        const invite = await GroupInvite.create({
            groupId: access.group._id,
            tokenHash: hashInviteToken(token),
            createdBy: req.user._id,
            maxUses: options.maxUses,
            expiresAt: new Date(Date.now() + options.days * 864e5),
        });
        await audit(access.group._id, req.user._id, 'invite_created');
        res.status(201).json({ invite: { id: invite._id, token, expiresAt: invite.expiresAt, maxUses: invite.maxUses, uses: 0 } });
    } catch (error) {
        return next(error);
    }
});

// Links still in force. Never includes the token.
router.get('/:groupId/invites', isAuthenticated, async (req, res, next) => {
    try {
        const access = await loadGroupAs(req, res, 'admin');
        if (!access) return;
        const invites = await GroupInvite.find({ groupId: access.group._id, expiresAt: { $gt: new Date() } })
            .sort({ createdAt: -1 }).limit(50).populate('createdBy', 'name').lean();
        res.json({
            invites: invites.map((i) => ({
                id: i._id, expiresAt: i.expiresAt, maxUses: i.maxUses, uses: i.uses,
                createdByName: i.createdBy && i.createdBy.name,
            })),
        });
    } catch (error) {
        return next(error);
    }
});

router.delete('/:groupId/invites/:inviteId', isAuthenticated, async (req, res, next) => {
    try {
        const access = await loadGroupAs(req, res, 'admin');
        if (!access) return;
        const removed = await GroupInvite.findOneAndDelete({ _id: req.params.inviteId, groupId: access.group._id });
        if (!removed) return res.status(404).json({ message: 'Invite not found' });
        await audit(access.group._id, req.user._id, 'invite_revoked');
        res.json({ success: true });
    } catch (error) {
        return next(error);
    }
});

// The last 50 admin actions in this group, newest first. Names only, no emails.
router.get('/:groupId/audit', isAuthenticated, async (req, res, next) => {
    try {
        const access = await loadGroupAs(req, res, 'admin');
        if (!access) return;
        const rows = await GroupAuditLog.find({ groupId: access.group._id }).sort({ at: -1, _id: -1 }).limit(50)
            .populate('actorId', 'name').populate('targetId', 'name').lean();
        res.json({
            entries: rows.map((r) => ({
                id: r._id, action: r.action, detail: r.detail, at: r.at,
                actorName: r.actorId && r.actorId.name,
                targetName: r.targetId && r.targetId.name,
            })),
        });
    } catch (error) {
        return next(error);
    }
});

// GET /api/groups/:groupId/week — this week's board: plain counts from the sites (D-70).
// Members only. Names, never emails. Verified accounts only.
router.get('/:groupId/week', isAuthenticated, async (req, res, next) => {
    try {
        const { groupId } = req.params;
        if (!(await GroupMember.exists({ groupId, userId: req.user._id }))) {
            return res.status(403).json({ message: 'You must be a member to view group details' });
        }
        const rows = await GroupMember.find({ groupId }).populate('userId', 'name').lean();
        const members = rows.filter((m) => m.userId).map((m) => ({ id: String(m.userId._id), name: m.userId.name }));
        res.json(await require('../services/competitionLedger').boardFor({ members }));
    } catch (err) {
        return next(err);
    }
});

// GET /api/groups/:groupId/practice — members' LeetCode and Codeforces practice this week (D-62).
// Members only. Only VERIFIED accounts are shown; the rest are listed by name so people know why.
router.get('/:groupId/practice', isAuthenticated, async (req, res, next) => {
    try {
        const { groupId } = req.params;
        if (!(await GroupMember.exists({ groupId, userId: req.user._id }))) {
            return res.status(403).json({ message: 'You must be a member to view group details' });
        }
        const members = await GroupMember.find({ groupId }).populate('userId', 'name profilePictureUrl').lean();
        const people = members.filter((m) => m.userId).map((m) => ({ id: String(m.userId._id), name: m.userId.name }));
        const rows = await require('../services/linkedSync').boardRows(people.map((p) => p.id));
        const names = new Map(people.map((p) => [p.id, p.name]));
        const shown = new Set(rows.map((r) => r.userId));
        res.json({
            rows: rows.map((r) => ({ ...r, name: names.get(r.userId) })),
            notShown: people.filter((p) => !shown.has(p.id)).map((p) => ({ id: p.id, name: p.name })),
        });
    } catch (err) {
        return next(err);
    }
});

module.exports = router;
