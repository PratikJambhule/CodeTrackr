/**
 * Sessionization + session archetypes — pure, dependency-free.
 *
 * A "session" is not stored anywhere: activity lives in 10-minute buckets keyed
 * (userId, projectName, language, bucketStart). Sessions are derived here.
 *
 * TWO THINGS THAT ARE EASY TO GET WRONG, both handled below:
 *
 *   1. One `bucketStart` can have SEVERAL documents — one per
 *      (projectName, language) pair active in that window. Splitting on gaps
 *      before collapsing by `bucketStart` would invent gaps that do not exist.
 *      So: collapse first, split second.
 *
 *   2. Documents written before 2026-09-08 are per-flush and have no
 *      `bucketStart` at all. `timestamp` is the fallback, floored to the bucket
 *      grid so legacy and bucketed data land on the same axis.
 *
 * LIMITS OF THE DATA — do not claim precision beyond these:
 *   - Session boundaries resolve to ±10 minutes (the bucket width).
 *   - `duration` includes idle under 2 minutes, so session length is a slight
 *     over-estimate.
 *   - Since extension 2.3.0 a flush with no signal is never sent, so a gap
 *     between buckets is a real gap rather than "the editor sat open". That is
 *     what makes gap-splitting trustworthy at all.
 */

const BUCKET_MS = 600000;          // 10 minutes — must match activityBucket.js
const SESSION_GAP_MS = 30 * 60000; // a break longer than this starts a new session
const DEEP_BLOCK_MS = 25 * 60000;

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
};

const startMsOf = (doc, bucketMs) => {
    const raw = doc && (doc.bucketStart || doc.timestamp);
    const t = raw instanceof Date ? raw.getTime() : Date.parse(raw);
    if (!Number.isFinite(t)) return null;
    // Floor legacy per-flush timestamps onto the same grid as bucketed docs.
    return Math.floor(t / bucketMs) * bucketMs;
};

/** Collapse every document sharing a bucketStart into one slot. */
function collapseByBucket(docs, bucketMs) {
    const slots = new Map();

    for (const doc of Array.isArray(docs) ? docs : []) {
        const start = startMsOf(doc, bucketMs);
        if (start === null) continue;

        if (!slots.has(start)) {
            slots.set(start, {
                start,
                durationSec: 0,
                linesInserted: 0, linesDeleted: 0, churnLines: 0,
                readMs: 0, writeMs: 0, fileSwitches: 0, undoCount: 0,
                focusedMs: 0, blurEvents: 0, flowBlocksMs: [],
                commits: 0, filesChanged: 0,
                totalCommands: 0, failedCommands: 0, terminalErrorCount: 0,
                buildRuns: 0, failedBuilds: 0, testRuns: 0, debuggingSessions: 0,
                languages: new Set(), projects: new Set(), docCount: 0,
            });
        }
        const s = slots.get(start);
        const e = doc.editorAnalytics || {};
        const f = doc.focusAnalytics || {};
        const g = doc.gitAnalytics || {};
        const t = doc.terminalAnalytics || {};

        s.docCount += 1;
        s.durationSec += num(doc.duration);
        s.linesInserted += num(e.linesInserted);
        s.linesDeleted += num(e.linesDeleted);
        s.churnLines += num(e.churnLines);
        s.readMs += num(e.readMs);
        s.writeMs += num(e.writeMs);
        s.fileSwitches += num(e.fileSwitches);
        s.undoCount += num(e.undoCount);
        s.focusedMs += num(f.focusedMs);
        s.blurEvents += num(f.blurEvents);
        if (Array.isArray(f.flowBlocksMs)) {
            for (const b of f.flowBlocksMs) if (num(b) > 0) s.flowBlocksMs.push(num(b));
        }
        s.commits += num(g.commits);
        s.filesChanged += num(g.filesChanged);
        s.totalCommands += num(t.totalCommands);
        s.failedCommands += num(t.failedCommands);
        s.terminalErrorCount += num(t.terminalErrorCount);
        s.buildRuns += num(t.buildRuns);
        s.failedBuilds += num(t.failedBuilds);
        s.testRuns += num(t.testRuns);
        s.debuggingSessions += num(t.debuggingSessions);
        if (doc.language) s.languages.add(doc.language);
        if (doc.projectName) s.projects.add(doc.projectName);
    }

    return [...slots.values()].sort((a, b) => a.start - b.start);
}

