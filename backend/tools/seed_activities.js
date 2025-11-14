require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Activity = require('../models/Activity');
const User = require('../models/user');

async function seedActivities() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        // Get all users
        const users = await User.find({});
        
        if (users.length === 0) {
            console.log('No users found. Please create users first.');
            process.exit(0);
        }

        console.log(`Found ${users.length} users`);

        // Generate random activities for each user
        const activities = [];
        const projects = ['CodeTrackr', 'Portfolio', 'AI-Assistant', 'E-commerce', 'Blog-App'];
        const languages = ['JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust'];
        const fileExtensions = {
            'JavaScript': ['.js', '.jsx'],
            'TypeScript': ['.ts', '.tsx'],
            'Python': ['.py'],
            'Java': ['.java'],
            'Go': ['.go'],
            'Rust': ['.rs']
        };
        
        for (const user of users) {
            // Generate 10-30 random activities per user
            const activityCount = Math.floor(Math.random() * 20) + 10;
            
            for (let i = 0; i < activityCount; i++) {
                const project = projects[Math.floor(Math.random() * projects.length)];
                const language = languages[Math.floor(Math.random() * languages.length)];
                const extensions = fileExtensions[language];
                const extension = extensions[Math.floor(Math.random() * extensions.length)];
                const fileName = `file${i}${extension}`;
                
                // Random date in last 30 days
                const daysAgo = Math.floor(Math.random() * 30);
                const timestamp = new Date();
                timestamp.setDate(timestamp.getDate() - daysAgo);
                
                activities.push({
                    userId: user._id.toString(),
                    fileName: fileName,
                    fileType: extension.slice(1),
                    language: language,
                    duration: Math.floor(Math.random() * 7200) + 300, // 5 min to 2 hours in seconds
                    linesAdded: Math.floor(Math.random() * 500) + 10,
                    linesRemoved: Math.floor(Math.random() * 200) + 5,
                    projectName: project,
                    timestamp: timestamp,
                    date: timestamp
                });
            }
        }

        // Insert activities
        await Activity.insertMany(activities);
        console.log(`✅ Added ${activities.length} activities for ${users.length} users`);
        
        // Show summary per user
        for (const user of users) {
            const userActivities = activities.filter(a => a.userId.toString() === user._id.toString());
            const totalHours = userActivities.reduce((sum, a) => sum + a.duration, 0) / 3600;
            const totalLines = userActivities.reduce((sum, a) => sum + a.linesAdded, 0);
            console.log(`${user.name}: ${userActivities.length} activities, ${totalHours.toFixed(1)} hours, ${totalLines} lines`);
        }

        mongoose.connection.close();
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

seedActivities();
