// server.js (migrating-safe version)
// Replaces previous server.js — includes migration to fill missing index fields and merge duplicates.

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
require("dotenv").config();

const app = express();

/* ------------ Config ------------ */
const PORT = process.env.PORT || 5050;
const DB_NAME = process.env.DB_NAME || "codetrackr";

/* ------------ Middleware ------------ */
app.use(helmet());
app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://localhost:5173",
    "https://codetrackr-frontend.vercel.app"
  ],
  methods: ["GET", "POST", "OPTIONS"]
}));
app.use(express.json({ limit: "2mb" }));
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

// ---------- helpers ----------
function toIstIsoString(date) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + IST_OFFSET_MS);
  return istDate.toISOString().replace("Z", "+05:30");
}
function getIstDateString(date) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return ist.toISOString().slice(0, 10); // YYYY-MM-DD
}
function getIstHour(date) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return ist.getHours();
}
function safeFileKey(fileName) {
  if (!fileName) return "unknown";
  try {
    return path.basename(fileName);
  } catch {
    return String(fileName);
  }
}

/* ------------ Schema (includes fields used by existing unique index) ------------ */
const activitySchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },

  // both full filename and smaller "fileKey"
  fileName: { type: String, required: true, index: true },
  fileKey: { type: String, index: true, default: "unknown" },

  // legacy / daily grouping fields (ensure presence so unique index works)
  day: { type: String, index: true, default: null },        // YYYY-MM-DD (IST)
  hour: { type: Number, index: true, default: null },       // 0-23 (IST)
  timestamp: { type: Date, default: null, index: true },    // canonical timestamp

  // optional source (e.g., "vscode")
  source: { type: String, default: "vscode", index: true },

  // cumulative fields and timestamp history
  linesAdded: { type: Number, default: 0 },
  linesRemoved: { type: Number, default: 0 },
  duration: { type: Number, default: 0 },

  // keep track of all timestamps when user worked on this file (history)
  timestamps: [{ type: Date }],

  // optional metadata
  fileType: String,
  projectName: String,
  language: String,

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// create same compound unique index your logs mention.
// We will create it *after* migration to avoid duplicate-key failure.
const Activity = mongoose.models.Activity || mongoose.model("Activity", activitySchema);

/* ------------ Routes (unchanged) ------------ */
app.get("/", (_req, res) => {
  const states = ["disconnected", "connected", "connecting", "disconnecting", "unauthorized", "unknown"];
  res.json({
    status: "ok",
    service: "CodeTrackr API",
    db: states[mongoose.connection.readyState] || mongoose.connection.readyState
  });
});

app.post("/api/user-activity", async (req, res) => {
  console.log("Backend: Received request on /api/user-activity");
  console.log("Backend: Request body:", JSON.stringify(req.body, null, 2));
  try {
    const {
      userId,
      timestamp,
      fileName,
      fileType,
      projectName,
      language,
      linesAdded,
      linesRemoved,
      duration
    } = req.body;

    if (!userId || !fileName) return res.status(400).json({ message: "userId and fileName required" });

    // canonical timestamp for this event (UTC)
    const when = timestamp ? new Date(timestamp) : new Date();
    if (isNaN(when)) return res.status(400).json({ message: "invalid timestamp" });

    // compute fields used in index and storage
    const day = getIstDateString(when);
    const hour = getIstHour(when);
    const source = "vscode";
    const fileKey = safeFileKey(fileName);

    // Try to find an existing exact-bucket document for the same user/day/filekey/hour/timestamp
    // However, we prefer merging per-day-per-file (timestamps array) if an exact match not found.
    // First, prefer a document with same userId + fileName + day:
    let existing = await Activity.findOne({ userId, fileName, day });

    if (existing) {
      // Update existing daily doc
      existing.timestamps = existing.timestamps || [];
      existing.timestamps.push(when);
      existing.linesAdded = (existing.linesAdded || 0) + (Number(linesAdded) || 0);
      existing.linesRemoved = (existing.linesRemoved || 0) + (Number(linesRemoved) || 0);
      existing.duration = (existing.duration || 0) + (Number(duration) || 0);
      existing.fileType = fileType || existing.fileType;
      existing.projectName = projectName || existing.projectName;
      existing.language = language || existing.language;
      existing.timestamp = existing.timestamp || when; // preserve a canonical timestamp if missing
      existing.day = day;
      existing.hour = hour;
      existing.source = source;
      existing.fileKey = fileKey;
      existing.updatedAt = new Date();

      await existing.save();

      console.log("🔁 Updated daily record:", { userId, fileName, day, totalTimestamps: existing.timestamps.length });
      return res.status(200).json({
        message: "updated",
        id: existing._id,
        date: day,
        timestamps: existing.timestamps,
        linesAdded: existing.linesAdded,
        linesRemoved: existing.linesRemoved,
        duration: existing.duration
      });
    }

    // No daily record found — create one
    const doc = new Activity({
      userId,
      fileName,
      fileKey,
      day,
      hour,
      timestamp: when,
      source,
      fileType: fileType || "unknown",
      projectName: projectName || "unknown",
      language: language || "unknown",
      timestamps: [when],
      linesAdded: Number(linesAdded) || 0,
      linesRemoved: Number(linesRemoved) || 0,
      duration: Number(duration) || 0
    });

    await doc.save();

    console.log("💾 New daily record created:", { userId, fileName, day, linesAdded: doc.linesAdded });
    return res.status(201).json({
      message: "created",
      id: doc._id,
      date: day,
      timestamps: doc.timestamps,
      linesAdded: doc.linesAdded,
      linesRemoved: doc.linesRemoved,
      duration: doc.duration
    });

  } catch (err) {
    console.error("❌ save/update failed:", err);
    return res.status(500).json({ message: "save/update failed", error: err.message });
  }
});

