const mongoose = require('mongoose');
const Activity = require('../models/Activity');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI;

async function debugActivities() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB\n');

        // Get total count
        const total = await Activity.countDocuments();
        console.log(`📊 Total activities in database: ${total}\n`);

        // Get unique users
        const uniqueUsers = await Activity.distinct('userId');
        console.log(`👥 Unique users with activities: ${uniqueUsers.length}`);
        console.log('User IDs:', uniqueUsers.slice(0, 5), '...\n');

        // Get activities per user
        console.log('📈 Activities per user:');
        for (const userId of uniqueUsers.slice(0, 10)) {
            const count = await Activity.countDocuments({ userId });
            console.log(`  User ${userId}: ${count} activities`);
        }

        // Get date range
        const oldest = await Activity.findOne().sort({ timestamp: 1 });
        const newest = await Activity.findOne().sort({ timestamp: -1 });
        console.log(`\n📅 Date range:`);
        console.log(`  Oldest: ${oldest?.timestamp}`);
        console.log(`  Newest: ${newest?.timestamp}`);

        // Sample recent activities
        console.log('\n📝 Sample of 10 most recent activities:');
        const recent = await Activity.find().sort({ timestamp: -1 }).limit(10);
        recent.forEach((activity, index) => {
            console.log(`  ${index + 1}. User: ${activity.userId}`);
            console.log(`     Project: ${activity.projectName || 'N/A'}`);
            console.log(`     Language: ${activity.language || 'N/A'}`);
            console.log(`     Duration: ${activity.duration || 0}s`);
            console.log(`     Lines: +${activity.linesAdded || 0} -${activity.linesRemoved || 0}`);
            console.log(`     Date: ${activity.timestamp}`);
            console.log('');
        });

        await mongoose.connection.close();
        console.log('✅ Debug complete!');
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

debugActivities();
