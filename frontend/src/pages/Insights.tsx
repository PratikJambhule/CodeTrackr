import { useState, type ReactNode } from 'react';
import { RotateCw } from 'lucide-react';
import { errorText } from '../api';
import { useMetrics } from '../hooks/queries';
import { Button, Card, CardTitle, ErrorBox, PageHeader, Pill, Segmented, Skeleton } from '../components/ui';
import { pct, plural } from '../lib/format';
import { hourLabel } from '../lib/calendar';
import type { Finding, MetricMeta, Metrics, Severity } from '../types';

const ARCHETYPE: Record<string, string> = {
  'deep-build': 'Deep build',
  'debug-grind': 'Debug grind',
  exploration: 'Exploration',
  'admin-config': 'Admin / config',
  mixed: 'Mixed',
  unclassified: 'Too short to classify',
};

const SEVERITY: Record<Severity, { label: string; tone: 'warn' | 'good' | 'accent' }> = {
  warning: { label: 'worth a look', tone: 'warn' },
  positive: { label: 'going well', tone: 'good' },
  info: { label: 'note', tone: 'accent' },
};

const minutes = (ms: number) => Math.round(ms / 60000);

/** A headline number that shows "—" and why, instead of a misleading figure. */
function Stat({ title, meta, value, explain, baselineDays }: { title: string; meta?: MetricMeta; value: string; explain: ReactNode; baselineDays?: number }) {
  const insufficient = meta?.confidence === 'insufficient';
  const low = meta?.confidence === 'low';
  const delta = meta?.delta;
  return (
    <Card className="flex flex-col gap-2 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-ink">{title}</h2>
        {low && <Pill title={`Based on only ${meta?.sampleSize} ${meta?.unit}.`}>early</Pill>}
      </div>
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="display text-balance text-[48px]">{insufficient ? '—' : value}</span>
        {!insufficient && typeof delta === 'number' && Math.abs(delta) >= 0.05 && (
          <span className={`font-mono text-[12px] ${delta > 0 ? 'text-good-ink' : 'text-bad-ink'}`} title={`Your ${baselineDays ?? 90}-day usual is ${meta?.baseline}.`}>
            {delta > 0 ? '▲' : '▼'} {Math.abs(Math.round(delta * 100))}% vs your usual
          </span>
        )}
      </div>
      <p className="text-sm text-muted">{insufficient ? `Needs more data: ${meta?.sampleSize ?? 0} ${meta?.unit ?? ''} so far.` : explain}</p>
    </Card>
  );
}

function FindingRow({ f }: { f: Finding }) {
  const s = SEVERITY[f.severity];
  return (
    <li className="flex flex-col gap-1.5 border-t border-line py-4 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={s.tone}>{s.label}</Pill>
        <span className="font-semibold text-ink">{f.title}</span>
      </div>
      <p className="text-sm text-muted">{f.detail}</p>
    </li>
  );
}

