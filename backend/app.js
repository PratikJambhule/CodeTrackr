// app.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require('cookie-parser');
const passport = require('passport');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require("dotenv").config();
const { log } = require('./services/logger');
const { requestId } = require('./middleware/requestId');
const { sessionKey } = require('./services/rateLimitKeys');

// Error reporting is optional (roadmap item 18): nothing is sent anywhere
// unless SENTRY_DSN is set. Once on, every log.error is reported (see
// services/errorReporter.js). Errors are always in the structured logs.
const errorReporter = require('./services/errorReporter');
errorReporter.init();

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required — set it in the environment before starting the API.');
}

const app = express();

// Trust proxy for production (required for secure cookies on Render/Vercel)
app.set("trust proxy", 1);

// Standard security headers (HSTS, nosniff, no X-Powered-By, frameguard).
// CSP is off by default in helmet — the SPA is served from Vercel, not here.
app.use(requestId);
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
  // PATCH was missing until 2026-10-03 (H-23): browsers blocked goal
  // complete/reopen and notification mark-read at the preflight, while every
  // server-side test passed because supertest sends no preflight.
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(passport.initialize());

// Per-IP rate limits on the two abuse-prone surfaces. Skipped in tests.
const rlSkip = () => process.env.NODE_ENV === 'test';
// /auth only starts a Google redirect or receives Google's callback: not a
// guessing surface, and behind the Vercel proxy (H-19) every visitor shares
// Vercel's IPs. The cap is a flood brake, not per-person protection (H-20).
app.use('/auth', rateLimit({
  windowMs: 15 * 60 * 1000, max: 1000, skip: rlSkip,
  standardHeaders: true, legacyHeaders: false,
}));
app.use('/api/extension', rateLimit({
  windowMs: 60 * 1000, max: 120, skip: rlSkip,
  standardHeaders: true, legacyHeaders: false,
}));
// Cap bursts per login session, not per IP: a campus shares one IP and the
// Vercel proxy hides visitors' IPs (H-20). cookieParser has already run.
app.use('/api/analytics', rateLimit({
  windowMs: 60 * 1000, max: 120, skip: rlSkip,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: sessionKey,
}));

// Health
app.get("/", (req, res) => res.json({ status: "ok", service: "CodeTrackr API" }));

// Readiness: 503 when the DB connection isn't usable, so the platform doesn't
// route traffic to a broken instance. `GET /` stays the liveness ping.
app.get("/health", (req, res) => {
  const up = mongoose.connection.readyState === 1;
  res.status(up ? 200 : 503).json({ status: up ? "ok" : "degraded", db: up });
});

// DB. TLS stays on for Atlas; MONGO_TLS=false is only for a local or in-memory
// test server, which does not speak TLS.
mongoose.connect(process.env.MONGO_URI, {
  serverSelectionTimeoutMS: 15000,
  family: 4,
  tls: process.env.MONGO_TLS !== 'false',
})
.then(() => log.info('mongodb connected'))
.catch((err) => log.error('mongodb connection failed', { err }));

require('./config/passport');

// Routes
const analyticsRoutes = require('./routes/analytics');
const leaderboardRoutes = require('./routes/leaderboard');
const goalRoutes = require('./routes/goals');
const groupRoutes = require('./routes/groups');
const userRoutes = require('./routes/user');
const extensionRoutes = require('./routes/extension');
const notificationRoutes = require('./routes/notifications');
const metricsRoutes = require('./routes/metrics');
const authRoutes = require('./routes/auth');
const internalRoutes = require('./routes/internal');
const deviceRoutes = require('./routes/device');

app.use('/api/analytics', analyticsRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/goals', goalRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/user', userRoutes);
app.use('/api/extension', extensionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/auth', authRoutes);
app.use('/api/internal', internalRoutes);
app.use('/api/device', deviceRoutes);

// Central error handler — one place that logs the full error server-side with a
// short correlation id and returns a generic body. Routes call `next(err)`
// instead of echoing `err.message` (which leaked Mongoose/internal detail).
app.use((err, req, res, next) => {
  // Same id as the X-Request-Id header and the access log line for this request.
  const id = req.id || Math.random().toString(36).slice(2, 10);

  // A malformed :id in the path is a client error, not a server fault. Mongoose
  // throws CastError from findById/findOne the moment it cannot coerce the
  // value, so without this every `/api/<thing>/not-an-id` answered 500.
  let status = err.status || err.statusCode || 500;
  let publicMessage = err.publicMessage;
  if (err && err.name === 'CastError') {
    status = 400;
    publicMessage = publicMessage || 'Malformed identifier';
  } else if (err && err.name === 'ValidationError') {
    status = 400;
    publicMessage = publicMessage || 'Invalid request body';
  }

  if (status >= 500) {
    log.error('unhandled error', { requestId: id, method: req.method, path: req.baseUrl + req.path, status, err });
  } else {
    log.warn('request failed', { requestId: id, status, err: err && err.message });
  }

  res.status(status).json({
    error: status === 500 ? 'Internal server error' : (publicMessage || 'Request failed'),
    id,
  });
});


const PORT = process.env.PORT || 5050;

// Only start a server + in-process scheduler when run directly (`node app.js`).
// Under a serverless handler this module is `require`d, so it must have no side
// effects: the schedule is driven externally via POST /api/internal/run-* with
// the INTERNAL_CRON_SECRET header (see IMPROVEMENT_PLAN H-13).
if (require.main === module) {
  // Crashes outside any request (a forgotten await, a timer callback). Log and
  // report them; after an uncaught exception the process state is unknown, so
  // exit and let Render restart it.
  process.on('unhandledRejection', (reason) => {
    log.error('unhandled promise rejection', { err: reason instanceof Error ? reason : new Error(String(reason)) });
  });
  process.on('uncaughtException', (err) => {
    log.error('uncaught exception', { err });
    errorReporter.flush(2000).finally(() => process.exit(1));
  });

  const { initScheduler } = require('./services/notificationScheduler');
  initScheduler();
  app.listen(PORT, () => {
    log.info('server listening', { port: Number(PORT) });
  });
}

module.exports = app;
