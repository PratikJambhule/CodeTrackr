// app.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const session = require('express-session');
const passport = require('passport');
const cookieParser = require('cookie-parser');
require("dotenv").config();
require('./config/passport'); // Passport configuration

const app = express();

// CORS: allow requests from frontend (FRONTEND_URL) and local dev ports
const allowedOrigins = [process.env.FRONTEND_URL || 'http://localhost:5173', 'http://localhost:5174'];
app.use(cors({
  origin: function(origin, callback) {
    // allow server-to-server or tools with no origin
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    return callback(new Error('CORS policy: This origin is not allowed'), false);
  },
  methods: ["GET", "POST", "OPTIONS"],
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Express session
app.use(session({
  secret: process.env.SESSION_SECRET || 'your_secret_key_codetrackr_2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true if using HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Helper: convert a Date (or date-like) to an ISO string in IST (+05:30)
function toIstIsoString(date) {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d)) return null;
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return ist.toISOString().replace('Z', '+05:30');
}

// Health
app.get("/", (req, res) => res.json({ status: "ok", service: "CodeTrackr API" }));

// DB
mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 15000,
  family: 4,
  tls: true,
})
.then(() => console.log("✅ MongoDB connected"))
.catch((err) => console.error("❌ MongoDB connection error:", err.message));

// Use Activity model from models folder (not duplicated here)
const Activity = require('./models/Activity');

// Routes
const authRoutes = require('./routes/auth');
const analyticsRoutes = require('./routes/analytics');
const teamRoutes = require('./routes/team');
const leaderboardRoutes = require('./routes/leaderboard');
const goalRoutes = require('./routes/goals');
const groupRoutes = require('./routes/groups');
const userRoutes = require('./routes/user');
const extensionRoutes = require('./routes/extension');
const notificationRoutes = require('./routes/notifications');
app.use('/auth', authRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/goals', goalRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/user', userRoutes);
app.use('/api/extension', extensionRoutes);
app.use('/api/notifications', notificationRoutes);


app.post("/api/user-activity", async (req, res) => {
  try {
    // Accept either `codingTime` (old) or `duration` (client).
    const {
      userId,
      codingTime: codingTimeFromBody,
      duration,
      timestamp,
      date: dateFromBody,
      source,
      fileName,
      fileType,
      projectName,
      language,
      linesAdded,
      linesRemoved
    } = req.body || {};

    // prefer explicit codingTime, otherwise use duration
    const activityDuration = typeof codingTimeFromBody === 'number' ? codingTimeFromBody : (typeof duration === 'number' ? duration : null);

    // determine date: prefer timestamp, then date field. If neither provided or invalid, use now.
    let when = timestamp ? new Date(timestamp) : (dateFromBody ? new Date(dateFromBody) : undefined);
    if (!when || isNaN(when)) {
      when = new Date();
    }

    if (!userId || typeof activityDuration !== "number") {
      return res.status(400).json({ message: "userId and numeric codingTime (or duration) required" });
    }
    // Ensure we pass a valid Date for `date` so documents don't end up with `null` which
    // can trigger unique-index duplicate key errors in older deployments.
    const doc = await Activity.create({
      userId,
      duration: activityDuration,
      date: when,
      timestamp: when,
      fileName: fileName || 'unknown',
      fileType,
      projectName,
      language,
      linesAdded: Number(linesAdded) || 0,
      linesRemoved: Number(linesRemoved) || 0
    });
    // Return saved doc info with timestamps converted to IST for client display
    res.status(201).json({
      message: "saved",
      id: doc._id,
      date: toIstIsoString(doc.date),
      createdAt: toIstIsoString(doc.createdAt),
      updatedAt: toIstIsoString(doc.updatedAt)
    });
  } catch (e) { res.status(500).json({ message: "save failed", error: e.message }); }
});

app.get("/api/user-stats/:id", async (req, res) => {
  try {
    const activities = await Activity.find({ userId: req.params.id }).sort({ date: -1 });
    // Convert date fields to IST ISO strings for client-friendly display
    const mapped = activities.map(a => {
      const o = a.toObject ? a.toObject() : Object.assign({}, a);
      o.date = toIstIsoString(o.date);
      o.createdAt = toIstIsoString(o.createdAt);
      o.updatedAt = toIstIsoString(o.updatedAt);
      return o;
    });
    res.json(mapped);
  } catch (e) { res.status(500).json({ message: "fetch failed", error: e.message }); }
});

app.get("/api/user-stats/:id/summary", async (req, res) => {
  try {
    const userId = req.params.id;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday); startOfWeek.setDate(startOfToday.getDate() - 6);

    const ActivityModel = mongoose.model("Activity");

    const totals = await ActivityModel.aggregate([
      { $match: { userId } },
      { $group: { _id: null, minutes: { $sum: "$codingTime" }, sessions: { $sum: 1 } } },
    ]);

    const todayAgg = await ActivityModel.aggregate([
      { $match: { userId, date: { $gte: startOfToday } } },
      { $group: { _id: null, minutes: { $sum: "$codingTime" }, sessions: { $sum: 1 } } },
    ]);

    const weekly = await ActivityModel.aggregate([
      { $match: { userId, date: { $gte: startOfWeek } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } }, minutes: { $sum: "$codingTime" } } },
      { $sort: { _id: 1 } },
    ]);

    const daysBack = 60;
    const since = new Date(startOfToday); since.setDate(since.getDate() - (daysBack - 1));
    const daily = await ActivityModel.aggregate([
      { $match: { userId, date: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } }, minutes: { $sum: "$codingTime" } } },
    ]);
    const map = new Map(daily.map(d => [d._id, d.minutes]));
    let streak = 0;
    for (let i = 0; i < daysBack; i++) {
      const d = new Date(startOfToday); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const mins = map.get(key) || 0;
      if (mins > 0) streak++; else break;
    }

    res.json({
      totals: { minutes: totals[0]?.minutes || 0, sessions: totals[0]?.sessions || 0 },
      today: { minutes: todayAgg[0]?.minutes || 0, sessions: todayAgg[0]?.sessions || 0 },
      last7Days: weekly,
      streakDays: streak
    });
  } catch (e) { res.status(500).json({ message: "summary failed", error: e.message }); }
});

const PORT = process.env.PORT || 5050;

// Initialize notification scheduler
const { initScheduler } = require('./services/notificationScheduler');
initScheduler();

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