/**
 * Split collapsed slots into sessions on gaps, and derive each session's
 * feature vector.
 *
 * @returns Array<Session>
 */
function sessionize(docs, { gapMs = SESSION_GAP_MS, bucketMs = BUCKET_MS } = {}) {
    const slots = collapseByBucket(docs, bucketMs);
    if (slots.length === 0) return [];

    const groups = [];
    let current = [slots[0]];
    for (let i = 1; i < slots.length; i++) {
        // Gap measured from the END of the previous bucket to the start of this
        // one, so two adjacent buckets are never treated as separated.
        const gap = slots[i].start - (slots[i - 1].start + bucketMs);
        if (gap > gapMs) {
            groups.push(current);
            current = [];
        }
        current.push(slots[i]);
    }
    groups.push(current);

    return groups.map((group) => buildSession(group, bucketMs));
}

function buildSession(slots, bucketMs) {
    const acc = {
        startMs: slots[0].start,
        endMs: slots[slots.length - 1].start + bucketMs,
        bucketCount: slots.length,
        durationSec: 0,
        linesInserted: 0, linesDeleted: 0, churnLines: 0,
        readMs: 0, writeMs: 0, fileSwitches: 0, undoCount: 0,
        focusedMs: 0, blurEvents: 0, flowBlocksMs: [],
        commits: 0, filesChanged: 0,
        totalCommands: 0, failedCommands: 0, terminalErrorCount: 0,
        buildRuns: 0, failedBuilds: 0, testRuns: 0, debuggingSessions: 0,
        languages: [], projects: [],
    };
    const languages = new Set();
    const projects = new Set();

    for (const s of slots) {
        for (const key of [
            'durationSec', 'linesInserted', 'linesDeleted', 'churnLines', 'readMs', 'writeMs',
            'fileSwitches', 'undoCount', 'focusedMs', 'blurEvents', 'commits', 'filesChanged',
            'totalCommands', 'failedCommands', 'terminalErrorCount', 'buildRuns',
            'failedBuilds', 'testRuns', 'debuggingSessions',
        ]) acc[key] += s[key];
        acc.flowBlocksMs.push(...s.flowBlocksMs);
        for (const l of s.languages) languages.add(l);
        for (const p of s.projects) projects.add(p);
    }

    acc.languages = [...languages];
    acc.projects = [...projects];
    acc.spanMs = acc.endMs - acc.startMs;
    acc.deepBlockCount = acc.flowBlocksMs.filter((b) => b >= DEEP_BLOCK_MS).length;
    acc.longestBlockMs = acc.flowBlocksMs.reduce((m, b) => Math.max(m, b), 0);

    acc.features = featureVector(acc);
    const { archetype, reason } = classify(acc, acc.features);
    acc.archetype = archetype;
    acc.archetypeReason = reason;
    return acc;
}

/**
 * Normalised, unit-free session features.
 *
 * Persisted alongside each session deliberately: the classifier below is
 * rule-based (see `classify`), but keeping the vector means clustering can be
 * layered on later without re-deriving history.
 */
