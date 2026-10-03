const cron = require('node-cron');
const Goal = require('../models/Goal');
const Notification = require('../models/Notification');
const { rollupDaily } = require('./dailyRollup');
const { log } = require('./logger');

// Run every hour to check for goals with deadlines in 6 hours
const checkUpcomingDeadlines = async () => {
  try {
    
    const now = new Date();
    const sixHoursFromNow = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    const sevenHoursFromNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);

    // Find goals that:
    // 1. Have deadlines between 6-7 hours from now
    // 2. Are still in-progress
    // 3. Haven't had a reminder sent yet
    const upcomingGoals = await Goal.find({
      deadline: {
        $gte: sixHoursFromNow,
        $lt: sevenHoursFromNow
      },
      status: 'in-progress',
      reminderSent: false
    });

    log.info('deadline sweep', { upcoming: upcomingGoals.length });

    // Create notifications for each goal
    for (const goal of upcomingGoals) {
      const hoursRemaining = Math.round((new Date(goal.deadline) - now) / (1000 * 60 * 60));
      
      await Notification.create({
        userId: goal.userId,
        goalId: goal._id,
        type: 'deadline_reminder',
        title: '⏰ Goal Deadline Approaching!',
        message: `Your goal "${goal.title}" is due in ${hoursRemaining} hours! Time to wrap it up.`
      });

      // Mark reminder as sent
      await Goal.findByIdAndUpdate(goal._id, { reminderSent: true });
      
    }
  } catch (error) {
    log.error('deadline sweep failed', { err: error });
  }
};

// Check for overdue goals (run every hour)
const checkOverdueGoals = async () => {
  try {
    
    const now = new Date();

    // Find goals that are overdue and still in-progress
    const overdueGoals = await Goal.find({
      deadline: { $lt: now },
      status: 'in-progress'
    });

    for (const goal of overdueGoals) {
      // Check if we already sent an overdue notification
      const existingNotification = await Notification.findOne({
        goalId: goal._id,
        type: 'deadline_missed'
      });

      if (!existingNotification) {
        await Notification.create({
          userId: goal.userId,
          goalId: goal._id,
          type: 'deadline_missed',
          title: '❌ Goal Deadline Missed',
          message: `The deadline for "${goal.title}" has passed. Consider updating or completing it.`
        });
        
      }
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
