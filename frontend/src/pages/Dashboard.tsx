import { useMemo, useState } from 'react';
import { Plug } from 'lucide-react';
import { errorText } from '../api';
import { useDayView, useHistory, useWeekView } from '../hooks/queries';
import { Bars, RankedBars } from '../components/charts/Bars';
import { HourStrip } from '../components/charts/HourStrip';
import { YearHeatmap } from '../components/charts/YearHeatmap';
import { ButtonLink, Card, CardTitle, ErrorBox, PageHeader, Segmented, Skeleton } from '../components/ui';
import { addDays, hm, hmCompact, hoursHm, localDateKey, plural } from '../lib/format';
import { streaks } from '../lib/calendar';
import { readStored, writeStored } from '../lib/storage';
import type { Me } from '../types';
import { RaceStrip } from './dashboard/RaceStrip';
import { BuildHealth, GoalsMini, InsightTeaser, StatTile } from './dashboard/cards';
import { TimeSlotDialog } from './dashboard/TimeSlotDialog';

const TARGET_KEY = 'codetrackr.dailyTarget';
const TARGETS = [1, 2, 3, 4, 6];

export default function Dashboard({ user }: { user: Me }) {
  const [period, setPeriod] = useState<'today' | 'week'>('week');
  const [slot, setSlot] = useState<{ start: number; end: number } | null>(null);
  const [target, setTarget] = useState(() => {
    const v = Number(readStored(TARGET_KEY));
    return TARGETS.includes(v) ? v : 2;
  });
  const day = useDayView(user.id);
  const week = useWeekView(user.id);
  const history = useHistory(user.id);
  const today = useMemo(() => new Date(), []);
  const view = period === 'today' ? day : week;

  const derived = useMemo(() => {
    const days = history.data?.days ?? [];
    const byDate = new Map(days.map((d) => [d.date, d.seconds]));
    const sumRange = (fromAgo: number, toAgo: number) => {
      let s = 0;
      for (let i = fromAgo; i <= toAgo; i++) s += byDate.get(localDateKey(addDays(today, -i))) ?? 0;
      return s;
    };
    const lastWeek = sumRange(7, 13);
    const year = days.filter((d) => d.seconds > 0);
    return { lastWeek, streak: streaks(year.map((d) => d.date), today), yearDays: year.length };
  }, [history.data, today]);

  const dateLine = today.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  if (day.isError && week.isError) {
    return (
      <>
        <PageHeader eyebrow={dateLine} title="Dashboard" />
        <ErrorBox message={errorText(day.error)} onRetry={() => { void day.refetch(); void week.refetch(); void history.refetch(); }} />
      </>
    );
  }

  const nothingYet = history.data && history.data.days.length === 0 && week.data && week.data.totalHours === 0;
  const weekSeconds = (week.data?.totalHours ?? 0) * 3600;
  const todaySeconds = (day.data?.totalHours ?? 0) * 3600;
  const weekChange = weekSeconds - derived.lastWeek;
  const hourly = day.data?.dailyActivity ?? [];
  const nowHour = today.getHours();
  let running = 0;
  const todaySpark = hourly.slice(0, nowHour + 1).map((h) => (running += h.hours));
  const t = week.data?.terminalSummary;

  return (
    <>
      <PageHeader
        eyebrow={dateLine}
        title="Dashboard"
        actions={
          <Segmented
            label="Period"
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'week', label: 'This week' },
            ]}
          />
        }
      />

      {nothingYet && (
        <section className="card mb-6 flex flex-wrap items-center gap-5 border-accent p-6">
          <Plug className="h-9 w-9 flex-none text-accent" aria-hidden="true" />
          <div className="min-w-[240px] flex-1">
            <h2 className="text-xl font-semibold">No coding recorded yet</h2>
            <p className="mt-1 text-muted">
              Install the extension and run <span className="font-mono text-[13px] text-ink">CodeTrackr: Sign In</span> in VS Code. Your first summary arrives after about two
              minutes of coding.
            </p>
          </div>
          <ButtonLink to="/onboarding" variant="primary">
            Set up VS Code
          </ButtonLink>
        </section>
      )}

      {/* One 12-column grid, cards paired by height on wide screens (xl): race + insight; the five
          numbers; chart + languages/when-you-code + build health; year + goals. Smaller screens
          stack in reading order. */}
      <div className="grid grid-cols-12 gap-4 xl:grid-flow-row-dense">
      <div className="col-span-12 grid min-w-0 xl:col-span-8">
        <RaceStrip user={user} />
      </div>

      <section aria-label="Your numbers" className="col-span-12 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(180px,100%),1fr))]">
        {day.isPending || week.isPending || history.isPending ? (
          Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[150px]" />)
        ) : (
          <>
            <StatTile
              label="Today"
              value={hm(todaySeconds)}
              spark={todaySpark}
              note={todaySeconds >= target * 3600 ? `target ${target}h · done` : `target ${target}h · ${hm(target * 3600 - todaySeconds)} to go`}
              noteTone={todaySeconds >= target * 3600 ? 'good' : 'muted'}
            />
            <StatTile
              label="This week"
              value={hm(weekSeconds)}
              spark={(week.data?.dailyActivity ?? []).map((d) => d.hours)}
              note={derived.lastWeek || weekSeconds ? `${weekChange >= 0 ? '▲' : '▼'} ${hm(Math.abs(weekChange))} vs the week before` : 'no coding yet'}
              noteTone={weekChange > 0 ? 'good' : weekChange < 0 ? 'bad' : 'muted'}
            />
            <StatTile label="Streak" value={plural(day.data?.streakDays ?? derived.streak.current, 'day')} note={`best ${plural(derived.streak.longest, 'day')}`} />
            <StatTile label="Commits" value={String(history.data?.commits7d ?? 0)} note="last 7 days" />
            <StatTile
              label="Failed builds"
              value={String(t?.failedBuilds ?? 0)}
              note={t?.buildRuns ? `${Math.round(((t.failedBuilds || 0) / t.buildRuns) * 100)}% of ${plural(t.buildRuns, 'build')}` : 'no builds this week'}
              noteTone={t?.failedBuilds ? 'bad' : 'muted'}
            />
          </>
        )}
      </section>

        <Card className="col-span-12 min-w-0 p-5 lg:col-span-8 xl:col-span-5">
          {period === 'week' ? (
            <>
              <CardTitle
                aside={
                  <label className="flex items-center gap-2">
                    <span>daily target</span>
                    <select
                      value={target}
                      onChange={(e) => {
                        setTarget(Number(e.target.value));
                        writeStored(TARGET_KEY, e.target.value);
                      }}
                      className="rounded-md border border-line bg-surface px-1.5 py-1 font-mono text-xs text-ink"
                    >
                      {TARGETS.map((h) => (
                        <option key={h} value={h}>
                          {h}h
                        </option>
                      ))}
                    </select>
                  </label>
                }
              >
                Last 7 days
              </CardTitle>
              {week.isPending ? (
                <Skeleton className="h-[220px]" />
              ) : (
                <Bars
                  label="Hours coded on each of the last 7 days"
                  height={240}
                  goal={{ value: target * 3600, label: `target ${target}h` }}
                  items={(week.data?.dailyActivity ?? []).map((d, i, all) => ({
                    key: d.day,
                    label: d.day.slice(0, 3),
                    value: d.hours * 3600,
                    display: hmCompact(d.hours * 3600),
                    title: `${d.day}: ${hoursHm(d.hours)}`,
                    highlight: i === all.length - 1,
                  }))}
                />
              )}
            </>
          ) : (
            <>
              <CardTitle aside="click an hour for detail">Today, hour by hour</CardTitle>
              {day.isPending ? (
                <Skeleton className="h-[220px]" />
              ) : (
                <Bars
                  label="Minutes coded in each hour today"
                  height={200}
                  onSelect={(i) => setSlot({ start: Math.floor(i / 2) * 2, end: Math.floor(i / 2) * 2 + 2 })}
                  selected={slot ? slot.start : null}
                  items={hourly.map((h, i) => ({
                    key: h.day,
                    label: String(i).padStart(2, '0'),
                    value: h.hours * 3600,
                    display: hmCompact(h.hours * 3600),
                    title: `${String(i).padStart(2, '0')}:00, ${h.hours ? hoursHm(h.hours) : 'no coding'}. Open ${String(Math.floor(i / 2) * 2).padStart(2, '0')}:00 to ${String(Math.floor(i / 2) * 2 + 2).padStart(2, '0')}:00`,
                    highlight: i === nowHour,
                  }))}
                />
              )}
            </>
          )}
        </Card>

        <div className="col-span-12 flex min-w-0 flex-col gap-4 lg:col-span-4 xl:col-span-3 [&>*:last-child]:flex-1">
        <Card className="min-w-0 p-5">
          <CardTitle aside={period === 'today' ? 'today' : 'last 7 days'}>Languages</CardTitle>
          {view.isPending ? (
            <Skeleton className="h-32" />
          ) : (
            <RankedBars
              empty={period === 'today' ? 'No coding yet today.' : 'No coding in the last 7 days.'}
              items={(view.data?.languageBreakdown ?? []).slice(0, 6).map((l) => ({ label: l._id, value: l.hours, display: hoursHm(l.hours) }))}
            />
          )}
          <h2 className="mb-4 mt-7 text-lg font-semibold">Projects</h2>
          {history.isPending ? (
            <Skeleton className="h-24" />
          ) : (
            <RankedBars empty="No projects in the last 7 days." items={(history.data?.projects ?? []).slice(0, 5).map((p) => ({ label: p.name, value: p.seconds, display: hm(p.seconds) }))} />
          )}
        </Card>

          <Card className="min-w-0 p-5">
            <CardTitle aside="last 7 days">When you code</CardTitle>
            {history.isPending ? <Skeleton className="h-24" /> : <HourStrip hours={history.data?.hourOfDay ?? new Array(24).fill(0)} />}
          </Card>
        </div>

        <div className="col-span-12 grid min-w-0 xl:col-span-4">
          {view.data ? <BuildHealth view={view.data} period={period} /> : <Skeleton className="h-80" />}
        </div>

        <Card className="col-span-12 min-w-0 p-5 xl:col-span-8">
          <CardTitle aside={`${derived.yearDays} days coded`}>Your year</CardTitle>
          {history.isPending ? (
            <Skeleton className="h-[150px]" />
          ) : (
            <YearHeatmap days={history.data?.days ?? []} today={today} summary={`${plural(derived.yearDays, 'day')} coded in the last year · longest streak ${plural(derived.streak.longest, 'day')}`} />
          )}
        </Card>

        <div className="col-span-12 grid min-w-0 lg:col-span-6 xl:col-span-4 xl:col-start-9 xl:row-start-1">
          <InsightTeaser />
        </div>

        <div className="col-span-12 grid min-w-0 lg:col-span-6 xl:col-span-4">
          <GoalsMini />
        </div>
      </div>

      <TimeSlotDialog userId={user.id} slot={slot} onClose={() => setSlot(null)} />
    </>
  );
}
