import { useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardTitle, EmptyState, ErrorBox, PageHeader, Pill, Skeleton } from '../components/ui';
import { usePractice, useTypeAnalytics } from '../hooks/queries';
import { errorText } from '../api';
import { int, pct, plural } from '../lib/format';
import { ratingAtMonthEnds } from '../lib/linked';
import { RatingOutlook } from './practice/RatingOutlook';
import type { Practice as PracticeData } from '../types';

const LC = 'var(--warn)';
const CF = 'var(--accent)';
const DIFF = { easy: 'var(--good)', medium: 'var(--warn)', hard: 'var(--bad)' } as const;

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card p-4">
      <div className="eyebrow">{label}</div>
      <div className="display mt-1 text-3xl">{value}</div>
      {note && <div className="mt-1 font-mono text-[12px] text-muted">{note}</div>}
    </div>
  );
}

/** Solved per topic on both sites, core interview topics first; gaps marked. */
function Topics({ p }: { p: PracticeData }) {
  const rows = [...p.topics].sort((a, b) => Number(b.core) - Number(a.core) || b.total - a.total);
  const most = Math.max(1, ...rows.map((t) => t.total));
  return (
    <Card className="p-6">
      <CardTitle>Topics</CardTitle>
      <p className="mb-4 text-sm text-muted">
        Problems solved per topic, both sites together. <span style={{ color: LC }}>■</span> LeetCode <span style={{ color: CF }}>■</span> Codeforces. Topics marked{' '}
        <Pill tone="bad">gap</Pill> come up often in placement interviews and have fewer than 5 solved.
      </p>
      <ul className="flex flex-col gap-2 text-sm">
        {rows.map((t) => (
          <li key={t.topic} className="flex items-center gap-3">
            <span className="w-36 flex-none truncate">{t.topic}</span>
            <span className="flex h-3 flex-1 overflow-hidden rounded-full bg-line" title={`LeetCode ${t.leetcode}, Codeforces ${t.codeforces}`}>
              <span style={{ width: `${(t.leetcode / most) * 100}%`, background: LC }} />
              <span style={{ width: `${(t.codeforces / most) * 100}%`, background: CF }} />
            </span>
            <span className="w-10 flex-none text-right font-mono text-[12px]">{t.total}</span>
            <span className="w-28 flex-none text-right font-mono text-[11px] text-muted">
              {t.core && t.total < 5 ? <Pill tone="bad">gap</Pill> : t.cfAcceptance != null ? `${pct(t.cfAcceptance)} accepted` : ''}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted">"Accepted" is the share of Codeforces problems you tried in that topic that you got accepted (shown after 5 tries).</p>
    </Card>
  );
}

/** One week per bar, the count written on top of every bar, every other date underneath. */
function WeekBars({ values, dates, color, label }: { values: number[]; dates: (string | null)[]; color: string; label: string }) {
  const max = Math.max(1, ...values);
  return (
    <figure className="m-0" aria-label={label}>
      <div className="flex h-36 items-end gap-1.5">
        {values.map((v, i) => (
          <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`Week ending ${dates[i] ?? '?'}: ${v}`}>
            <span className={`font-mono text-[11px] ${v ? 'text-ink' : 'text-faint'}`}>{v}</span>
            <div className="w-full rounded-t-md" style={{ height: `${(v / max) * 100}%`, minHeight: v ? 4 : 2, background: v ? color : 'var(--line)' }} />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {dates.map((d, i) => (
          <span key={i} className="min-w-0 flex-1 text-center font-mono text-[10px] text-faint">{i % 2 === 1 || i === dates.length - 1 ? '' : d ? shortDate(d) : ''}</span>
        ))}
      </div>
    </figure>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

/**
 * A small line chart with a labelled scale. Each series is a list of values on the same x positions
 * (null = no value there: the line breaks and no dot is drawn).
 */
function LineChart({ series, xLabels, height = 170, label, markLast = false }: {
  series: { name: string; color: string; values: (number | null)[]; dots?: boolean }[];
  xLabels: string[];
  height?: number;
  label: string;
  markLast?: boolean;
}) {
  // Drawn at the real width, so text stays 11 px and the height fixed on any screen.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0); // 0 until measured: never let the chart widen its column
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const measure = () => setW(Math.max(280, Math.round(el.getBoundingClientRect().width)));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const L = 44; // room for the scale on the left
  const R = markLast ? 52 : 12;
  const T = 10;
  const B = 24;
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  const lo = all.length ? Math.floor((Math.min(...all) - 50) / 100) * 100 : 0;
  const hi = all.length ? Math.ceil((Math.max(...all) + 50) / 100) * 100 : 100;
  const n = Math.max(2, ...series.map((s) => s.values.length));
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (height - T - B);
  const ticks = [lo, Math.round((lo + hi) / 200) * 100, hi];
  const every = Math.max(1, Math.ceil(xLabels.length / 6));
  if (!all.length) return null;
  return (
    <div ref={box} className="w-full min-w-0 overflow-hidden" style={{ height }}>
    {W > 0 && <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} className="block" role="img" aria-label={label}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray="3 4" />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" fontFamily="var(--font-mono, monospace)">{t}</text>
        </g>
      ))}
      {xLabels.map((t, i) => (i % every === 0 || i === xLabels.length - 1) && (
        <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 ? 'end' : 'middle'} fontSize="11" fill="var(--muted)" fontFamily="var(--font-mono, monospace)">{t}</text>
      ))}
      {series.map((s) => {
        // Break the line where a value is missing.
        const parts: string[][] = [[]];
        s.values.forEach((v, i) => { if (v == null) parts.push([]); else parts[parts.length - 1].push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`); });
        const lastIdx = s.values.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0).pop();
        return (
          <g key={s.name}>
            {parts.filter((p) => p.length > 1).map((p, k) => <polyline key={k} points={p.join(' ')} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" />)}
            {s.dots && s.values.map((v, i) => v != null && <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill={s.color} />)}
            {markLast && lastIdx != null && (
              <g>
                <circle cx={x(lastIdx)} cy={y(s.values[lastIdx]!)} r="4.5" fill={s.color} stroke="var(--surface)" strokeWidth="2" />
                <text x={x(lastIdx) + 8} y={y(s.values[lastIdx]!) + 4} fontSize="12" fontWeight="700" fill="var(--ink)">{s.values[lastIdx]}</text>
              </g>
            )}
          </g>
        );
      })}
    </svg>}
    </div>
  );
}

function Weekly({ p }: { p: PracticeData }) {
  const dates = p.weeks.map((w) => w.weekEnd);
  const lc = p.weeks.map((w) => w.leetcodeSubmissions);
  const cf = p.weeks.map((w) => w.codeforcesSolved);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  return (
    <Card className="p-6">
      <CardTitle aside="one bar = one week">Last 12 weeks</CardTitle>
      <p className="mb-5 text-sm text-muted">The number on each bar is that week's count. The dates under the bars are the last day of the week; the right-most bar is this week.</p>
      <div className="grid gap-8 md:grid-cols-2">
        {p.linked.leetcode && (
          <div>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium"><span style={{ color: LC }}>■</span> LeetCode submissions</span>
              <span className="font-mono text-[12px] text-muted">{int(sum(lc))} in 12 weeks</span>
            </div>
            <WeekBars values={lc} dates={dates} color={LC} label="LeetCode submissions per week" />
          </div>
        )}
        {p.linked.codeforces && (
          <div>
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium"><span style={{ color: CF }}>■</span> Codeforces problems solved</span>
              <span className="font-mono text-[12px] text-muted">{int(sum(cf))} in 12 weeks</span>
            </div>
            <WeekBars values={cf} dates={dates} color={CF} label="Codeforces problems solved per week" />
          </div>
        )}
      </div>
      {p.linked.leetcode && <p className="mt-4 text-xs text-muted">LeetCode shares submissions per day (accepted or not), so its bars count attempts; Codeforces bars count problems you got accepted.</p>}
    </Card>
  );
}

function Difficulty({ p }: { p: PracticeData }) {
  const d = p.difficulty;
  const lc = p.leetcodeDifficulty;
  const above = d?.above28d;
  const months = d?.monthly ?? [];
  const yours = ratingAtMonthEnds(p.ratingHistory, months.map((m) => m.month));
  const solvedSomething = months.some((m) => m.avgRating != null);
  const lcTotal = lc ? lc.easy + lc.medium + lc.hard : 0;
  return (
    <Card className="p-6">
      <CardTitle>How hard you practise</CardTitle>
      <div className="grid gap-6 md:grid-cols-2">
        {d && (
          <div className="rounded-xl border border-line p-4">
            <div className="text-sm font-medium">Harder than your level, last 4 weeks (Codeforces)</div>
            {above && above.solvedRated ? (
              <>
                <div className="mt-2 flex items-baseline gap-3">
                  <span className="display text-4xl">{above.aboveRating}</span>
                  <span className="text-sm text-muted">of {plural(above.solvedRated, 'problem')} solved were 100+ above your rating ({d.rating})</span>
                </div>
                <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
                  <span style={{ width: `${(above.share ?? 0) * 100}%`, background: CF }} />
                </div>
                <p className="mt-3 text-xs text-muted">
                  In our study of about 37,000 Codeforces users, solving problems harder than your rating was one of the habits most linked to rating growth. A pattern across
                  people, not a promise for one person.
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted">No rated Codeforces problems solved in the last 4 weeks{d.rating == null ? ', or you are not rated yet' : ''}.</p>
            )}
          </div>
        )}
        {lc && (
          <div className="rounded-xl border border-line p-4">
            <div className="text-sm font-medium">LeetCode, all problems solved by difficulty</div>
            <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-line" role="img" aria-label={`Easy ${lc.easy}, Medium ${lc.medium}, Hard ${lc.hard}`}>
              {lcTotal > 0 && (['easy', 'medium', 'hard'] as const).map((k) => <span key={k} style={{ width: `${(lc[k] / lcTotal) * 100}%`, background: DIFF[k] }} />)}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {(['easy', 'medium', 'hard'] as const).map((k) => (
                <div key={k}>
                  <div className="display text-2xl" style={{ color: DIFF[k] }}>{lc[k]}</div>
                  <div className="font-mono text-[11px] text-muted">{k[0].toUpperCase() + k.slice(1)}</div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">{lcTotal ? `${pct((lc.medium + lc.hard) / lcTotal)} of your LeetCode solves are Medium or Hard.` : 'Nothing solved yet.'}</p>
          </div>
        )}
      </div>

      {d && solvedSomething && (
        <div className="mt-6">
          <div className="text-sm font-medium">Are you practising at your level? Codeforces, last 12 months</div>
          <div className="mb-2 mt-1 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[12px] text-muted">
            <span><span style={{ color: CF }}>━</span> your rating</span>
            <span><span style={{ color: LC }}>●</span> average difficulty of the problems you solved that month</span>
          </div>
          <LineChart
            label="Your Codeforces rating and the average difficulty of the problems you solved, per month"
            xLabels={months.map((m) => monthName(m.month))}
            series={[
              { name: 'rating', color: CF, values: yours },
              { name: 'difficulty', color: LC, values: months.map((m) => m.avgRating), dots: true },
            ]}
          />
          <p className="mt-2 text-xs text-muted">
            Yellow above purple: that month you mostly solved problems harder than your rating. Yellow below: mostly easier ones. Months without a yellow dot had no rated
            problems solved.
          </p>
        </div>
      )}
    </Card>
  );
}

function Contests({ p }: { p: PracticeData }) {
  const cf = p.totals.codeforces;
  const h = p.ratingHistory;
  const lcRating = p.totals.leetcode?.rating;
  if (h.length < 2 && lcRating == null) return null;
  const fmt = (t: number) => { const d = new Date(t * 1000); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
  return (
    <Card className="p-6">
      <CardTitle>Contest ratings</CardTitle>
      <p className="mb-4 text-sm text-muted">The two sites rate contests separately, so they are shown side by side, not added up.</p>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {cf && (
          <div className="min-w-0 rounded-xl border border-line p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium"><span style={{ color: CF }}>■</span> Codeforces rating, contest by contest</span>
              <span className="font-mono text-[12px] text-muted">now {cf.rating ?? '—'}{cf.rank ? ` · ${cf.rank}` : ''} · best ever {cf.maxRating ?? '—'}</span>
            </div>
            {h.length >= 2 ? (
              <>
                <LineChart
                  label={`Codeforces rating over the last ${h.length} contests, from ${fmt(h[0].t)} to ${fmt(h[h.length - 1].t)}`}
                  xLabels={h.map((r) => fmt(r.t))}
                  series={[{ name: 'rating', color: CF, values: h.map((r) => r.rating) }]}
                  markLast
                />
                <p className="mt-1 text-xs text-muted">Each point is one contest ({h.length} shown of {plural(cf.contests, 'contest')}); the left scale is the rating.</p>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted">Fewer than two rated contests so far.</p>
            )}
          </div>
        )}
        {p.linked.leetcode && (
          <div className="rounded-xl border border-line p-4">
            <div className="text-sm font-medium"><span style={{ color: LC }}>■</span> LeetCode contest rating</div>
            <div className="display mt-3 text-4xl">{lcRating ?? '—'}</div>
            <p className="mt-2 text-xs text-muted">{lcRating == null ? 'No LeetCode contests yet.' : 'LeetCode shares only your current contest rating, not its history, so there is no line here.'}</p>
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * Practice analytics (D-61): LeetCode and Codeforces together, next to VS Code DSA time. Plain
 * statistics over the linked public profiles; shown only to you.
 */
export default function Practice() {
  const q = usePractice();
  const dsa = useTypeAnalytics(30);
  return (
    <>
      <PageHeader eyebrow="LeetCode · Codeforces · VS Code" title="Practice">
        Your problem solving across both sites, in one place. Refreshed every night from your public profiles; only you see it.
      </PageHeader>
      {q.isPending && <Skeleton className="h-64" />}
      {q.isError && <ErrorBox message={errorText(q.error)} onRetry={() => q.refetch()} />}
      {q.data && !q.data.linked.leetcode && !q.data.linked.codeforces && (
        <EmptyState title="Link LeetCode or Codeforces to see your practice" action={<Link to="/profile">Link them on your profile</Link>}>
          CodeTrackr reads only your public profile, and you can unlink at any time.
        </EmptyState>
      )}
      {q.data && (q.data.linked.leetcode || q.data.linked.codeforces) && (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Solved" value={int(q.data.totals.solved)} note={`${int(q.data.totals.solved7d)} in the last 7 days`} />
            <Stat label="Codeforces" value={q.data.totals.codeforces?.rating != null ? String(q.data.totals.codeforces.rating) : '—'} note={q.data.totals.codeforces ? q.data.totals.codeforces.rank ?? 'not rated yet' : 'not linked'} />
            <Stat label="LeetCode streak" value={q.data.totals.leetcode ? plural(q.data.totals.leetcode.streak, 'day') : '—'} note={q.data.totals.leetcode ? `${q.data.totals.leetcode.activeDays30} active days in 30` : 'not linked'} />
            <Stat label="DSA in VS Code" value={dsa.data ? `${int(Math.round(dsa.data.groups.dsa.minutes / 60))} h` : '—'} note={dsa.data ? `last 30 days · ${plural(dsa.data.groups.dsa.problemCount, 'problem file')}` : undefined} />
          </div>

          <Card className="p-6">
            <CardTitle>In short</CardTitle>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {!!q.data.strongest.length && <li>Strongest topics: <strong>{q.data.strongest.join(', ')}</strong>.</li>}
              {q.data.gaps.length ? <li>Interview topics with little practice: <strong>{q.data.gaps.join(', ')}</strong>.</li> : <li>Every core interview topic has 5+ solved problems.</li>}
              {q.data.difficulty?.above28d?.share != null && <li>{pct(q.data.difficulty.above28d.share)} of your recent Codeforces solves were above your rating.</li>}
              {q.data.outlook?.eligible && q.data.outlook.range && <li>Rating outlook (ML): likely <strong>{q.data.outlook.range.low}–{q.data.outlook.range.high}</strong> in 12 weeks.</li>}
            </ul>
          </Card>

          <RatingOutlook o={q.data.outlook} linked={q.data.linked.codeforces} />
          <Topics p={q.data} />
          <Weekly p={q.data} />
          <Difficulty p={q.data} />
          <Contests p={q.data} />
          <p className="text-xs text-muted">Topic names differ between the sites, so they are mapped to one list; a problem tagged twice on one site counts once. Codeforces figures come from your last 5,000 submissions.</p>
        </div>
      )}
    </>
  );
}
