import { Link } from 'react-router-dom';
import { splitGoals } from '../../lib/goals';
import { Sparkles, Target } from 'lucide-react';
import { useGoalProgress, useGoals, useMetrics } from '../../hooks/queries';
import { Bars, RankedBars, SplitBar } from '../../components/charts/Bars';
import { Ring } from '../../components/charts/Ring';
import { Sparkline } from '../../components/charts/Sparkline';
import type { Tone } from '../../components/charts/tone';
import { Card, CardTitle, EmptyState, Pill, Skeleton } from '../../components/ui';
import { deadlineKey, hoursHm, int, relativeDay } from '../../lib/format';
import type { PeriodView, Severity } from '../../types';

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
                    <code className="truncate font-mono text-[12px] text-ink">{f.command}</code>
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
