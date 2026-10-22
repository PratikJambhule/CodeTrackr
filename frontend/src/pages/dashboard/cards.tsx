import { Link } from 'react-router-dom';
import { splitGoals } from '../../lib/goals';
import { Sparkles, Target } from 'lucide-react';
import { useGoalProgress, useGoals, useMetrics } from '../../hooks/queries';
import { Bars, RankedBars, SplitBar } from '../../components/charts/Bars';
import { Ring } from '../../components/charts/Ring';
import { Sparkline } from '../../components/charts/Sparkline';
import type { Tone } from '../../components/charts/tone';
import { Card, CardTitle, EmptyState, Pill, Skeleton } from '../../components/ui';
import { commandKindLabel, deadlineKey, hm, hoursHm, int, relativeDay } from '../../lib/format';
import type { History, PeriodView, Severity } from '../../types';
import { SPLIT_PARTS } from '../../lib/timeSplit';

export function StatTile({ label, value, note, noteTone = 'muted', spark, sparkTone = 'accent' }: { label: string; value: string; note: string; noteTone?: 'muted' | 'good' | 'bad'; spark?: number[]; sparkTone?: Tone }) {
  const tone = noteTone === 'good' ? 'text-good-ink' : noteTone === 'bad' ? 'text-bad-ink' : 'text-muted';
  return (
    <div className="card flex min-w-0 flex-col gap-1.5 p-4">
      <span className="eyebrow">{label}</span>
      <span className="display text-balance text-[44px] text-ink">{value}</span>
      {spark && spark.length > 1 ? <Sparkline values={spark} tone={sparkTone} /> : <div className="h-[28px]" aria-hidden="true" />}
      <span className={`font-mono text-[12px] ${tone}`}>{note}</span>
    </div>
  );
}

