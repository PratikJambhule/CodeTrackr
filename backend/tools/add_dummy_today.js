const mongoose = require('mongoose');
const Activity = require('../models/Activity');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI;

async function addDummyData() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB\n');

        // Get your user ID (replace with actual user ID)
        const userId = '691082933d424cbfd997dad8';

        // Create 10 dummy activities spread across different time slots today
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const dummyActivities = [
            // Morning activities (8-10 AM)
            {
                userId: userId,
                fileName: 'Dashboard.tsx',
                fileType: '.tsx',
                projectName: 'CodeTrackr',
                language: 'typescript',
                duration: 900, // 15 minutes
                linesAdded: 45,
                linesRemoved: 12,
                timestamp: new Date(today.getTime() + 8 * 60 * 60 * 1000 + 15 * 60 * 1000),
                date: today.toISOString().split('T')[0]
            },
            {
                userId: userId,
                fileName: 'analytics.js',
                fileType: '.js',
                projectName: 'CodeTrackr',
                language: 'javascript',
                duration: 1200, // 20 minutes
                linesAdded: 78,
                linesRemoved: 23,
                timestamp: new Date(today.getTime() + 9 * 60 * 60 * 1000 + 30 * 60 * 1000),
                date: today.toISOString().split('T')[0]
            },
            // Late morning (10-12 PM)
            {
                userId: userId,
                fileName: 'Leaderboard.tsx',
                fileType: '.tsx',
                projectName: 'CodeTrackr',
                language: 'typescript',
                duration: 600, // 10 minutes
                linesAdded: 32,
                linesRemoved: 8,
                timestamp: new Date(today.getTime() + 10 * 60 * 60 * 1000 + 45 * 60 * 1000),
                date: today.toISOString().split('T')[0]
            },
            {
                userId: userId,
                fileName: 'api.js',
                fileType: '.js',
                projectName: 'CodeTrackr',
                language: 'javascript',
                duration: 1800, // 30 minutes
                linesAdded: 120,
                linesRemoved: 45,
                timestamp: new Date(today.getTime() + 11 * 60 * 60 * 1000 + 20 * 60 * 1000),
                date: today.toISOString().split('T')[0]
            },
            // Afternoon (14-16 PM)
            {
                userId: userId,
                fileName: 'auth.js',
                fileType: '.js',
                projectName: 'CodeTrackr',
                language: 'javascript',
                duration: 1500, // 25 minutes
                linesAdded: 89,
                linesRemoved: 34,
                timestamp: new Date(today.getTime() + 14 * 60 * 60 * 1000 + 10 * 60 * 1000),
                date: today.toISOString().split('T')[0]
            },
            {
                userId: userId,
                fileName: 'Goals.tsx',
                fileType: '.tsx',
                projectName: 'CodeTrackr',
                language: 'typescript',
                duration: 900, // 15 minutes
                linesAdded: 56,
                linesRemoved: 19,
                timestamp: new Date(today.getTime() + 14 * 60 * 60 * 1000 + 50 * 60 * 1000),
                date: today.toISOString().split('T')[0]
            },
            {
                userId: userId,
                fileName: 'styles.css',
                fileType: '.css',
                projectName: 'CodeTrackr',
                language: 'css',
                duration: 600, // 10 minutes
                linesAdded: 28,
                linesRemoved: 5,
                timestamp: new Date(today.getTime() + 15 * 60 * 60 * 1000 + 30 * 60 * 1000),
                date: today.toISOString().split('T')[0]
            },
            // Evening (18-20 PM)
            {
                userId: userId,
                fileName: 'Groups.tsx',
                fileType: '.tsx',
                projectName: 'CodeTrackr',
                language: 'typescript',
                duration: 1200, // 20 minutes
                linesAdded: 67,
                linesRemoved: 22,
                timestamp: new Date(today.getTime() + 18 * 60 * 60 * 1000 + 15 * 60 * 1000),
                date: today.toISOString().split('T')[0]
            },
            {
                userId: userId,
                fileName: 'server.js',
                fileType: '.js',
                projectName: 'CodeTrackr',
                language: 'javascript',
                duration: 1800, // 30 minutes
                linesAdded: 103,
                linesRemoved: 41,
                timestamp: new Date(today.getTime() + 19 * 60 * 60 * 1000 + 0 * 60 * 1000),
                date: today.toISOString().split('T')[0]
            },
            // Late evening (20-22 PM)
            {
                userId: userId,
                fileName: 'Profile.tsx',
                fileType: '.tsx',
                projectName: 'CodeTrackr',
                language: 'typescript',
                duration: 900, // 15 minutes
                linesAdded: 43,
                linesRemoved: 15,
                timestamp: new Date(today.getTime() + 20 * 60 * 60 * 1000 + 45 * 60 * 1000),
                date: today.toISOString().split('T')[0]
            }
        ];

        console.log('📝 Adding 10 dummy activities for today...\n');

        for (const activity of dummyActivities) {
            const created = await Activity.create(activity);
            const timeStr = new Date(activity.timestamp).toLocaleTimeString('en-US', { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
            console.log(`✅ Added: ${activity.fileName} at ${timeStr} (${activity.language})`);
        }

        console.log('\n🎉 Successfully added 10 dummy activities for today!');
        console.log('\nTime slot coverage:');
        console.log('  📊 08:00-10:00: 2 activities (Dashboard, analytics)');
        console.log('  📊 10:00-12:00: 2 activities (Leaderboard, api)');
        console.log('  📊 14:00-16:00: 3 activities (auth, Goals, styles)');
        console.log('  📊 18:00-20:00: 2 activities (Groups, server)');
        console.log('  📊 20:00-22:00: 1 activity (Profile)');
        console.log('\nTotal coding time added: ~2.5 hours');
        console.log('Total lines: ~618 added, ~224 removed\n');

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.connection.close();
        console.log('🔌 Disconnected from MongoDB');
    }
}

addDummyData();
