const cron = require('node-cron');
const Goal = require('../models/Goal');
const Notification = require('../models/Notification');
const { rollupDaily } = require('./dailyRollup');
const { log } = require('./logger');

const HOUR = 60 * 60 * 1000;

// Each notice is sent once per goal. The goal records that it was sent, and
// the sweep claims that flag with one atomic update before creating the
// notification: the in-process cron and the GitHub Actions call can run at the
// same minute, and only one of them may win. Deleting a notice never re-arms it.

// "Due in about 6 hours": goals whose deadline is 6-7 hours away.
const checkUpcomingDeadlines = async () => {
  try {
    const now = new Date();
    const due = await Goal.find({
      deadline: { $gte: new Date(now.getTime() + 6 * HOUR), $lt: new Date(now.getTime() + 7 * HOUR) },
      status: 'in-progress',
      reminderSent: false,
    }).select('_id').lean();

    let sent = 0;
    for (const { _id } of due) {
      const goal = await Goal.findOneAndUpdate({ _id, reminderSent: false }, { $set: { reminderSent: true } }, { new: true });
      if (!goal) continue; // another sweep claimed it
      const hoursRemaining = Math.round((new Date(goal.deadline) - now) / HOUR);
      await Notification.create({
        userId: goal.userId,
        goalId: goal._id,
        type: 'deadline_reminder',
        title: '⏰ Goal Deadline Approaching!',
        message: `Your goal "${goal.title}" is due in ${hoursRemaining} hours! Time to wrap it up.`
      });
      sent += 1;
    }
    log.info('deadline sweep', { upcoming: due.length, sent });
  } catch (error) {
    log.error('deadline sweep failed', { err: error });
  }
};

// "Deadline missed": in-progress goals whose deadline passed in the last
// 48 hours. Older ones were handled when they happened (or by the previous
// code, which kept no flag), so they are not revisited.
const MISSED_WINDOW = 48 * HOUR;

const checkOverdueGoals = async () => {
  try {
    const now = new Date();
    const overdue = await Goal.find({
      deadline: { $lt: now, $gte: new Date(now.getTime() - MISSED_WINDOW) },
      status: 'in-progress',
      missedNotified: { $ne: true },
    }).select('_id').lean();

    for (const { _id } of overdue) {
      const goal = await Goal.findOneAndUpdate({ _id, missedNotified: { $ne: true } }, { $set: { missedNotified: true } }, { new: true });
      if (!goal) continue; // another sweep claimed it
      // Sent before the flag existed: keep the one the user already has.
      if (await Notification.exists({ goalId: goal._id, type: 'deadline_missed' })) continue;
      await Notification.create({
        userId: goal.userId,
        goalId: goal._id,
        type: 'deadline_missed',
        title: '❌ Goal Deadline Missed',
        message: `The deadline for "${goal.title}" has passed. Consider updating or completing it.`
      });
    }
  } catch (error) {
    log.error('overdue sweep failed', { err: error });
  }
};

// Initialize the scheduler
const initScheduler = () => {
  // Run every hour at minute 0
  cron.schedule('0 * * * *', () => {
    checkUpcomingDeadlines();
    checkOverdueGoals();
  });

  // Daily rollup of raw activity into DailySummary. Inherits the same
  // serverless caveat as the hourly job (see IMPROVEMENT_PLAN.md H-13).
  cron.schedule('30 3 * * *', () => {
    rollupDaily({ apply: true, beforeDays: 2 })
      .then((r) => log.info('daily rollup', { wrote: r.wrote }))
      .catch((err) => log.error('daily rollup failed', { err }));
  });

  // Run immediately on startup
  checkUpcomingDeadlines();
  checkOverdueGoals();

  log.info('scheduler started');
};

module.exports = { initScheduler, checkUpcomingDeadlines, checkOverdueGoals, rollupDaily };
