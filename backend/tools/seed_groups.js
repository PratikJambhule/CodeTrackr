require('dotenv').config();
const mongoose = require('mongoose');
const Group = require('../models/Group');
const GroupMember = require('../models/GroupMember');
const User = require('../models/user');

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://pratiksonune7:Pratik123@cluster0.in6d94z.mongodb.net/codetrackr';

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

async function seedGroups() {
  try {
    console.log('Fetching users...');
    const users = await User.find().limit(5);
    
    if (users.length === 0) {
      console.log('No users found in database. Please create some users first.');
      process.exit(1);
    }

    console.log(`Found ${users.length} users`);
    const creator = users[0];

    // Clear existing groups and memberships
    console.log('Clearing existing groups and memberships...');
    await GroupMember.deleteMany({});
    await Group.deleteMany({});

    // Create 4 groups
    const groups = [
      {
        name: 'Full Stack Developers',
        description: 'A community for full stack developers to share knowledge and collaborate on projects.',
        visibility: 'public',
        password: null,
        createdBy: creator._id
      },
      {
        name: 'Python Masters',
        description: 'Advanced Python programmers working on data science and machine learning projects.',
        visibility: 'public',
        password: null,
        createdBy: creator._id
      },
      {
        name: 'Elite Coders Club',
        description: 'Private group for competitive programmers preparing for interviews and contests.',
        visibility: 'private',
        password: 'elite2024',
        createdBy: creator._id
      },
      {
        name: 'Web3 Builders',
        description: 'Building the future of decentralized applications with blockchain technology.',
        visibility: 'private',
        password: 'web3secure',
        createdBy: creator._id
      }
    ];

    console.log('Creating groups...');
    for (const groupData of groups) {
      const group = await Group.create(groupData);
      console.log(`✓ Created group: ${group.name} (${group.visibility})`);

      // Add creator as member
      await GroupMember.create({
        groupId: group._id,
        userId: creator._id
      });
      console.log(`  - Added ${creator.name} as member`);

      // Add random members for first 2 groups (public ones)
      if (group.visibility === 'public' && users.length > 1) {
        const memberCount = Math.min(3, users.length - 1);
        for (let i = 1; i <= memberCount; i++) {
          await GroupMember.create({
            groupId: group._id,
            userId: users[i]._id
          });
          console.log(`  - Added ${users[i].name} as member`);
        }
      }
    }

    console.log('\n✅ Successfully seeded groups!');
    console.log('\nGroup Summary:');
    console.log('- Full Stack Developers (Public) - 4 members');
    console.log('- Python Masters (Public) - 4 members');
    console.log('- Elite Coders Club (Private: elite2024) - 1 member');
    console.log('- Web3 Builders (Private: web3secure) - 1 member');
    
    process.exit(0);
  } catch (error) {
    console.error('Error seeding groups:', error);
    process.exit(1);
  }
}

seedGroups();
