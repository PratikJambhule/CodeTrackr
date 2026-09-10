/**
 * Rules engine over the derived metrics.
 *
 * Turns the flat numbers `buildMetrics()` produces into a short list of plain
 * statements. Deliberately NOT a model and NOT an LLM: every finding is a
 * declarative rule with a stated threshold, so it is reproducible, unit
 * testable, and explainable to the person reading it.
 *
 * Dependency-free (no express, no mongoose) so it tests without a database.
 *
 * Three rules govern every finding:
 *
 *  1. NEVER FIRE ON DATA WE DO NOT HAVE. A rule declares `requires: [...]` and
 *     is skipped unless every named metric has a `meta` entry whose confidence
 *     is not 'insufficient'. A name with no meta entry is a programming error,
 *     not a pass -- see ASSERTION below.
 *  2. ALWAYS SHOW THE NUMBERS. Each finding carries `evidence`, the actual
 *     values that tripped the threshold, so the reader can check the claim.
 *  3. SKIPS ARE VISIBLE. `evaluate()` reports what it could not assess and why,
 *     rather than silently returning a short list.
 */

const SEVERITY_RANK = { warning: 0, info: 1, positive: 2 };

/**
 * Metrics that ship a confidence gate in `meta`. Only these may appear in a
 * rule's `requires`.
 *
 * ASSERTION: this list mirrors the `meta` keys built in metricsService.js. When
 * a metric was listed as required but had no meta entry, the guard
 * `confidence !== 'insufficient'` passed vacuously and the rule fired on an
 * unbacked zero. That exact bug shipped once via insightsBaseline's key list;
 * `validateRules()` below makes it a startup failure instead.
 */
const GATED_METRICS = new Set([
    'deepWorkRatio',
    'flowBlocks',
    'volumeStability',
    'activeDaysRatio',
    'truePeakWindow',
    'churnRatio',
    'comprehensionLoad',
    'contextSwitchesPerHour',
    'interruptionsPerHour',
    'estimationCalibration',
]);

/** Read-only view over one metrics payload. */
function makeContext(metrics) {
    const meta = (metrics && metrics.meta) || {};
    return {
        raw: metrics || {},
        value(name) {
            return metrics ? metrics[name] : undefined;
        },
        num(name, fallback = 0) {
            const v = metrics ? Number(metrics[name]) : NaN;
            return Number.isFinite(v) ? v : fallback;
        },
        meta(name) {
            return meta[name];
        },
        confidence(name) {
            return meta[name] ? meta[name].confidence : undefined;
        },
        sampleSize(name) {
            return meta[name] ? meta[name].sampleSize : undefined;
        },
        baseline(name) {
            return meta[name] ? meta[name].baseline : undefined;
        },
        /** Change from the user's own 90-day baseline, or undefined if none. */
        delta(name) {
            return meta[name] ? meta[name].delta : undefined;
        },
        hasBaseline(name) {
            const d = meta[name] ? meta[name].delta : undefined;
            return Number.isFinite(d);
        },
    };
}

const pct = (n) => `${Math.round(n * 100)}%`;
const hour = (h) => `${String(h).padStart(2, '0')}:00`;

/* ------------------------------------------------------------------ *
 * The rules
 * ------------------------------------------------------------------ */

