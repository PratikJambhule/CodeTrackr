require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Group = require('../models/Group');
const GroupMember = require('../models/GroupMember');
const User = require('../models/user');

const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB\n');

    // Get all users
    const users = await User.find();
    console.log(`Found ${users.length} users:`);
    users.forEach((u, idx) => console.log(`  ${idx + 1}. ${u.name} (${u.email})`));

    if (users.length < 2) {
      console.log('\n⚠️  Need at least 2 users. Using first user as creator.');
    }

    // Use second user as creator if available, otherwise first user
    const creator = users[1] || users[0];
    const currentUser = users[0]; // Assuming you're the first user

    console.log(`\n📝 Creating groups by: ${creator.name}`);
    console.log(`👤 You are: ${currentUser.name}\n`);

    // Create 2 public groups
    const newGroups = [
      {
        name: 'JavaScript Ninjas',
        description: 'Master modern JavaScript, React, and Node.js. Build real-world projects together!',
        visibility: 'public',
        password: null,
        createdBy: creator._id
      },
      {
        name: 'DevOps Engineers',
        description: 'Learn Docker, Kubernetes, CI/CD pipelines, and cloud infrastructure.',
        visibility: 'public',
        password: null,
        createdBy: creator._id
      }
    ];

    for (const groupData of newGroups) {
      const group = await Group.create(groupData);
      console.log(`✅ Created: ${group.name}`);

      // Add creator as member
      await GroupMember.create({
        groupId: group._id,
        userId: creator._id
      });
      console.log(`   - Added ${creator.name} as member`);

      // Add other users EXCEPT the current user (you)
      const otherUsers = users.filter(u => u._id.toString() !== currentUser._id.toString());
      if (otherUsers.length > 1) {
        // Add 1-2 random other members
        const membersToAdd = otherUsers.slice(1, 3);
        for (const member of membersToAdd) {
          await GroupMember.create({
            groupId: group._id,
            userId: member._id
          });
          console.log(`   - Added ${member.name} as member`);
        }
      }
      console.log('');
    }

    console.log('✅ Successfully added 2 public groups where you are NOT enrolled!');
    console.log('\nYou can now:');
    console.log('1. Go to Groups → Discover tab');
    console.log('2. See these new groups');
    console.log('3. Click "Join Group" to join them!');

    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
