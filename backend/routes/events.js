'use strict';

/**
 * Hackathon events (plan slice 4, D-71). Teams are groups with `eventId`.
 * Boards show counts only: GitHub pushes (verified accounts) and VS Code time, inside the event.
 */
const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Event = require('../models/Event');
const Group = require('../models/Group');
const GroupMember = require('../models/GroupMember');
const GitPush = require('../models/GitPush');
const LinkedAccount = require('../models/LinkedAccount');
const DeviceToken = require('../models/DeviceToken');
const User = require('../models/user');
const Activity = require('../models/Activity');
const { isAuthenticated } = require('../middleware/auth');
const { hashPassword } = require('../services/passwordHash');
const { matchActivityUsers, USER_KEY } = require('../services/activityUser');
const { parseEvent, statusOf, buildEventBoard } = require('../services/eventBoard');
const { log } = require('../services/logger');

const router = express.Router();
const REFRESH_EVERY_MS = 5 * 60 * 1000;

async function loadEvent(req, res) {
  if (!mongoose.isValidObjectId(req.params.eventId)) {
    res.status(404).json({ message: 'Event not found' });
    return null;
  }
  const event = await Event.findById(req.params.eventId).populate('createdBy', 'name');
  if (!event) res.status(404).json({ message: 'Event not found' });
  return event;
}

const isOrganizer = (event, user) => String(event.createdBy._id || event.createdBy) === String(user._id);

/** Teams of an event with their members (names only). */
async function teamsOf(eventId) {
  const groups = await Group.find({ eventId }).sort({ createdAt: 1 }).lean();
  const members = await GroupMember.find({ groupId: { $in: groups.map((g) => g._id) } }).populate('userId', 'name').sort({ joinedAt: 1 }).lean();
  return groups.map((g) => ({
    id: String(g._id),
    name: g.name,
    members: members.filter((m) => String(m.groupId) === String(g._id) && m.userId).map((m) => ({ id: String(m.userId._id), name: m.userId.name })),
  }));
}

const myTeamIn = (teams, userId) => teams.find((t) => t.members.some((m) => m.id === String(userId))) || null;

const view = (event, user, now = Date.now()) => ({
  id: event._id,
  name: event.name,
  description: event.description,
  startsAt: event.startsAt,
  endsAt: event.endsAt,
  editorRule: event.editorRule,
  maxTeamSize: event.maxTeamSize,
  organizerName: event.createdBy && event.createdBy.name,
  status: statusOf(event, now),
  isOrganizer: isOrganizer(event, user),
});

// Create an event. The creator is its organiser.
router.post('/', isAuthenticated, async (req, res, next) => {
  try {
    const parsed = parseEvent(req.body);
    if (!parsed.ok) return res.status(400).json({ message: parsed.error });
    const event = await Event.create({ ...parsed.value, createdBy: req.user._id });
    await event.populate('createdBy', 'name');
    res.status(201).json({ event: view(event, req.user) });
  } catch (err) {
    return next(err);
  }
});

// Events I organise or have a team in.
router.get('/mine', isAuthenticated, async (req, res, next) => {
  try {
    const teams = await GroupMember.find({ userId: req.user._id }).lean();
    const teamGroups = await Group.find({ _id: { $in: teams.map((t) => t.groupId) }, eventId: { $ne: null } }, { eventId: 1 }).lean();
    const events = await Event.find({ $or: [{ createdBy: req.user._id }, { _id: { $in: teamGroups.map((g) => g.eventId) } }] })
      .sort({ startsAt: -1 }).limit(50).populate('createdBy', 'name');
    res.json({ events: events.map((e) => view(e, req.user)) });
  } catch (err) {
    return next(err);
  }
});

// The event, its teams, and my team. Anyone signed in with the link.
router.get('/:eventId', isAuthenticated, async (req, res, next) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return;
    const teams = await teamsOf(event._id);
    const mine = myTeamIn(teams, req.user._id);
    res.json({
      event: view(event, req.user),
      teams: teams.map((t) => ({ id: t.id, name: t.name, size: t.members.length, members: t.members.map((m) => m.name) })),
      myTeamId: mine ? mine.id : null,
    });
  } catch (err) {
    return next(err);
  }
});

// Change name, description, dates, editor rule or team size. Organiser only, before the end.
router.patch('/:eventId', isAuthenticated, async (req, res, next) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return;
    if (!isOrganizer(event, req.user)) return res.status(403).json({ message: 'Only the organiser can do that' });
    if (statusOf(event, Date.now()) === 'ended') return res.status(409).json({ message: 'This event has ended' });
    const parsed = parseEvent(req.body, Date.now(), { partial: true });
    if (!parsed.ok) return res.status(400).json({ message: parsed.error });
    Object.assign(event, parsed.value);
    await event.save();
    res.json({ event: view(event, req.user) });
  } catch (err) {
    return next(err);
  }
});

/** Refuses a join or a new team; returns a message or null. */
function joinProblem(event, teams, userId) {
  if (statusOf(event, Date.now()) === 'ended') return 'This event has ended';
  if (myTeamIn(teams, userId)) return 'You are already in a team for this event. Leave it first';
  return null;
}

