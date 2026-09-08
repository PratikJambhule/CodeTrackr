#!/usr/bin/env node
/**
 * Seed demo activity so the Insights page has something to show.
 *
 * DEMO DATA ONLY — this fabricates activity. Everything it writes is tagged
 * with a DEMO_ marker so `--remove` can delete it cleanly and completely.
 *
 * It generates a deliberately *interesting* 45-day history so each of the five
 * insights has something to say:
 *
 *   deep work ratio      mix of long (30-95 min) and short (4-12 min) blocks
 *   flow blocks          varied lengths, so median and longest differ
 *   consistency          uneven daily totals, plus two rest days a week
 *   true peak window     21:00 is genuinely productive (commits, low churn);
 *                        14:00 is BUSIER but churn-heavy — so "most active"
 *                        and "most productive" resolve to different hours,
 *                        which is the whole point of the metric
 *   estimation accuracy  three completed goals, actual ≈ 1.8x estimate
 *
 * USAGE
 *   node scripts/seed-demo-insights.js --email you@example.com            # dry run
 *   node scripts/seed-demo-insights.js --email you@example.com --apply
 *   node scripts/seed-demo-insights.js --email you@example.com --remove
 */

require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

const args = process.argv.slice(2);
const arg = (name) => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : undefined;
};
const EMAIL = arg('--email');
const APPLY = args.includes('--apply');
const REMOVE = args.includes('--remove');

const DEMO_PREFIX = 'DEMO_';
const PROJECTS = ['DEMO_payments-api', 'DEMO_dashboard-ui', 'DEMO_infra-scripts'];
const LANGUAGES = ['typescript', 'javascript', 'python'];
const DAYS = 45;

const MIN = 60000;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[randInt(0, arr.length - 1)];

/**
 * One flush document. `hour` is local-ish (UTC here); productivity varies by
 * hour so truePeakWindow has a real signal to find.
 */
function buildActivity(userId, dayOffset, hour, blockMs) {
    const when = new Date();
    when.setDate(when.getDate() - dayOffset);
    when.setHours(hour, randInt(0, 59), randInt(0, 59), randInt(1, 999));

    const evening = hour >= 20 && hour <= 22;   // productive: commits, low churn
    const afternoon = hour >= 13 && hour <= 15; // busy but churny

    const linesInserted = randInt(evening ? 40 : 15, evening ? 120 : 60);
    const churnLines = afternoon
        ? Math.round(linesInserted * rand(0.55, 0.85))
        : Math.round(linesInserted * rand(0.03, 0.18));
    const commits = evening && Math.random() < 0.55 ? randInt(1, 3) : (Math.random() < 0.1 ? 1 : 0);

    const durationSeconds = Math.round(blockMs / 1000);
    const writeMs = Math.round(blockMs * rand(0.35, 0.65));
    const readMs = blockMs - writeMs;
    const totalCommands = randInt(0, 6);
    const failedCommands = Math.min(totalCommands, randInt(0, 2));

    return {
        userId: String(userId),
        fileName: `${pick(['index', 'server', 'utils', 'routes', 'model'])}.${pick(['ts', 'js', 'py'])}`,
        fileType: '.ts',
        projectName: pick(PROJECTS),
        language: pick(LANGUAGES),
        duration: durationSeconds,
        linesAdded: linesInserted,
        linesRemoved: Math.round(churnLines * 0.8),
        timestamp: when,
        terminalAnalytics: {
            totalCommands,
            terminalErrorCount: failedCommands,
            successfulCommands: totalCommands - failedCommands,
            failedCommands,
            successRate: totalCommands ? Math.round(((totalCommands - failedCommands) / totalCommands) * 100) : 0,
            buildRuns: Math.random() < 0.25 ? 1 : 0,
            testRuns: Math.random() < 0.3 ? 1 : 0,
            successfulBuilds: Math.random() < 0.2 ? 1 : 0,
            failedBuilds: Math.random() < 0.08 ? 1 : 0,
            buildSuccessRate: 0,
            debuggingSessions: Math.random() < 0.12 ? 1 : 0,
            commandUsage: {
                git: randInt(0, 3), npm: randInt(0, 2), node: randInt(0, 2), python: randInt(0, 1),
                docker: 0, gcc: 0, java: 0, pip: 0, misc: randInt(0, 2)
            },
            gitActivity: { commits, pushes: commits ? 1 : 0, pulls: randInt(0, 1), checkouts: randInt(0, 1), merges: 0, clones: 0 },
            repeatedFailedCommands: [],
            lastCommand: pick(['npm test', 'git status', 'npm run dev', 'node app.js']),
            lastCommandTimestamp: when
        },
        editorAnalytics: {
            charsInserted: linesInserted * randInt(20, 45),
            charsDeleted: churnLines * randInt(18, 40),
            linesInserted,
            linesDeleted: Math.round(churnLines * 0.8),
            churnLines,
            undoCount: afternoon ? randInt(3, 12) : randInt(0, 4),
            redoCount: randInt(0, 3),
            saveCount: randInt(1, 8),
            fileSwitches: afternoon ? randInt(8, 25) : randInt(2, 9),
            uniqueFiles: randInt(1, 6),
            readMs,
            writeMs,
            largeInsertCount: Math.random() < 0.2 ? 1 : 0,
            largeInsertChars: Math.random() < 0.2 ? randInt(90, 400) : 0
        },
        focusAnalytics: {
            focusedMs: blockMs,
            blurredMs: Math.round(blockMs * rand(0.05, 0.3)),
            blurEvents: randInt(0, 4),
            flowBlocksMs: [blockMs],
            longestBlockMs: blockMs
        },
        gitAnalytics: {
            commits,
            filesChanged: commits ? randInt(1, 5) : 0,
            uncommittedFiles: randInt(0, 4),
            uncommittedAgeMs: randInt(0, 6) * 3600000
        }
    };
}

