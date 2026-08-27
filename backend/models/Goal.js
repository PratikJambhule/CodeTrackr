const mongoose = require('mongoose');

const goalSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    targetHours: {
        type: Number,
        required: true,
        min: 1
    },
    techStack: {
        type: String,
        trim: true
    },
    deadline: {
        type: Date,
        required: true
    },
    status: {
        type: String,
        enum: ['in-progress', 'completed'],
        default: 'in-progress'
    },
    reminderSent: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

module.exports = mongoose.models.Goal || mongoose.model('Goal', goalSchema);