/** Commands and builds, red only for failures (chart kit #9), plus what fails most. */
export function BuildHealth({ view, period }: { view: PeriodView; period: 'today' | 'week' }) {
  const t = view.terminalSummary;
  const usage = Object.entries(t.commandUsage ?? {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const timeline = view.terminalTimeline ?? [];
  const okCmds = Math.max(0, t.totalCommands - t.failedCommands);
  const okBuilds = Math.max(0, t.buildRuns - t.failedBuilds);
  return (
    <Card className="min-w-0 p-5">
      <CardTitle aside={period === 'today' ? 'today' : 'last 7 days'}>Build health</CardTitle>
      {t.totalCommands === 0 && t.buildRuns === 0 ? (
        <p className="text-sm text-muted">No terminal commands recorded {period === 'today' ? 'today' : 'this week'}.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div>
            <div className="mb-2 flex justify-between font-mono text-[12px]">
              <span className="text-ink">{int(t.totalCommands)} commands</span>
              <span className={t.failedCommands ? 'text-bad-ink' : 'text-muted'}>{int(t.failedCommands)} failed</span>
            </div>
            <SplitBar label="Commands" parts={[{ label: 'worked', value: okCmds, color: 'var(--heat-2)' }, { label: 'failed', value: t.failedCommands, color: 'var(--bad)' }]} />
          </div>
          <div>
            <div className="mb-2 flex justify-between font-mono text-[12px]">
              <span className="text-ink">{int(t.buildRuns)} builds</span>
              <span className={t.failedBuilds ? 'text-bad-ink' : 'text-muted'}>{int(t.failedBuilds)} failed</span>
            </div>
            <SplitBar label="Builds" parts={[{ label: 'passed', value: okBuilds, color: 'var(--heat-2)' }, { label: 'failed', value: t.failedBuilds, color: 'var(--bad)' }]} />
          </div>
          {timeline.some((x) => x.success || x.failed) && (
            <Bars
              label="Commands that worked and failed"
              height={90}
              showValues={false}
              items={timeline.map((x, i) => ({
                key: `${x.hour ?? x.day}-${i}`,
                label: x.hour ? String(x.hour).split(':')[0].padStart(2, '0') : String(x.day ?? '').slice(0, 3),
                value: (x.success || 0) + (x.failed || 0),
                title: `${x.hour ?? x.day}: ${x.success || 0} worked, ${x.failed || 0} failed`,
                segments: [
                  { value: x.success || 0, color: 'var(--heat-2)' },
                  { value: x.failed || 0, color: 'var(--bad)' },
                ],
              }))}
            />
          )}
          {t.repeatedFailedCommands?.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">Failed more than once</h3>
              <ul className="flex flex-col gap-1.5">
                {t.repeatedFailedCommands.slice(0, 3).map((f) => (
                  <li key={f.command} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-ink">{commandKindLabel(f.command)}</span>
                    <span className="flex-none font-mono text-[12px] text-bad-ink">{f.count}×</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {usage.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-ink">Most used</h3>
              <RankedBars items={usage.map(([k, v]) => ({ label: k, value: v, display: int(v) }))} />
            </div>
          )}
          <p className="font-mono text-[12px] text-muted">
            {int(t.testRuns)} test runs · {int(t.debuggingSessions)} debug sessions · {int(t.gitActivity?.pushes ?? 0)} pushes
          </p>
        </div>
      )}
    </Card>
  );
}

/** Up to three open goals as rings, soonest deadline first. */
export function GoalsMini() {
  const goals = useGoals();
  // Same rule as the Goals page: long-overdue goals are not "current".
  const open = splitGoals(goals.data ?? []).current.filter((g) => g.status !== 'completed').slice(0, 3);
  const progress = useGoalProgress(open);
  return (
    <Card className="min-w-0 p-5">
      <CardTitle aside={<Link to="/goals">All goals</Link>}>Goals</CardTitle>
      {goals.isPending ? (
        <Skeleton className="h-24" />
      ) : open.length === 0 ? (
        <EmptyState icon={<Target className="h-8 w-8" />} title="No open goals" action={<Link to="/goals">Set a goal</Link>}>
          Pick a language or project and a number of hours to aim for.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-4">
          {open.map((g, i) => {
            const p = progress[i]?.data;
            const ratio = p ? p.currentHours / Math.max(g.targetHours, 0.01) : 0;
            return (
              <li key={g._id} className="flex items-center gap-4">
                <Ring value={ratio} size={52} stroke={7} tone={ratio >= 1 ? 'good' : 'accent'} label={`${Math.round(Math.min(1, ratio) * 100)}% of ${g.title}`}>
                  <span className="font-mono text-[11px] text-ink">{Math.round(Math.min(1, ratio) * 100)}%</span>
                </Ring>
                <div className="min-w-0">
                  <div className="truncate font-semibold text-ink">{g.title}</div>
                  <div className="font-mono text-[12px] text-muted">
                    {p ? `${hoursHm(p.currentHours)} of ${g.targetHours}h` : '…'} · due {relativeDay(deadlineKey(g.deadline))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const SEVERITY: Record<Severity, { label: string; tone: 'warn' | 'good' | 'accent' }> = {
  warning: { label: 'worth a look', tone: 'warn' },
  positive: { label: 'going well', tone: 'good' },
  info: { label: 'note', tone: 'accent' },
};

/** The top rule-engine finding, so insights are one click from the dashboard. */
export function InsightTeaser() {
  const q = useMetrics(30);
  const finding = q.data?.insights?.findings?.[0];
  return (
    <Card className="min-w-0 p-5">
      <CardTitle aside={<Link to="/insights">All insights</Link>}>Insight</CardTitle>
      {q.isPending ? (
        <Skeleton className="h-24" />
      ) : finding ? (
        <div className="flex flex-col gap-2">
          <Pill tone={SEVERITY[finding.severity].tone}>{SEVERITY[finding.severity].label}</Pill>
          <p className="font-semibold text-ink">{finding.title}</p>
          <p className="text-sm text-muted">{finding.detail}</p>
        </div>
      ) : (
        <EmptyState icon={<Sparkles className="h-8 w-8" />} title="Nothing stands out yet">
          Insights appear once there are a few weeks of coding to compare against.
        </EmptyState>
      )}
    </Card>
  );
}


/**
 * Where the last 7 days went (plan W1): writing, reading and running, then the files with the most
 * time. Time from extension versions before 2.6.0 has no split and shows as "Not split".
 */
export function TimeSplitCard({ history, pending }: { history?: History; pending: boolean }) {
  const split = history?.split7d;
  const total = split ? split.writingSec + split.readingSec + split.runningSec + split.otherSec : 0;
  const files = history?.topFiles7d ?? [];
  return (
    <Card className="min-w-0 p-5">
      <CardTitle aside="last 7 days">How you spent it</CardTitle>
      {pending ? (
        <Skeleton className="h-32" />
      ) : total === 0 ? (
        <p className="text-sm text-muted">No coding in the last 7 days.</p>
      ) : (
        <>
          <SplitBar label="Time by kind" parts={SPLIT_PARTS.map((p) => ({ label: p.label, value: split![p.key], color: p.color }))} />
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {SPLIT_PARTS.filter((p) => p.key !== 'otherSec' || split!.otherSec > 0).map((p) => (
              <li key={p.key} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: p.color }} aria-hidden="true" />
                <span className="text-ink">{p.label}</span>
                <span className="ml-auto font-mono text-xs text-muted num">{hm(split![p.key])}</span>
              </li>
            ))}
          </ul>
          {split!.otherSec > 0 && (
            <p className="mt-2 text-xs text-muted">"Not split" is time from extension versions before 2.6.0.</p>
          )}
          <h3 className="mb-3 mt-6 text-sm font-semibold">Top files</h3>
          <RankedBars
            empty="File times appear with extension 2.6.0."
            items={files.slice(0, 5).map((f) => ({ label: f.name, value: f.seconds, display: hm(f.seconds) }))}
          />
        </>
      )}
    </Card>
  );
}