const RULES = [
    {
        id: 'churn-spike',
        category: 'quality',
        severity: 'warning',
        requires: ['churnRatio'],
        evaluate(ctx) {
            const churn = ctx.num('churnRatio');
            const delta = ctx.delta('churnRatio');
            if (!(churn > 0.3)) return null;
            // Only call it a spike against the user's own history.
            if (!Number.isFinite(delta) || delta < 0.1) return null;
            return {
                title: 'You are rewriting more than usual',
                detail: `${pct(churn)} of the lines you wrote in this window were later changed or deleted, against your 90-day norm of ${pct(ctx.baseline('churnRatio'))}. That often means the approach is still being worked out.`,
                evidence: { churnRatio: churn, baseline: ctx.baseline('churnRatio'), delta },
            };
        },
    },
    {
        id: 'churn-low',
        category: 'quality',
        severity: 'positive',
        requires: ['churnRatio'],
        evaluate(ctx) {
            const churn = ctx.num('churnRatio');
            if (ctx.confidence('churnRatio') !== 'high') return null;
            if (churn > 0.15) return null;
            return {
                title: 'Code is landing and staying',
                detail: `Only ${pct(churn)} of what you wrote was reworked, across ${ctx.sampleSize('churnRatio')} inserted lines.`,
                evidence: { churnRatio: churn, linesInserted: ctx.sampleSize('churnRatio') },
            };
        },
    },
    {
        id: 'fragmented-focus',
        category: 'focus',
        severity: 'warning',
        requires: ['contextSwitchesPerHour'],
        evaluate(ctx) {
            const switches = ctx.num('contextSwitchesPerHour');
            if (!(switches > 30)) return null;
            return {
                title: 'Your attention is fragmenting across files',
                detail: `${switches} file switches per focused hour — roughly one every ${Math.max(1, Math.round(60 / switches))} minutes. Long stretches in one file are where the deep blocks come from.`,
                evidence: { contextSwitchesPerHour: switches, focusedHours: ctx.sampleSize('contextSwitchesPerHour') },
            };
        },
    },
    {
        id: 'interruption-heavy',
        category: 'focus',
        severity: 'warning',
        requires: ['interruptionsPerHour'],
        evaluate(ctx) {
            const blurs = ctx.num('interruptionsPerHour');
            if (!(blurs > 10)) return null;
            return {
                title: 'The editor keeps losing focus',
                detail: `The window lost focus ${blurs} times per focused hour. Each one restarts the clock on a flow block.`,
                evidence: { interruptionsPerHour: blurs, focusedHours: ctx.sampleSize('interruptionsPerHour') },
            };
        },
    },
    {
        id: 'deep-work-strong',
        category: 'focus',
        severity: 'positive',
        requires: ['deepWorkRatio'],
        evaluate(ctx) {
            const ratio = ctx.num('deepWorkRatio');
            if (ratio < 0.5) return null;
            const blocks = ctx.raw.flowBlocks || {};
            return {
                title: 'Most of your coding time is deep work',
                detail: `${pct(ratio)} of your flow-block time came in stretches of 25 minutes or more (${blocks.deepBlockCount || 0} of ${blocks.blockCount || 0} blocks).`,
                evidence: { deepWorkRatio: ratio, deepBlockCount: blocks.deepBlockCount, blockCount: blocks.blockCount },
            };
        },
    },
    {
        id: 'deep-work-scarce',
        category: 'focus',
        severity: 'info',
        requires: ['deepWorkRatio'],
        evaluate(ctx) {
            const ratio = ctx.num('deepWorkRatio');
            if (ratio >= 0.15) return null;
            const blocks = ctx.raw.flowBlocks || {};
            return {
                title: 'Your sessions are short and broken up',
                detail: `Only ${pct(ratio)} of your flow-block time reached the 25-minute mark. Your longest single stretch was ${Math.round((blocks.longestMs || 0) / 60000)} minutes.`,
                evidence: { deepWorkRatio: ratio, longestBlockMinutes: Math.round((blocks.longestMs || 0) / 60000), blockCount: blocks.blockCount },
            };
        },
    },
    {
        id: 'peak-window',
        category: 'rhythm',
        severity: 'info',
        requires: ['truePeakWindow'],
        evaluate(ctx) {
            const peak = ctx.value('truePeakWindow');
            if (!peak) return null;
            return {
                title: `You do your best work ${hour(peak.startHour)}–${hour(peak.endHour)}`,
                detail: `That two-hour window scored highest on surviving minutes — time coding, discounted by how much of it was later rewritten — across ${peak.days} separate days.`,
                evidence: { startHour: peak.startHour, endHour: peak.endHour, days: peak.days, score: peak.score },
            };
        },
    },
    {
        id: 'cadence-low',
        category: 'rhythm',
        severity: 'info',
        requires: ['activeDaysRatio'],
        evaluate(ctx) {
            const ratio = ctx.num('activeDaysRatio');
            if (ratio >= 0.3) return null;
            return {
                title: 'You code in bursts rather than regularly',
                detail: `You wrote code on ${pct(ratio)} of the days in this window (${ctx.num('activeDays')} of ${ctx.num('windowDays')}).`,
                evidence: { activeDaysRatio: ratio, activeDays: ctx.num('activeDays'), windowDays: ctx.num('windowDays') },
            };
        },
    },
    {
        id: 'volume-erratic',
        category: 'rhythm',
        severity: 'info',
        requires: ['volumeStability'],
        evaluate(ctx) {
            const stability = ctx.num('volumeStability');
            if (stability >= 0.4) return null;
            return {
                title: 'Your daily volume swings a lot',
                detail: `On the days you did code, the amount varied widely (stability ${stability.toFixed(2)} of 1.00, measured across ${ctx.sampleSize('volumeStability')} active days).`,
                evidence: { volumeStability: stability, activeDays: ctx.sampleSize('volumeStability') },
            };
        },
    },
    {
        id: 'quality-streak',
        category: 'rhythm',
        severity: 'positive',
        // qualityStreak has no confidence gate -- it is a plain count of
        // consecutive days, so there is nothing to be uncertain about.
        requires: [],
        evaluate(ctx) {
            const streak = ctx.num('qualityStreak');
            if (streak < 3) return null;
            return {
                title: `${streak}-day deep-work streak`,
                detail: `You have logged at least one 25-minute stretch on each of the last ${streak} days.`,
                evidence: { qualityStreak: streak },
            };
        },
    },
    {
        id: 'comprehension-heavy',
        category: 'quality',
        severity: 'info',
        requires: ['comprehensionLoad'],
        evaluate(ctx) {
            const load = ctx.num('comprehensionLoad');
            if (load <= 0.7) return null;
            return {
                title: 'This window was mostly reading, not writing',
                detail: `${pct(load)} of your editor attention went to reading rather than typing. Normal when picking up an unfamiliar codebase; worth a look if it persists.`,
                evidence: { comprehensionLoad: load },
            };
        },
    },
    {
        id: 'estimation-under',
        category: 'planning',
        severity: 'info',
        requires: ['estimationCalibration'],
        evaluate(ctx) {
            const cal = ctx.value('estimationCalibration');
            if (!cal || !(cal.factor > 1.25)) return null;
            return {
                title: 'Your goals take longer than you plan for',
                detail: `Across ${cal.sampleSize} completed goal${cal.sampleSize === 1 ? '' : 's'}, the work took a median of ${cal.factor}× your estimate (range ${cal.minFactor}×–${cal.maxFactor}×).`,
                evidence: { factor: cal.factor, minFactor: cal.minFactor, maxFactor: cal.maxFactor, sampleSize: cal.sampleSize },
            };
        },
    },
    {
        id: 'estimation-accurate',
        category: 'planning',
        severity: 'positive',
        requires: ['estimationCalibration'],
        evaluate(ctx) {
            const cal = ctx.value('estimationCalibration');
            if (!cal) return null;
            if (cal.factor < 0.85 || cal.factor > 1.15) return null;
            return {
                title: 'Your time estimates are close',
                detail: `Median outcome was ${cal.factor}× your estimate across ${cal.sampleSize} completed goal${cal.sampleSize === 1 ? '' : 's'}.`,
                evidence: { factor: cal.factor, sampleSize: cal.sampleSize },
            };
        },
    },
];

