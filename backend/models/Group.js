const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        required: true
    },
    visibility: {
        type: String,
        enum: ['public', 'private'],
        required: true,
        default: 'public'
    },
    // scrypt hash in the form scrypt$<salt>$<hash>. Legacy rows may still hold
    // plaintext; services/passwordHash.js accepts both and routes/groups.js
    // upgrades on the next successful join. Never returned to clients.
    password: {
        type: String,
        default: null,
        select: false
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, { timestamps: true });

const Group = mongoose.model('Group', groupSchema);

module.exports = Group;
