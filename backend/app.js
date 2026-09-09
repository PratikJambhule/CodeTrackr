// app.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require('cookie-parser');
const passport = require('passport');
require("dotenv").config();

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required — set it in the environment before starting the API.');
}

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
const metricsRoutes = require('./routes/metrics');
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
app.use('/api/metrics', metricsRoutes);
app.use('/auth', authRoutes);


const PORT = process.env.PORT || 5050;

// Initialize notification scheduler
const { initScheduler } = require('./services/notificationScheduler');
initScheduler();

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
