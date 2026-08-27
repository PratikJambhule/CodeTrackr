require('dotenv').config();
const mongoose = require('mongoose');
const Activity = require('./models/Activity');
const User = require('./models/user');

async function addDummyData() {
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

        // Languages to use
        const languages = ['javascript', 'typescript', 'python', 'java', 'cpp', 'html', 'css', 'go'];
        const fileTypes = ['js', 'ts', 'py', 'java', 'cpp', 'html', 'css', 'go'];
        const projects = ['CodeTrackr', 'E-Commerce-App', 'ML-Project', 'Portfolio-Website', 'API-Backend'];

        const activities = [];

        // Generate data for last 8 weeks
        const now = new Date();
        for (let week = 0; week < 8; week++) {
            // Generate 3-7 days of activity per week
            const daysInWeek = Math.floor(Math.random() * 5) + 3;
            
            for (let day = 0; day < daysInWeek; day++) {
                // Calculate date (going back in time)
                const daysAgo = (week * 7) + day;
                const activityDate = new Date(now);
                activityDate.setDate(activityDate.getDate() - daysAgo);

                // Generate 2-5 activities per day
                const activitiesPerDay = Math.floor(Math.random() * 4) + 2;

                for (let i = 0; i < activitiesPerDay; i++) {
                    const langIndex = Math.floor(Math.random() * languages.length);
                    const projectIndex = Math.floor(Math.random() * projects.length);
                    
                    // Random coding session (5 minutes to 2 hours in seconds)
                    const duration = Math.floor(Math.random() * 7200) + 300;
                    
                    // Random lines added/removed
                    const linesAdded = Math.floor(Math.random() * 200) + 10;
                    const linesRemoved = Math.floor(Math.random() * 50);

                    // Add some random hours to the time
                    const timestamp = new Date(activityDate);
                    timestamp.setHours(9 + Math.floor(Math.random() * 10)); // Between 9 AM and 7 PM
                    timestamp.setMinutes(Math.floor(Math.random() * 60));

                    activities.push({
                        userId: userId,
                        fileName: `src/components/Component${i}.${fileTypes[langIndex]}`,
                        fileType: fileTypes[langIndex],
                        projectName: projects[projectIndex],
                        language: languages[langIndex],
                        duration: duration,
                        linesAdded: linesAdded,
                        linesRemoved: linesRemoved,
                        timestamp: timestamp,
                        date: timestamp.toISOString().split('T')[0]
                    });
                }
            }
        }

        console.log(`Generated ${activities.length} dummy activities\n`);

        // Insert all activities
        console.log('Inserting activities into database...');
        const result = await Activity.insertMany(activities);
        console.log(`✅ Successfully inserted ${result.length} activities!\n`);

        // Calculate statistics
        const totalSeconds = activities.reduce((sum, a) => sum + a.duration, 0);
        const totalHours = (totalSeconds / 3600).toFixed(2);
        const totalLines = activities.reduce((sum, a) => sum + a.linesAdded, 0);
        const uniqueProjects = new Set(activities.map(a => a.projectName));
        const uniqueDays = new Set(activities.map(a => a.date));

        console.log('=== Summary ===');
        console.log(`Total Hours: ${totalHours}h`);
        console.log(`Total Lines Added: ${totalLines}`);
        console.log(`Unique Projects: ${uniqueProjects.size}`);
        console.log(`Days with Activity: ${uniqueDays.size}`);
        console.log(`Date Range: ${activities[activities.length - 1].date} to ${activities[0].date}`);

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

        await mongoose.connection.close();
        console.log('\n✅ Done!');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

addDummyData();
