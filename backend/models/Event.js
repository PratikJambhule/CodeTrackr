const mongoose = require('mongoose');

/**
 * A hackathon (plan slice 4, D-71). Teams are ordinary groups with `eventId` set. The person who
 * creates the event is its organiser. Anyone signed in with the link can see it and join a team.
 */
const eventSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    editorRule: { type: String, enum: ['any', 'vscode'], default: 'any' },
    maxTeamSize: { type: Number, default: 4 },
    lastRefreshAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Event', eventSchema);
