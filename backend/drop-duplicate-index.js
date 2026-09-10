// Script to drop the problematic unique index on Activity collection
require('dotenv').config();
const mongoose = require('mongoose');

async function dropDuplicateIndex() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 15000,
            family: 4,
            tls: true,
        });
        console.log('✅ Connected to MongoDB');

        const db = mongoose.connection.db;
        const collection = db.collection('activities');

        // List all indexes
        console.log('\n📋 Current indexes:');
        const indexes = await collection.indexes();
        indexes.forEach(index => {
            console.log(`  - ${index.name}:`, JSON.stringify(index.key));
        });

        // Drop the problematic unique index
        const indexToDrop = 'userId_1_fileName_1_date_1';
        
        try {
            console.log(`\n🗑️  Dropping index: ${indexToDrop}...`);
            await collection.dropIndex(indexToDrop);
            console.log(`✅ Successfully dropped index: ${indexToDrop}`);
        } catch (err) {
            if (err.code === 27) {
                console.log(`⚠️  Index ${indexToDrop} does not exist (already dropped)`);
            } else {
                throw err;
            }
            
        process.exit(0);
    }
}

dropDuplicateIndex();
