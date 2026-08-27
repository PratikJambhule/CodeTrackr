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
      console.log('\n⚠️  Need at least 2 users.');
      process.exit(1);
    }

    // Use second user as creator
    const creator = users[1];
    const currentUser = users[0]; // You - will NOT be added to these groups

    console.log(`\n📝 Creating groups by: ${creator.name}`);
    console.log(`👤 You are: ${currentUser.name}`);
    console.log(`⚠️  You will NOT be added to these groups\n`);

    // Create 3 new public groups
    const newGroups = [
      {
        name: 'Backend Architects',
        description: 'Design scalable backend systems with microservices, REST APIs, GraphQL, and database optimization.',
        visibility: 'public',
        password: null,
        createdBy: creator._id
      },
      {
        name: 'Cloud Computing Experts',
        description: 'AWS, Azure, GCP - Deploy and manage applications in the cloud. Learn serverless and container orchestration.',
        visibility: 'public',
        password: null,
        createdBy: creator._id
      },
      {
        name: 'Open Source Contributors',
        description: 'Contribute to open source projects, learn Git workflows, and collaborate with developers worldwide.',
        visibility: 'public',
        password: null,
        createdBy: creator._id
      }
    ];

    for (const groupData of newGroups) {
      const group = await Group.create(groupData);
      console.log(`✅ Created: ${group.name}`);

      // Add ONLY the creator as member (NOT you!)
      await GroupMember.create({
        groupId: group._id,
        userId: creator._id
      });
      console.log(`   - Added ${creator.name} as member`);

      // Optionally add the third user if exists (but NOT the current user)
      if (users.length > 2) {
        const thirdUser = users[2];
        if (thirdUser._id.toString() !== currentUser._id.toString()) {
          await GroupMember.create({
            groupId: group._id,
            userId: thirdUser._id
          });
          console.log(`   - Added ${thirdUser.name} as member`);
        }
      }
      console.log('');
    }

    console.log('✅ Successfully added 3 public groups!');
    console.log(`\n🎯 These groups will appear in your DISCOVER section only.`);
    console.log(`📍 You (${currentUser.name}) are NOT a member of these groups.`);
    console.log('\nRefresh your Groups page to see them in Discover tab! 🚀');

    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
