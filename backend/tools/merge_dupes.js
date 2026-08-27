// tools/merge_dupes.js
require("dotenv").config();
const mongoose = require("mongoose");

const activitySchema = new mongoose.Schema({
  userId: String,
  day: String,
  source: String,
  codingTime: Number,
  date: Date,
}, { timestamps: true });

const Activity = mongoose.model("Activity", activitySchema, "activities");

(async () => {
  const DB_NAME = process.env.DB_NAME || "codetrackr";
  await mongoose.connect(process.env.MONGO_URI, { dbName: DB_NAME });

  console.log("🔎 Scanning for duplicates by {userId, day, source}…");

  const groups = await Activity.aggregate([
    { $group: {
        _id: { userId: "$userId", day: "$day", source: "$source" },
        ids: { $push: { _id: "$_id", codingTime: "$codingTime", date: "$date", createdAt: "$createdAt" } },
        count: { $sum: 1 },
        totalMinutes: { $sum: "$codingTime" },
        lastDate: { $max: "$date" }
    }},
    { $match: { count: { $gt: 1 } } }
  ]);

  console.log(`⚠️ Found ${groups.length} duplicate groups`);

  let updated = 0, removed = 0;

  for (const g of groups) {
    // Keep the newest doc (by createdAt), merge others into it
    const docs = g.ids.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const keeper = docs[0];
    const toss = docs.slice(1);

    // Sum codingTime across all
    const mergedMinutes = g.totalMinutes;

    await Activity.updateOne(
      { _id: keeper._id },
      { $set: { codingTime: mergedMinutes, date: g.lastDate } }
    );

    const toDeleteIds = toss.map(d => d._id);
    if (toDeleteIds.length) {
      await Activity.deleteMany({ _id: { $in: toDeleteIds } });
    }

    updated += 1;
    removed += toDeleteIds.length;
  }

  console.log(`✅ Merged ${updated} keepers, deleted ${removed} extras.`);

  await mongoose.disconnect();
  process.exit(0);
})().catch(err => { console.error("❌ Merge failed:", err); process.exit(1); });
