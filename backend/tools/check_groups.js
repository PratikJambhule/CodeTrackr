require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Group = require('../models/Group');
const GroupMember = require('../models/GroupMember');
const User = require('../models/user');

const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB\n');

    const groups = await Group.find().populate('createdBy', 'name email');
    console.log(`📊 Total groups in database: ${groups.length}\n`);

    for (const group of groups) {
      console.log(`Group: ${group.name}`);
      console.log(`  Visibility: ${group.visibility}`);
      console.log(`  Description: ${group.description}`);
      console.log(`  Created by: ${group.createdBy?.name || 'Unknown'}`);
      
      const members = await GroupMember.find({ groupId: group._id });
      console.log(`  Members: ${members.length}`);
      console.log('---');
    }

    const totalMembers = await GroupMember.countDocuments();
    console.log(`\n👥 Total memberships: ${totalMembers}`);

    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
