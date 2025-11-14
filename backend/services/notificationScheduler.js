const cron = require('node-cron');
const Goal = require('../models/Goal');
const Notification = require('../models/Notification');

// Run every hour to check for goals with deadlines in 6 hours
const checkUpcomingDeadlines = async () => {
  try {
    console.log('🔔 Checking for upcoming goal deadlines...');
    
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

    console.log(`Found ${upcomingGoals.length} goals with upcoming deadlines`);

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
      
      console.log(`✅ Reminder created for goal: ${goal.title}`);
    }
  } catch (error) {
    console.error('Error checking deadlines:', error);
  }
};

// Check for overdue goals (run every hour)
const checkOverdueGoals = async () => {
  try {
    console.log('⏳ Checking for overdue goals...');
    
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
        
        console.log(`⚠️ Overdue notification created for goal: ${goal.title}`);
      }
    }
  } catch (error) {
    console.error('Error checking overdue goals:', error);
  }
};

// Initialize the scheduler
const initScheduler = () => {
  // Run every hour at minute 0
  cron.schedule('0 * * * *', () => {
    console.log('🕐 Running scheduled deadline check...');
    checkUpcomingDeadlines();
    checkOverdueGoals();
  });

  // Run immediately on startup
  checkUpcomingDeadlines();
  checkOverdueGoals();

  console.log('✅ Goal deadline scheduler initialized');
};

module.exports = { initScheduler, checkUpcomingDeadlines, checkOverdueGoals };