function featureVector(s) {
    const attentionMs = s.readMs + s.writeMs;
    const editVolume = s.linesInserted + s.linesDeleted;
    const activeMin = s.durationSec / 60;

    return {
        // ratios, 0..1
        churnRatio: s.linesInserted > 0 ? Math.min(1, s.churnLines / s.linesInserted) : 0,
        readRatio: attentionMs > 0 ? s.readMs / attentionMs : 0,
        buildFailRatio: s.buildRuns > 0 ? Math.min(1, s.failedBuilds / s.buildRuns) : 0,
        commandFailRatio: s.totalCommands > 0 ? Math.min(1, s.failedCommands / s.totalCommands) : 0,
        deepShare: s.flowBlocksMs.length > 0
            ? s.flowBlocksMs.filter((b) => b >= DEEP_BLOCK_MS).reduce((a, b) => a + b, 0)
              / s.flowBlocksMs.reduce((a, b) => a + b, 0)
            : 0,
        // rates, per active minute
        linesPerMin: activeMin > 0 ? editVolume / activeMin : 0,
        commandsPerMin: activeMin > 0 ? s.totalCommands / activeMin : 0,
        switchesPerMin: activeMin > 0 ? s.fileSwitches / activeMin : 0,
        // absolutes kept for thresholds that only make sense unnormalised
        activeMin,
        editVolume,
        debugSessions: s.debuggingSessions,
        commits: s.commits,
    };
}

/** Archetypes, in priority order. */
const ARCHETYPES = ['debug-grind', 'admin-config', 'exploration', 'deep-build', 'mixed'];

/**
 * Rule-based archetype classifier (roadmap #5).
 *
 * Deliberately NOT k-means: with a single user's data, k=4 clusters are
 * unstable between runs and come out unnamed, so they would have to be
 * hand-labelled anyway — and an unexplainable label is worse than none in a
 * product whose whole stance is "every number is explainable". The feature
 * vector is persisted so clustering remains available later, once there is
 * cross-user data to make clusters stable.
 *
 * Thresholds are deliberately conservative: a session that does not clearly
 * match anything is `mixed`, and one with too little signal is `unclassified`.
 */
function classify(session, f) {
    // Too little happened to say anything honest about it.
    if (f.activeMin < 5 || (f.editVolume === 0 && session.totalCommands === 0)) {
        return { archetype: 'unclassified', reason: 'not enough activity to classify' };
    }

    // Debug grind — the tell is failure volume plus little surviving output.
    if (
        (f.debugSessions > 0 || f.buildFailRatio >= 0.5 || session.failedBuilds >= 2) &&
        f.linesPerMin < 4
    ) {
        return {
            archetype: 'debug-grind',
            reason: `${session.failedBuilds} failed build(s), ${f.debugSessions} debug session(s), low net output`,
        };
    }

    // Admin / config — terminal-driven with almost no editing.
    if (session.totalCommands >= 3 && f.editVolume < 10 && f.commandsPerMin >= 0.2) {
        return {
            archetype: 'admin-config',
            reason: `${session.totalCommands} commands with almost no editing`,
        };
    }

    // Exploration — reading and navigating rather than writing.
    if (f.readRatio >= 0.7 && f.linesPerMin < 2 && f.switchesPerMin >= 0.3) {
        return {
            archetype: 'exploration',
            reason: `${Math.round(f.readRatio * 100)}% of attention spent reading, ${session.fileSwitches} file switches`,
        };
    }

    // Deep build — sustained writing that survived, in long stretches.
    if (f.churnRatio <= 0.35 && f.linesPerMin >= 1 && (f.deepShare >= 0.4 || session.deepBlockCount >= 1)) {
        return {
            archetype: 'deep-build',
            reason: `${Math.round((1 - f.churnRatio) * 100)}% of written lines survived, ${session.deepBlockCount} deep block(s)`,
        };
    }

    return { archetype: 'mixed', reason: 'no single pattern dominates' };
}

/** Weekly mix: how many sessions and how much time fell in each archetype. */
function archetypeMix(sessions) {
    const mix = {};
    for (const name of [...ARCHETYPES, 'unclassified']) {
        mix[name] = { sessions: 0, minutes: 0 };
    }
    for (const s of Array.isArray(sessions) ? sessions : []) {
        const key = mix[s.archetype] ? s.archetype : 'unclassified';
        mix[key].sessions += 1;
        mix[key].minutes += Math.round(s.durationSec / 60);
    }
    return mix;
}

module.exports = {
    BUCKET_MS,
    SESSION_GAP_MS,
    DEEP_BLOCK_MS,
    ARCHETYPES,
    sessionize,
    collapseByBucket,
    featureVector,
    classify,
    archetypeMix,
};
