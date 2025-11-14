require('dotenv').config();
const mongoose = require('mongoose');
const Activity = require('./models/Activity');
const User = require('./models/user');

async function cleanupAndSpreadData() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000,
        });
        console.log('✅ MongoDB connected\n');

        // Find the user
        const user = await User.findOne({ email: 'pratik.jambhule23@spit.ac.in' });
        if (!user) {
            console.error('❌ User not found!');
            process.exit(1);
        }

        console.log(`Found user: ${user.name}`);
        console.log(`User ID: ${user._id.toString()}\n`);

        const userId = user._id.toString();

        // Delete all existing activities for this user
        const deleteResult = await Activity.deleteMany({ userId: userId });
        console.log(`Deleted ${deleteResult.deletedCount} existing activities\n`);

        // Generate new activities spread across days and weeks
        const languages = ['javascript', 'typescript', 'python', 'java', 'cpp', 'html', 'css', 'react'];
        const fileTypes = ['js', 'ts', 'py', 'java', 'cpp', 'html', 'css', 'jsx'];
        const projects = ['CodeTrackr', 'E-Commerce-App', 'ML-Project', 'Portfolio-Website', 'API-Backend'];

        const activities = [];
        const totalActivities = Math.floor(Math.random() * 11) + 60; // 60-70 activities

        console.log(`Generating ${totalActivities} activities...\n`);

        const now = new Date();
        
        // Spread activities across last 8 weeks
        for (let i = 0; i < totalActivities; i++) {
            // Random day in the last 56 days (8 weeks)
            const daysAgo = Math.floor(Math.random() * 56);
            const activityDate = new Date(now);
            activityDate.setDate(activityDate.getDate() - daysAgo);
            
            // Set random time during work hours (9 AM - 7 PM)
            activityDate.setHours(9 + Math.floor(Math.random() * 10));
            activityDate.setMinutes(Math.floor(Math.random() * 60));
            activityDate.setSeconds(Math.floor(Math.random() * 60));

            const langIndex = Math.floor(Math.random() * languages.length);
            const projectIndex = Math.floor(Math.random() * projects.length);
            
            // Random coding session (10 minutes to 3 hours in seconds)
            const duration = Math.floor(Math.random() * 10200) + 600;
            
            // Random lines added/removed
            const linesAdded = Math.floor(Math.random() * 150) + 5;
            const linesRemoved = Math.floor(Math.random() * 40);

            activities.push({
                userId: userId,
                fileName: `src/components/Component${i}.${fileTypes[langIndex]}`,
                fileType: fileTypes[langIndex],
                projectName: projects[projectIndex],
                language: languages[langIndex],
                duration: duration,
                linesAdded: linesAdded,
                linesRemoved: linesRemoved,
                timestamp: activityDate,
                date: activityDate.toISOString().split('T')[0]
            });
        }

        // Sort by timestamp
        activities.sort((a, b) => a.timestamp - b.timestamp);

        console.log('Inserting activities into database...');
        const result = await Activity.insertMany(activities);
        console.log(`✅ Successfully inserted ${result.length} activities!\n`);

        // Calculate statistics
        const totalSeconds = activities.reduce((sum, a) => sum + a.duration, 0);
        const totalHours = (totalSeconds / 3600).toFixed(2);
        const totalLines = activities.reduce((sum, a) => sum + a.linesAdded, 0);
        const uniqueProjects = new Set(activities.map(a => a.projectName));
        const uniqueDays = new Set(activities.map(a => a.date));

        // Get date range
        const dates = activities.map(a => new Date(a.timestamp)).sort((a, b) => a - b);
        const oldestDate = dates[0].toISOString().split('T')[0];
        const newestDate = dates[dates.length - 1].toISOString().split('T')[0];

        console.log('=== Summary ===');
        console.log(`Total Activities: ${activities.length}`);
        console.log(`Total Hours: ${totalHours}h`);
        console.log(`Total Lines Added: ${totalLines}`);
        console.log(`Unique Projects: ${uniqueProjects.size}`);
        console.log(`Days with Activity: ${uniqueDays.size}`);
        console.log(`Date Range: ${oldestDate} to ${newestDate}`);

        // Language breakdown
        const langBreakdown = {};
        activities.forEach(a => {
            if (!langBreakdown[a.language]) {
                langBreakdown[a.language] = 0;
            }
            langBreakdown[a.language] += a.duration / 3600;
        });

        console.log('\n=== Language Breakdown ===');
        Object.entries(langBreakdown)
            .sort((a, b) => b[1] - a[1])
            .forEach(([lang, hours]) => {
                console.log(`${lang}: ${hours.toFixed(2)}h`);
            });

        // Daily breakdown
        const dailyBreakdown = {};
        activities.forEach(a => {
            if (!dailyBreakdown[a.date]) {
                dailyBreakdown[a.date] = 0;
            }
            dailyBreakdown[a.date] += a.duration / 3600;
        });

        console.log('\n=== Last 7 Days ===');
        Object.entries(dailyBreakdown)
            .sort((a, b) => b[0].localeCompare(a[0]))
            .slice(0, 7)
            .forEach(([date, hours]) => {
                console.log(`${date}: ${hours.toFixed(2)}h`);
            });

        await mongoose.connection.close();
        console.log('\n✅ Done!');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error);
        process.exit(1);
    }
}

cleanupAndSpreadData();
