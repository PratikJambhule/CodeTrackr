const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const { isAuthenticated } = require('../middleware/auth');

/**
 * Every handler forwards failures with `next(error)` rather than answering 500
 * itself. The central handler in app.js logs the full error with a correlation
 * id, maps Mongoose CastError to 400, and returns a generic body — echoing
 * `error.message` here leaked internal detail and turned a malformed :id into a
 * 500.
 */

const MAX_PAGE_SIZE = 50;

// Get notifications for the logged-in user (newest first).
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const requested = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requested) && requested > 0
      ? Math.min(requested, MAX_PAGE_SIZE)
      : MAX_PAGE_SIZE;

    const notifications = await Notification.find({ userId: req.user._id })
      .populate('goalId', 'title description deadline')
      .sort({ createdAt: -1 })
      .limit(limit);

    res.json(notifications);
  } catch (error) {
    return next(error);
  }
});

// Get unread notification count
router.get('/unread-count', isAuthenticated, async (req, res, next) => {
  try {
    const count = await Notification.countDocuments({
      userId: req.user._id,
      read: false
    });

    res.json({ count });
  } catch (error) {
    return next(error);
  }
});

// Mark all as read. Declared before '/:id/read' for clarity; the paths differ in
// segment count so they cannot collide, but the ordering documents the intent.
router.patch('/mark-all-read', isAuthenticated, async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { userId: req.user._id, read: false },
      { read: true }
    );

    res.json({
      message: 'All notifications marked as read',
      updated: result.modifiedCount ?? 0
    });
  } catch (error) {
    return next(error);
  }
});

// Mark one notification as read. Scoped by userId so a guessed id cannot touch
// another user's row.
router.patch('/:id/read', isAuthenticated, async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { read: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.json({ notification });
  } catch (error) {
    return next(error);
  }
});

// Delete a notification
router.delete('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const deleted = await Notification.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });

    // Previously answered 200 whether or not anything matched, so deleting
    // someone else's id looked like it worked.
    if (!deleted) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.json({ message: 'Notification deleted' });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
