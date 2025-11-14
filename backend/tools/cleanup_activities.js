const mongoose = require('mongoose');
const Activity = require('../models/Activity');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI;

async function cleanup() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        // Get total count before deletion
        const totalBefore = await Activity.countDocuments();
        console.log(`Total activities before: ${totalBefore}`);

        // Delete oldest 60 activities
        const activitiesToDelete = await Activity.find()
            .sort({ timestamp: 1 }) // Sort by oldest first
            .limit(60)
            .select('_id');

        const idsToDelete = activitiesToDelete.map(a => a._id);

        const result = await Activity.deleteMany({ _id: { $in: idsToDelete } });
        console.log(`Deleted ${result.deletedCount} activities`);

        // Get total count after deletion
        const totalAfter = await Activity.countDocuments();
        console.log(`Total activities after: ${totalAfter}`);

        // Show sample of remaining activities
        console.log('\nSample of remaining activities:');
        const samples = await Activity.find().limit(5);
        samples.forEach(activity => {
            console.log(`- User: ${activity.userId}, Project: ${activity.projectName}, Date: ${activity.timestamp}`);
        });

        await mongoose.connection.close();
        console.log('\nCleanup complete!');
    } catch (error) {
        console.error('Error during cleanup:', error);
        process.exit(1);
    }
}

cleanup();
