require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Group = require('../models/Group');
const GroupMember = require('../models/GroupMember');
const User = require('../models/user');

const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB\n');

    const users = await User.find();
    const currentUser = users[0];
    
    console.log(`👤 Checking memberships for: ${currentUser.name} (${currentUser.email})\n`);

    // Find all memberships for current user
    const memberships = await GroupMember.find({ userId: currentUser._id })
      .populate('groupId');

    console.log(`📊 Total memberships: ${memberships.length}\n`);

    if (memberships.length > 0) {
      console.log('Your groups:');
      for (const membership of memberships) {
        if (membership.groupId) {
          console.log(`  ✓ ${membership.groupId.name} (${membership.groupId.visibility})`);
        }
      }
    } else {
      console.log('You are not a member of any groups.');
    }

    console.log('\n---\n');

    // Show all groups
    const allGroups = await Group.find().populate('createdBy', 'name');
    console.log(`📦 Total groups in database: ${allGroups.length}\n`);
    
    console.log('All groups:');
    for (const group of allGroups) {
      const members = await GroupMember.find({ groupId: group._id });
      const isMember = members.some(m => m.userId.toString() === currentUser._id.toString());
      console.log(`  ${isMember ? '✓' : '○'} ${group.name} (${group.visibility}) - ${members.length} members`);
    }

    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