app.get("/api/user-stats/:id", async (req, res) => {
  try {
    const activities = await Activity.find({ userId: req.params.id }).sort({ day: -1 });
    res.json(activities);
  } catch (err) {
    res.status(500).json({ message: "fetch failed", error: err.message });
  }
});

app.get("/api/user-stats/:id/summary", async (req, res) => {
  try {
    const userId = req.params.id;
    const totals = await Activity.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          totalDuration: { $sum: "$duration" },
          totalAdded: { $sum: "$linesAdded" },
          totalRemoved: { $sum: "$linesRemoved" },
          sessions: { $sum: 1 }
        }
      }
    ]);
    res.json(totals[0] || {});
  } catch (err) {
    res.status(500).json({ message: "summary failed", error: err.message });
  }
});

/* ------------ Migration helpers (run on startup) ------------ */

async function fillMissingFields() {
  // Find docs that are missing any of the critical fields used by the unique index
  const cursor = Activity.find({
    $or: [
      { day: { $exists: false } }, { day: null },
      { source: { $exists: false } }, { source: null },
      { fileKey: { $exists: false } }, { fileKey: null },
      { hour: { $exists: false } }, { hour: null },
      { timestamp: { $exists: false } }, { timestamp: null }
    ]
  }).cursor();

  let count = 0;
  for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
    try {
      // derive a base timestamp from available fields
      const base = doc.timestamp || doc.createdAt || new Date();
      const when = new Date(base);
      if (isNaN(when)) {
        // fallback to now
        doc.timestamp = new Date();
      } else {
        doc.timestamp = when;
      }

      doc.day = getIstDateString(doc.timestamp);
      doc.hour = getIstHour(doc.timestamp);
      doc.source = doc.source || "vscode";
      doc.fileKey = doc.fileKey || safeFileKey(doc.fileName || doc.fileKey || "unknown");
      doc.timestamps = Array.isArray(doc.timestamps) && doc.timestamps.length ? doc.timestamps : [doc.timestamp];
      doc.updatedAt = new Date();

      await doc.save();
      count++;
    } catch (e) {
      console.warn("Migration: failed to update doc", doc._id, e.message || e);
    }
  }
  console.log(`🛠 Migration fillMissingFields updated ${count} documents (filled null fields).`);
}

