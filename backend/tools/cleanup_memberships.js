require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Group = require('../models/Group');
const GroupMember = require('../models/GroupMember');
const User = require('../models/user');

const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('✅ Connected to MongoDB\n');

    // Get the current user (first user - you)
    const users = await User.find();
    const currentUser = users[0]; // You are the first user
    
    console.log(`👤 Current user: ${currentUser.name} (${currentUser.email})`);

    // Find all groups created by others where you might be a member
    const discoverGroupNames = [
      'JavaScript Ninjas',
      'DevOps Engineers',
      'AI & Machine Learning Hub',
      'Mobile App Developers',
      'Competitive Coders'
    ];

    console.log('\n🔍 Checking memberships in discover groups...\n');

    for (const groupName of discoverGroupNames) {
      const group = await Group.findOne({ name: groupName });
      if (group) {
        // Check if you're a member
        const membership = await GroupMember.findOne({
          groupId: group._id,
          userId: currentUser._id
        });

        if (membership) {
          await GroupMember.deleteOne({ _id: membership._id });
          console.log(`❌ Removed ${currentUser.name} from "${groupName}"`);
        } else {
          console.log(`✓ Not a member of "${groupName}"`);
        }
      }
    }

    console.log('\n✅ Cleanup complete!');
    console.log('\nNow refresh your Groups page:');
    console.log('- My Groups: Only groups you explicitly joined');
    console.log('- Discover: All public groups including the 5 new ones');

    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