// Start a team. You become its owner.
router.post('/:eventId/teams', isAuthenticated, async (req, res, next) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return;
    const name = typeof (req.body && req.body.name) === 'string' ? req.body.name.trim() : '';
    if (name.length < 2 || name.length > 40) return res.status(400).json({ message: 'Team name must be 2 to 40 characters' });
    const teams = await teamsOf(event._id);
    const problem = joinProblem(event, teams, req.user._id);
    if (problem) return res.status(409).json({ message: problem });
    if (teams.some((t) => t.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ message: 'A team with that name already exists' });
    // A team is joined from the event page only: its password is random and never shown.
    const group = await Group.create({
      name, description: `Team in ${event.name}`, visibility: 'private', eventId: event._id,
      password: await hashPassword(crypto.randomBytes(24).toString('hex')), createdBy: req.user._id,
    });
    await GroupMember.create({ groupId: group._id, userId: req.user._id });
    res.status(201).json({ teamId: group._id });
  } catch (err) {
    return next(err);
  }
});

// Join a team, if it has room.
router.post('/:eventId/teams/:teamId/join', isAuthenticated, async (req, res, next) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return;
    const teams = await teamsOf(event._id);
    const team = teams.find((t) => t.id === req.params.teamId);
    if (!team) return res.status(404).json({ message: 'Team not found' });
    const problem = joinProblem(event, teams, req.user._id);
    if (problem) return res.status(409).json({ message: problem });
    if (team.members.length >= event.maxTeamSize) return res.status(409).json({ message: 'This team is full' });
    await GroupMember.create({ groupId: team.id, userId: req.user._id });
    // Two people can take the last place at the same moment; the later one is taken out again.
    const size = await GroupMember.countDocuments({ groupId: team.id });
    if (size > event.maxTeamSize) {
      const last = await GroupMember.findOne({ groupId: team.id }).sort({ joinedAt: -1, _id: -1 });
      if (String(last.userId) === String(req.user._id)) {
        await last.deleteOne();
        return res.status(409).json({ message: 'This team is full' });
      }
    }
    res.json({ teamId: team.id });
  } catch (err) {
    if (err && err.code === 11000) return res.status(409).json({ message: 'You are already in this team' });
    return next(err);
  }
});

// The board: participants and the organiser.
router.get('/:eventId/board', isAuthenticated, async (req, res, next) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return;
    const teams = await teamsOf(event._id);
    const organizer = isOrganizer(event, req.user);
    if (!organizer && !myTeamIn(teams, req.user._id)) return res.status(403).json({ message: 'Join a team to see the board' });
    const ids = teams.flatMap((t) => t.members.map((m) => m.id));
    const now = Date.now();
    const end = new Date(Math.min(event.endsAt.getTime(), now));

    const verified = await LinkedAccount.find({ userId: { $in: ids }, provider: 'github', verifiedAt: { $ne: null } }, { userId: 1, username: 1 }).lean();
    const pushes = verified.length
      ? await GitPush.find({ $or: verified.map((a) => ({ userId: a.userId, username: a.username })), at: { $gte: event.startsAt, $lt: end } }, { userId: 1, at: 1 }).lean()
      : [];
    const seconds = event.startsAt < end ? await Activity.aggregate([
      { $match: { userId: matchActivityUsers(ids), timestamp: { $gte: event.startsAt, $lt: end }, duration: { $gte: 0 } } },
      { $group: { _id: USER_KEY, seconds: { $sum: '$duration' } } },
    ]) : [];
    const withKey = await User.find({ _id: { $in: ids }, apiKeyId: { $ne: null } }, { _id: 1 }).lean();
    const withDevice = await DeviceToken.find({ userId: { $in: ids }, expiresAt: { $gt: new Date() } }, { userId: 1 }).lean();

    const board = buildEventBoard({
      event,
      teams,
      pushes,
      vscodeSeconds: new Map(seconds.map((s) => [String(s._id), s.seconds])),
      githubVerified: new Set(verified.map((a) => String(a.userId))),
      vscodeConnected: new Set([...withKey.map((u) => String(u._id)), ...withDevice.map((d) => String(d.userId))]),
      now,
      forOrganizer: organizer,
    });
    res.json({ ...board, lastRefreshAt: event.lastRefreshAt });
  } catch (err) {
    return next(err);
  }
});

// Ask GitHub for everyone's latest pushes now. Organiser only, at most once every 5 minutes.
router.post('/:eventId/refresh', isAuthenticated, async (req, res, next) => {
  try {
    const event = await loadEvent(req, res);
    if (!event) return;
    if (!isOrganizer(event, req.user)) return res.status(403).json({ message: 'Only the organiser can do that' });
    const since = new Date(Date.now() - REFRESH_EVERY_MS);
    const claimed = await Event.findOneAndUpdate(
      { _id: event._id, $or: [{ lastRefreshAt: null }, { lastRefreshAt: { $lt: since } }] },
      { $set: { lastRefreshAt: new Date() } },
    );
    if (!claimed) return res.status(429).json({ message: 'Refreshed in the last 5 minutes. Try again shortly' });
    const ids = (await teamsOf(event._id)).flatMap((t) => t.members.map((m) => m.id));
    const accounts = await LinkedAccount.find({ userId: { $in: ids }, provider: 'github' }).lean();
    const linkedSync = require('../services/linkedSync');
    (async () => {
      for (const a of accounts) {
        try {
          await linkedSync.pull(a.userId, 'github', a.username);
        } catch (err) {
          log.warn('event refresh failed', { err: err.message });
          if (err.status === 503) break; // GitHub's limit: the rest wait for the hourly refresh
        }
      }
    })();
    res.json({ started: true, accounts: accounts.length });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
