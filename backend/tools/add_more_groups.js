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

    // Create 3 more public groups
    const newGroups = [
      {
        name: 'AI & Machine Learning Hub',
        description: 'Explore deep learning, neural networks, and AI projects. Share research papers and implementations.',
        visibility: 'public',
        password: null,
        createdBy: creator._id
      },
      {
        name: 'Mobile App Developers',
        description: 'Flutter, React Native, Swift, and Kotlin. Build cross-platform and native mobile applications.',
        visibility: 'public',
        password: null,
        createdBy: creator._id
      },
      {
        name: 'Competitive Coders',
        description: 'Solve algorithms, data structures, and prepare for coding interviews. LeetCode, Codeforces, and more!',
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
        // Add 1-2 random other members (skip the creator since already added)
        const nonCreatorUsers = otherUsers.filter(u => u._id.toString() !== creator._id.toString());
        const membersToAdd = nonCreatorUsers.slice(0, 2);
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

    console.log('✅ Successfully added 3 more public groups where you are NOT enrolled!');
    console.log('\nYou can now:');
    console.log('1. Go to Groups → Discover tab');
    console.log('2. See these new groups');
    console.log('3. Click "Join Group" to join them when ready!');

    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