/* ------------------------------------------------------------------ *
 * Engine
 * ------------------------------------------------------------------ */

/**
 * Fail loudly when a rule requires a metric that carries no confidence gate --
 * otherwise the gate silently passes and the rule fires on unbacked data.
 * Called at module load, so a bad rule cannot reach production.
 */
function validateRules(rules = RULES) {
    const problems = [];
    const seen = new Set();
    for (const rule of rules) {
        if (!rule.id) problems.push('a rule has no id');
        if (seen.has(rule.id)) problems.push(`duplicate rule id: ${rule.id}`);
        seen.add(rule.id);
        if (typeof rule.evaluate !== 'function') problems.push(`${rule.id}: evaluate is not a function`);
        if (!SEVERITY_RANK.hasOwnProperty(rule.severity)) problems.push(`${rule.id}: unknown severity ${rule.severity}`);
        for (const name of rule.requires || []) {
            if (!GATED_METRICS.has(name)) {
                problems.push(`${rule.id}: requires '${name}', which has no confidence gate`);
            }
        }
    }
    return problems;
}

const startupProblems = validateRules();
if (startupProblems.length) {
    throw new Error(`rulesEngine: invalid rule definitions:\n  ${startupProblems.join('\n  ')}`);
}

/**
 * Run the rules over one metrics payload.
 *
 * Returns { findings, skipped }. `findings` is sorted warning -> info ->
 * positive, then by declaration order, and capped at `limit`. `skipped` names
 * the rules that could not be assessed and why, so the UI can say "not enough
 * data yet" instead of implying everything is fine.
 */
function evaluate(metrics, { rules = RULES, limit = 6 } = {}) {
    const ctx = makeContext(metrics);
    const findings = [];
    const skipped = [];

    rules.forEach((rule, index) => {
        const missing = (rule.requires || []).filter(
            (name) => {
                const confidence = ctx.confidence(name);
                return confidence === undefined || confidence === 'insufficient';
            }
        );

        if (missing.length) {
            skipped.push({
                id: rule.id,
                reason: 'insufficient-data',
                metrics: missing,
            });
            return;
        }

        let result;
        try {
            result = rule.evaluate(ctx);
        } catch (err) {
            // One malformed payload must not take out the whole panel.
            skipped.push({ id: rule.id, reason: 'error', message: err.message });
            return;
        }

        if (!result) return;

        findings.push({
            id: rule.id,
            category: rule.category,
            severity: rule.severity,
            title: result.title,
            detail: result.detail,
            evidence: result.evidence || {},
            _order: index,
        });
    });

    findings.sort((a, b) => {
        const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
        return bySeverity !== 0 ? bySeverity : a._order - b._order;
    });

    const capped = findings.slice(0, limit).map(({ _order, ...rest }) => rest);
    return { findings: capped, skipped, totalFindings: findings.length };
}

module.exports = { evaluate, validateRules, makeContext, RULES, GATED_METRICS, SEVERITY_RANK };
