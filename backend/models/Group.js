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
    password: {
        type: String,
        default: null
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, { timestamps: true });

const Group = mongoose.model('Group', groupSchema);

module.exports = Group;