(async () => {
    if (!EMAIL) {
        console.error('Missing --email. Example:\n  node scripts/seed-demo-insights.js --email you@example.com');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
    const Activity = require('../models/Activity');
    const Goal = require('../models/Goal');
    const User = require('../models/user');

    const user = await User.findOne({ email: EMAIL });
    if (!user) {
        console.error(`No user found with email ${EMAIL}.`);
        console.error('Sign in to the dashboard once with that Google account first.');
        await mongoose.disconnect();
        process.exit(1);
    }
    console.log(`user: ${user.name} <${user.email}>  id=${user._id}`);

    const activityFilter = { userId: String(user._id), projectName: { $in: PROJECTS } };
    const goalFilter = { userId: user._id, title: new RegExp('^' + DEMO_PREFIX) };

    const existingActivities = await Activity.countDocuments(activityFilter);
    const existingGoals = await Goal.countDocuments(goalFilter);

    if (REMOVE) {
        console.log(`\nexisting demo activities: ${existingActivities}, demo goals: ${existingGoals}`);
        if (!APPLY) {
            console.log('\nDRY RUN — re-run with --remove --apply to delete.\n');
            await mongoose.disconnect();
            return;
        }
        const a = await Activity.deleteMany(activityFilter);
        const g = await Goal.deleteMany(goalFilter);
        console.log(`\nDeleted ${a.deletedCount} activities and ${g.deletedCount} goals.`);
        await mongoose.disconnect();
        return;
    }

    if (existingActivities > 0) {
        console.log(`\nNOTE: ${existingActivities} demo activities already exist. Run --remove --apply first to avoid duplicates.`);
    }

    // ---- build the dataset ----
    const activities = [];
    for (let day = 0; day < DAYS; day++) {
        const weekday = new Date(Date.now() - day * 86400000).getDay();
        if (weekday === 0 && Math.random() < 0.8) continue;           // most Sundays off
        if (Math.random() < 0.12) continue;                            // occasional day off

        // Deliberately uneven so the consistency score is not a flat 100%.
        const sessions = randInt(2, 6);
        for (let s = 0; s < sessions; s++) {
            const deep = Math.random() < 0.45;
            const blockMs = deep ? rand(28, 95) * MIN : rand(4, 14) * MIN;
            // Afternoon is the busiest stretch; evening is the productive one.
            const hour = Math.random() < 0.45 ? randInt(13, 15) : (Math.random() < 0.6 ? randInt(20, 22) : randInt(9, 18));
            activities.push(buildActivity(user._id, day, hour, Math.round(blockMs)));
        }
    }

    const goals = [
        { title: `${DEMO_PREFIX}Ship payments refactor`, targetHours: 10, techStack: 'typescript' },
        { title: `${DEMO_PREFIX}Rewrite dashboard charts`, targetHours: 6, techStack: 'javascript' },
        { title: `${DEMO_PREFIX}Automate deploy scripts`, targetHours: 4, techStack: 'python' }
    ].map((g) => ({
        ...g,
        userId: user._id,
        description: 'Demo goal created by scripts/seed-demo-insights.js',
        deadline: new Date(Date.now() - randInt(2, 20) * 86400000),
        status: 'completed'
    }));

    const totalHours = activities.reduce((s, a) => s + a.duration, 0) / 3600;
    const deepBlocks = activities.filter((a) => a.focusAnalytics.longestBlockMs >= 25 * MIN).length;

    console.log('\n=== WILL CREATE ===');
    console.log(`activity documents : ${activities.length}  (~${totalHours.toFixed(1)} hours over ${DAYS} days)`);
    console.log(`  deep blocks (>=25m): ${deepBlocks}`);
    console.log(`completed goals    : ${goals.length}`);
    console.log(`tagged projects    : ${PROJECTS.join(', ')}`);
    console.log(`tagged goal titles : ${DEMO_PREFIX}*`);

    if (!APPLY) {
        console.log('\nDRY RUN — nothing written. Re-run with --apply.\n');
        await mongoose.disconnect();
        return;
    }

    await Activity.insertMany(activities);
    await Goal.insertMany(goals);
    console.log(`\nInserted ${activities.length} activities and ${goals.length} goals.`);
    console.log('Remove later with:  node scripts/seed-demo-insights.js --email ' + EMAIL + ' --remove --apply');

    await mongoose.disconnect();
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
