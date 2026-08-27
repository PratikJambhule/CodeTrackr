// app.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require('cookie-parser');
const passport = require('passport');
require("dotenv").config();

const app = express();

// Trust proxy for production (required for secure cookies on Render/Vercel)
app.set("trust proxy", 1);

// CORS: allow requests from frontend (FRONTEND_URL) and local dev ports
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5173', 
  'http://localhost:5173',
  'http://localhost:5174'
];
app.use(cors({
  origin: function(origin, callback) {
    // allow server-to-server or tools with no origin
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    // Reject without error to avoid crashing
    return callback(null, false);
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(passport.initialize());

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
require('./config/passport');

// Routes
const analyticsRoutes = require('./routes/analytics');
const teamRoutes = require('./routes/team');
const leaderboardRoutes = require('./routes/leaderboard');
const goalRoutes = require('./routes/goals');
const groupRoutes = require('./routes/groups');
const userRoutes = require('./routes/user');
const extensionRoutes = require('./routes/extension');
const notificationRoutes = require('./routes/notifications');
const authRoutes = require('./routes/auth');

console.log('📍 Mounting routes...');
app.use('/api/analytics', analyticsRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/goals', goalRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/user', userRoutes);
app.use('/api/extension', extensionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/auth', authRoutes);


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

    // Activity.duration is stored in SECONDS; this endpoint reports minutes.
    const SECONDS_TO_MINUTES = { $divide: ["$duration", 60] };

    // Bucket by the server's local day so the aggregation keys match the
    // local-midnight boundaries computed above.
    const tzMinutes = -now.getTimezoneOffset();
    const tzSign = tzMinutes >= 0 ? "+" : "-";
    const tzAbs = Math.abs(tzMinutes);
    const tz = tzSign
      + String(Math.floor(tzAbs / 60)).padStart(2, "0")
      + ":" + String(tzAbs % 60).padStart(2, "0");
    const dayKey = { $dateToString: { format: "%Y-%m-%d", date: "$timestamp", timezone: tz } };
    const localKey = (d) => d.getFullYear()
      + "-" + String(d.getMonth() + 1).padStart(2, "0")
      + "-" + String(d.getDate()).padStart(2, "0");

    const totals = await ActivityModel.aggregate([
      { $match: { userId } },
      { $group: { _id: null, minutes: { $sum: SECONDS_TO_MINUTES }, sessions: { $sum: 1 } } },
    ]);

    const todayAgg = await ActivityModel.aggregate([
      { $match: { userId, timestamp: { $gte: startOfToday } } },
      { $group: { _id: null, minutes: { $sum: SECONDS_TO_MINUTES }, sessions: { $sum: 1 } } },
    ]);

    const weekly = await ActivityModel.aggregate([
      { $match: { userId, timestamp: { $gte: startOfWeek } } },
      { $group: { _id: dayKey, minutes: { $sum: SECONDS_TO_MINUTES } } },
      { $sort: { _id: 1 } },
    ]);

    const daysBack = 60;
    const since = new Date(startOfToday); since.setDate(since.getDate() - (daysBack - 1));
    const daily = await ActivityModel.aggregate([
      { $match: { userId, timestamp: { $gte: since } } },
      { $group: { _id: dayKey, minutes: { $sum: SECONDS_TO_MINUTES } } },
    ]);
    const map = new Map(daily.map(d => [d._id, d.minutes]));

    // Anchor the streak to today, or yesterday if today has no activity yet,
    // so an in-progress day does not read as a broken streak.
    let streak = 0;
    let offset = (map.get(localKey(startOfToday)) || 0) > 0 ? 0 : 1;
    for (let i = offset; i < daysBack; i++) {
      const d = new Date(startOfToday); d.setDate(d.getDate() - i);
      const mins = map.get(localKey(d)) || 0;
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