async function mergeDuplicateGroups() {
  // Now that every doc should have day/source/fileKey/hour/timestamp, find groups that violate uniqueness
  // Group by the exact unique key
  const pipeline = [
    {
      $group: {
        _id: {
          userId: "$userId",
          day: "$day",
          source: "$source",
          fileKey: "$fileKey",
          hour: "$hour",
          timestamp: "$timestamp"
        },
        ids: { $push: "$_id" },
        docs: { $push: "$$ROOT" },
        count: { $sum: 1 }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ];

  const groups = await Activity.aggregate(pipeline).allowDiskUse(true);
  let mergedCount = 0;

  for (const g of groups) {
    const docs = g.docs;
    // Merge logic: keep one combined doc, sum numeric fields, merge timestamps, pick latest metadata
    const base = docs[0];
    const mergedTimestamps = new Set();
    let totalAdded = 0;
    let totalRemoved = 0;
    let totalDuration = 0;
    let lastMeta = { fileType: base.fileType, projectName: base.projectName, language: base.language, updatedAt: base.updatedAt };

    for (const d of docs) {
      if (Array.isArray(d.timestamps)) d.timestamps.forEach(t => mergedTimestamps.add(new Date(t).toISOString()));
      if (d.timestamp) mergedTimestamps.add(new Date(d.timestamp).toISOString());
      totalAdded += Number(d.linesAdded) || 0;
      totalRemoved += Number(d.linesRemoved) || 0;
      totalDuration += Number(d.duration) || 0;
      if (d.updatedAt && (!lastMeta.updatedAt || new Date(d.updatedAt) > new Date(lastMeta.updatedAt))) {
        lastMeta = { fileType: d.fileType, projectName: d.projectName, language: d.language, updatedAt: d.updatedAt };
      }
    }

    const tsArray = Array.from(mergedTimestamps).map(s => new Date(s)).sort((a,b)=>a-b);

    // Create merged doc payload
    const mergedDoc = {
      userId: g._id.userId,
      fileName: base.fileName,
      fileKey: g._id.fileKey,
      day: g._id.day,
      hour: g._id.hour,
      timestamp: g._id.timestamp,
      source: g._id.source,
      timestamps: tsArray,
      linesAdded: totalAdded,
      linesRemoved: totalRemoved,
      duration: totalDuration,
      fileType: lastMeta.fileType || base.fileType,
      projectName: lastMeta.projectName || base.projectName,
      language: lastMeta.language || base.language,
      createdAt: base.createdAt || new Date(),
      updatedAt: new Date()
    };

    // Insert merged doc, then delete originals
    try {
      const ins = await Activity.collection.insertOne(mergedDoc);
      if (ins.insertedId) {
        await Activity.deleteMany({ _id: { $in: g.ids } });
        mergedCount++;
      }
    } catch (err) {
      // if insertOne fails due to some race condition, try a safe fallback: update first id
      console.warn("Migration merge: insert failed, trying fallback update", err.message || err);
      try {
        const keepId = g.ids[0];
        await Activity.updateOne({ _id: keepId }, { $set: mergedDoc });
        await Activity.deleteMany({ _id: { $in: g.ids.filter(id=>String(id)!==String(keepId)) } });
        mergedCount++;
      } catch (e) {
        console.error("Migration merge fallback also failed for group:", g._id, e.message || e);
      }
    }
  }

  console.log(`🛠 Migration mergeDuplicateGroups processed ${mergedCount} groups.`);
}

/* ------------ DB + Server Boot (with migration) ------------ */
mongoose.set("strictQuery", true);

function redact(uri) {
  try {
    const u = new URL(uri);
    return `mongodb+srv://***:***@${u.host}${u.pathname}`;
  } catch {
    return "<invalid MONGO_URI>";
  }
}

async function start() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("❌ MONGO_URI missing in .env");
    process.exit(1);
  }

  console.log("🧩 Connecting to:", redact(uri));

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 20000,
      dbName: DB_NAME
    });

    console.log("✅ MongoDB connected | DB:", mongoose.connection.name);

    // 1) Migrate/fill missing fields
    await fillMissingFields();

    // 2) Merge duplicates that would break unique index
    await mergeDuplicateGroups();

    // 3) Create/ensure the unique compound index now that data is normalized
    // If index already exists this will be a no-op
    const col = Activity.collection;
    try {
      await col.createIndex(
        { userId: 1, day: 1, source: 1, fileKey: 1, hour: 1, timestamp: 1 },
        { unique: true }
      );
      console.log("🧱 Index ensured: [userId+day+source+fileKey+hour+timestamp] (unique)");
    } catch (idxErr) {
      console.error("❌ Index creation failed (post-migration):", idxErr.message || idxErr);
      // Do not exit — continue, but warn
    }

    // also ensure useful secondary indexes
    await col.createIndex({ userId: 1, fileName: 1 });
    await col.createIndex({ day: 1 });
    await col.createIndex({ projectName: 1 });

    console.log("🧱 Other indexes ensured.");

    // start server
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 API running at http://127.0.0.1:${PORT}`);
    });

  } catch (err) {
    console.error("❌ MongoDB connection error:", err.message || err);
    process.exit(1);
  }
}

start();

/* ------------ Graceful Shutdown ------------ */
process.on("SIGINT", async () => {
  console.log("👋 Shutting down...");
  try { await mongoose.disconnect(); } catch {}
  process.exit(0);
});
