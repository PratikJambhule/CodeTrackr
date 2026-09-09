// app.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require('cookie-parser');
const passport = require('passport');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require("dotenv").config();

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required — set it in the environment before starting the API.');
}

const app = express();

// Trust proxy for production (required for secure cookies on Render/Vercel)
app.set("trust proxy", 1);

// Standard security headers (HSTS, nosniff, no X-Powered-By, frameguard).
// CSP is off by default in helmet — the SPA is served from Vercel, not here.
app.use(helmet());

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

// Per-IP rate limits on the two abuse-prone surfaces. Skipped in tests.
const rlSkip = () => process.env.NODE_ENV === 'test';
app.use('/auth', rateLimit({
  windowMs: 15 * 60 * 1000, max: 50, skip: rlSkip,
  standardHeaders: true, legacyHeaders: false,
}));
app.use('/api/extension', rateLimit({
  windowMs: 60 * 1000, max: 120, skip: rlSkip,
  standardHeaders: true, legacyHeaders: false,
}));

// Health
app.get("/", (req, res) => res.json({ status: "ok", service: "CodeTrackr API" }));

// Readiness: 503 when the DB connection isn't usable, so the platform doesn't
// route traffic to a broken instance. `GET /` stays the liveness ping.
app.get("/health", (req, res) => {
  const up = mongoose.connection.readyState === 1;
  res.status(up ? 200 : 503).json({ status: up ? "ok" : "degraded", db: up });
});

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