function Body({ m, findings, skipped, total }: { m: Metrics; findings: Finding[]; skipped: number; total: number }) {
  const meta = m.meta || {};
  const ok = (k: string) => meta[k]?.confidence !== 'insufficient';
  const peak = m.truePeakWindow;
  const cal = m.estimationCalibration;
  const secondary: [string, string | null, string][] = [
    ['Commits', null, String(m.commits)],
    ['Rework ratio', 'churnRatio', pct(m.churnRatio)],
    ['Time reading', 'comprehensionLoad', pct(m.comprehensionLoad)],
    ['File switches / hr', 'contextSwitchesPerHour', String(m.contextSwitchesPerHour)],
    ['Interruptions / hr', 'contextSwitchesPerHour', String(m.interruptionsPerHour)],
    ['Active days', null, `${m.activeDays} of ${m.windowDays}`],
    ['Focused hours', null, String(m.focusedHours)],
    ['Deep blocks', 'flowBlocks', String(m.flowBlocks.deepBlockCount)],
  ];

  return (
    <>
      <p className="mb-6 text-sm text-muted">
        Based on {m.totalHours} hours across {plural(m.activeDays, 'active day')} in the last {m.windowDays} days. Anything shown as — does not have enough data behind it yet.
      </p>

      <Card className="mb-6 p-5">
        <CardTitle aside="rules over the numbers below, not predictions">What stands out</CardTitle>
        {findings.length ? (
          <ul>
            {findings.map((f) => (
              <FindingRow key={f.id} f={f} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            Nothing worth flagging in this window.{skipped > 0 ? ` ${plural(skipped, 'check')} could not run yet for lack of data.` : ''}
          </p>
        )}
        {total > findings.length && <p className="mt-3 font-mono text-xs text-muted">{total - findings.length} more not shown.</p>}
      </Card>

      <div className="mb-6 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr))]">
        <Stat title="Deep work" meta={meta.deepWorkRatio} baselineDays={m.baselineDays} value={pct(m.deepWorkRatio)} explain="Share of your working time that fell in unbroken stretches of 25 minutes or more." />
        <Stat
          title="Longest focus"
          meta={meta.flowBlocks}
          baselineDays={m.baselineDays}
          value={`${minutes(m.flowBlocks.longestMs)} min`}
          explain={`Your longest unbroken stretch. A typical block is ${minutes(m.flowBlocks.medianMs)} min, across ${plural(m.flowBlocks.blockCount, 'block')}.`}
        />
        <Stat
          title="Steady volume"
          meta={meta.volumeStability}
          baselineDays={m.baselineDays}
          value={pct(m.volumeStability)}
          explain={m.volumeStability >= 0.6 ? 'On the days you code, you put in a similar amount of time.' : 'Your daily time swings a lot between the days you code.'}
        />
        <Stat
          title="Coding cadence"
          meta={meta.activeDaysRatio}
          baselineDays={m.baselineDays}
          value={pct(m.activeDaysRatio)}
          explain={`You coded on ${m.activeDays} of the last ${m.windowDays} days.${m.qualityStreak > 0 ? ` Current streak with a deep block: ${plural(m.qualityStreak, 'day')}.` : ''}`}
        />
        <Stat
          title="Peak window"
          meta={meta.truePeakWindow}
          value={peak ? `${hourLabel(peak.startHour)}–${hourLabel(peak.endHour)}` : '—'}
          explain={peak ? `Your most productive two hours, scored on how much of what you wrote survived, seen on ${plural(peak.days, 'day')}.` : ''}
        />
        <Stat title="Rework" meta={meta.churnRatio} baselineDays={m.baselineDays} value={pct(m.churnRatio)} explain="Share of the lines you wrote that you deleted again within ten minutes. Some is normal; a sustained high figure points at a design problem." />
        <Card className="flex flex-col gap-2 p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-ink">Estimation accuracy</h2>
            {meta.estimationCalibration?.confidence === 'low' && <Pill>early</Pill>}
          </div>
          {cal ? (
            <>
              <span className="display text-balance text-[48px]">{cal.factor}×</span>
              <p className="text-sm text-muted">
                {cal.factor > 1.1 ? `You take about ${cal.factor}× longer than you estimate.` : cal.factor < 0.9 ? 'You finish goals faster than you estimate.' : 'Your estimates are close to reality.'}{' '}
                {cal.sampleSize > 1 ? `Median across ${cal.sampleSize} completed goals, from ${cal.minFactor}× to ${cal.maxFactor}×.` : 'Based on one completed goal: treat it as a first data point.'}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">Set a language or project on a goal and mark it complete from the Goals page. This compares your estimate with the hours you actually logged.</p>
          )}
        </Card>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {secondary.map(([label, key, value]) => (
          <Card key={label} className="p-4">
            <div className="display text-balance text-[32px]">{key && !ok(key) ? '—' : value}</div>
            <div className="mt-1 text-xs text-muted">{label}</div>
          </Card>
        ))}
      </div>

      {m.sessionCount > 0 && (
        <Card className="mb-6 p-5">
          <CardTitle aside={`last ${m.sessionWindowDays} days`}>How you worked: {plural(m.sessionCount, 'session')}</CardTitle>
          <div className="mb-4 flex flex-wrap gap-2">
            {Object.entries(m.archetypeMix)
              .filter(([, v]) => v.sessions > 0)
              .sort((a, b) => b[1].minutes - a[1].minutes)
              .map(([name, v]) => (
                <span key={name} className="rounded-full border border-line bg-surface-2 px-3 py-1 text-sm">
                  {ARCHETYPE[name] ?? name}: {v.sessions} <span className="text-muted">({v.minutes} min)</span>
                </span>
              ))}
          </div>
          <ul className="flex flex-col gap-2">
            {m.recentSessions.slice(0, 6).map((s) => (
              <li key={s.startMs} className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2.5">
                <span className="text-sm">
                  {new Date(s.startMs).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {s.minutes} min ·{' '}
                  <strong>{ARCHETYPE[s.archetype] ?? s.archetype}</strong>
                </span>
                <span className="text-xs text-muted">{s.reason}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Sessions are grouped from your activity with a 30-minute break between them. Activity is recorded in ten-minute blocks, so times are accurate to about ten minutes.
          </p>
        </Card>
      )}

      <p className="text-xs text-muted">These figures are private to you and never appear on a board. Times are in your time zone.</p>
    </>
  );
}

/** Statistics over your own history, each with a confidence level (not AI). */
export default function Insights() {
  const [days, setDays] = useState(30);
  const q = useMetrics(days);
  return (
    <>
      <PageHeader
        eyebrow="Private to you"
        title="Insights"
        actions={
          <>
            <Segmented
              label="Window"
              value={days}
              onChange={setDays}
              options={[
                { value: 7, label: '7 days' },
                { value: 30, label: '30 days' },
                { value: 90, label: '90 days' },
              ]}
            />
            <Button aria-label="Refresh insights" onClick={() => q.refetch()} icon={<RotateCw className={`h-4 w-4 ${q.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />} />
          </>
        }
      >
        Plain statistics over your own coding, compared with your own usual. Every number can be checked.
      </PageHeader>
      {q.isPending ? (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr))]">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorBox message={errorText(q.error)} onRetry={() => q.refetch()} />
      ) : (
        <Body m={q.data.metrics} findings={q.data.insights?.findings ?? []} skipped={q.data.insights?.skipped.length ?? 0} total={q.data.insights?.totalFindings ?? 0} />
      )}
    </>
  );
}
