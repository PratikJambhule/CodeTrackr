const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  goalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Goal',
    required: true
  },
  type: {
    type: String,
    enum: ['deadline_reminder', 'deadline_missed', 'goal_completed'],
    default: 'deadline_reminder'
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  read: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Supports checkOverdueGoals()'s per-goal `findOne({ goalId, type })`.
notificationSchema.index({ goalId: 1, type: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
