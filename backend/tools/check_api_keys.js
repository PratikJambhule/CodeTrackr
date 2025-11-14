const mongoose = require('mongoose');
const User = require('../models/user');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI;

async function checkApiKeys() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB\n');

        // Get all users
        const users = await User.find({});
        console.log(`📊 Total users: ${users.length}\n`);

        // Check API keys
        console.log('🔑 API Key Status:\n');
        for (const user of users) {
            console.log(`User: ${user.name} (${user.email})`);
            console.log(`  - Google ID: ${user.googleId}`);
            console.log(`  - API Key: ${user.apiKey || '❌ NOT GENERATED'}`);
            console.log(`  - Last Login: ${user.lastLogin}`);
            console.log('');

            // Generate API key if missing
            if (!user.apiKey) {
                console.log('  ⚠️  No API key found. Generating...');
                user.generateApiKey();
                await user.save();
                console.log(`  ✅ Generated API key: ${user.apiKey}\n`);
            }
        }

        console.log('\n✅ API Key Check Complete!');
        
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.connection.close();
        console.log('\n🔌 Disconnected from MongoDB');
    }
}

checkApiKeys();
