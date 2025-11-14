require('dotenv').config();
const mongoose = require('mongoose');
const Activity = require('./models/Activity');
const User = require('./models/user');

async function checkData() {
    try {
        // Connect to MongoDB
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 5000
        });
        console.log('✅ MongoDB connected\n');

        // Count and list users
        const users = await User.find({}, 'name email _id apiKey');
        console.log('=== USERS ===');
        console.log(`Total users: ${users.length}\n`);
        users.forEach(user => {
            console.log(`User: ${user.name}`);
            console.log(`  Email: ${user.email}`);
            console.log(`  ID: ${user._id}`);
            console.log(`  ID as string: ${user._id.toString()}`);
            console.log(`  API Key: ${user.apiKey ? user.apiKey.substring(0, 20) + '...' : 'Not set'}\n`);
        });

        // Count and list activities
        const activities = await Activity.find({});
        console.log('=== ACTIVITIES ===');
        console.log(`Total activities: ${activities.length}\n`);
        
        if (activities.length > 0) {
            // Group by userId
            const byUser = {};
            activities.forEach(act => {
                if (!byUser[act.userId]) {
                    byUser[act.userId] = [];
                }
                byUser[act.userId].push(act);
            });

            Object.entries(byUser).forEach(([userId, userActivities]) => {
                console.log(`User ID (from activity): ${userId}`);
                console.log(`  Type: ${typeof userId}`);
                console.log(`  Total activities: ${userActivities.length}`);
                const totalSeconds = userActivities.reduce((sum, a) => sum + (a.duration || 0), 0);
                console.log(`  Total duration: ${totalSeconds} seconds (${(totalSeconds / 3600).toFixed(2)} hours)`);
                console.log(`  Sample activity:`, {
                    fileName: userActivities[0].fileName,
                    language: userActivities[0].language,
                    duration: userActivities[0].duration,
                    timestamp: userActivities[0].timestamp
                });
                console.log();
            });
        } else {
            console.log('No activities found in database!\n');
        }

        await mongoose.connection.close();
        console.log('✅ Done');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

checkData();
