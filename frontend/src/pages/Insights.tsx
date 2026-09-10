import { useState, useEffect, useCallback } from 'react';
import { Brain, Timer, Activity, Sunrise, Target, RefreshCw, Flame, Repeat } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import GradientText from '../components/GradientText';
import { API_URL } from '../config';

type Confidence = 'insufficient' | 'low' | 'high';

interface MetricMeta {
  confidence: Confidence;
  sampleSize: number;
  unit: string;
}

interface Metrics {
  windowDays: number;
  deepWorkRatio: number;
  flowBlocks: {
    medianMs: number;
    longestMs: number;
    deepBlockCount: number;
    blockCount: number;
    totalMs: number;
  };
  /** Back-compat alias of volumeStability. */
  consistencyIndex: number;
  volumeStability: number;
  activeDaysRatio: number;
  activeDays: number;
  qualityStreak: number;
  truePeakWindow: {
    startHour: number;
    endHour: number;
    score: number;
    minutes: number;
    days: number;
  } | null;
  estimationCalibration: {
    factor: number;
    minFactor: number;
    maxFactor: number;
    sampleSize: number;
  } | null;
  churnRatio: number;
  comprehensionLoad: number;
  contextSwitchesPerHour: number;
  interruptionsPerHour: number;
  commits: number;
  totalHours: number;
  focusedHours: number;
  meta: Record<string, MetricMeta>;
}

const minutes = (ms: number) => Math.round(ms / 60000);
const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;
const fmtHour = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`;

/** Human explanation of why a metric is being withheld. */
const needMoreData = (meta?: MetricMeta) =>
  meta ? `Needs more data — ${meta.sampleSize} of ${meta.unit} so far.` : 'Not enough data yet.';

export default function Insights() {
  const { theme } = useTheme();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const timezone = new Date().getTimezoneOffset();
      const res = await fetch(`${API_URL}/api/metrics?days=${days}&timezone=${timezone}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        setError(
          res.status === 401
            ? 'Please sign in again to view your insights.'
            : 'Could not load your insights.'
        );
        return;
      }
      const data = await res.json();
      setMetrics(data.metrics);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const card = {
    backgroundColor: theme.colors.surface,
    border: `1px solid ${theme.colors.primary}33`,
  };

  if (loading) {
    return (
      <div
        className="flex items-center justify-center min-h-screen transition-colors duration-300"
        style={{ backgroundColor: theme.colors.background }}
      >
        <div className="text-2xl animate-pulse font-semibold" style={{ color: theme.colors.text }}>
          Working out your insights...
        </div>
      </div>
    );
  }

  if (error || !metrics) {
    return (
      <div
        className="flex flex-col items-center justify-center min-h-screen gap-4"
        style={{ backgroundColor: theme.colors.background }}
      >
        <p style={{ color: theme.colors.text }}>{error ?? 'No insights available.'}</p>
        <button
          type="button"
          onClick={fetchMetrics}
          className="cursor-target px-4 py-2 rounded-lg"
          style={{ color: theme.colors.text, border: `1px solid ${theme.colors.primary}55` }}
        >
          Try again
        </button>
      </div>
    );
  }

  const meta = metrics.meta || {};
  const ok = (key: string) => meta[key]?.confidence !== 'insufficient';
  const isLow = (key: string) => meta[key]?.confidence === 'low';

  /** A headline card. Renders "—" + a reason rather than a misleading number. */
  const Stat = ({
    icon,
    title,
    metricKey,
    value,
    explain,
    wide = false,
  }: {
    icon: React.ReactNode;
    title: string;
    metricKey: string;
    value: string;
    explain: string;
    wide?: boolean;
  }) => (
    <div className={`p-5 rounded-xl ${wide ? 'md:col-span-2' : ''}`} style={card}>
      <div className="flex items-center gap-2 mb-1" style={{ color: theme.colors.primary }}>
        {icon}
        <h2 className="font-semibold">{title}</h2>
        {isLow(metricKey) && (
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{
              color: theme.colors.textSecondary,
              border: `1px solid ${theme.colors.textSecondary}55`,
            }}
            title={`Based on only ${meta[metricKey]?.sampleSize} ${meta[metricKey]?.unit}.`}
          >
            early
          </span>
        )}
      </div>
      <p className="text-4xl font-bold" style={{ color: theme.colors.text }}>
        {ok(metricKey) ? value : '—'}
      </p>
      <p className="text-sm mt-2" style={{ color: theme.colors.textSecondary }}>
        {ok(metricKey) ? explain : needMoreData(meta[metricKey])}
      </p>
    </div>
  );

  const peak = metrics.truePeakWindow;
  const cal = metrics.estimationCalibration;

  const secondary = [
    { label: 'Commits', key: null as string | null, value: String(metrics.commits) },
    { label: 'Rework ratio', key: 'churnRatio', value: pct(metrics.churnRatio) },
    { label: 'Time reading', key: 'comprehensionLoad', value: pct(metrics.comprehensionLoad) },
    {
      label: 'File switches / hr',
      key: 'contextSwitchesPerHour',
      value: String(metrics.contextSwitchesPerHour),
    },
    {
      label: 'Interruptions / hr',
      key: 'contextSwitchesPerHour',
      value: String(metrics.interruptionsPerHour),
    },
    { label: 'Active days', key: null, value: `${metrics.activeDays} of ${metrics.windowDays}` },
    { label: 'Focused hours', key: null, value: String(metrics.focusedHours) },
    { label: 'Deep blocks', key: 'flowBlocks', value: String(metrics.flowBlocks.deepBlockCount) },
  ];

  return (
    <div
      className="min-h-screen p-6 transition-colors duration-300"
      style={{ backgroundColor: theme.colors.background }}
    >
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
          <h1 className="text-3xl font-bold" style={{ color: theme.colors.text }}>
            <GradientText animationSpeed={5}>Your Insights</GradientText>
          </h1>
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              aria-label="Time window"
              className="px-3 py-1 rounded-lg text-sm"
              style={{
                backgroundColor: theme.colors.surface,
                color: theme.colors.text,
                border: `1px solid ${theme.colors.primary}55`,
              }}
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <button
              type="button"
              onClick={fetchMetrics}
              aria-label="Refresh insights"
              className="cursor-target p-2 rounded-lg"
              style={{
                color: theme.colors.textSecondary,
                border: `1px solid ${theme.colors.primary}55`,
              }}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        <p className="mb-6 text-sm" style={{ color: theme.colors.textSecondary }}>
          Based on {metrics.totalHours} hours tracked across {metrics.activeDays} active{' '}
          {metrics.activeDays === 1 ? 'day' : 'days'} in the last {metrics.windowDays} days.
          Anything marked <strong>—</strong> does not have enough data behind it yet.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Stat
            icon={<Brain className="w-5 h-5" />}
            title="Deep work"
            metricKey="deepWorkRatio"
            value={pct(metrics.deepWorkRatio)}
            explain="Share of the time you were actually working that fell in unbroken stretches of 25 minutes or more."
          />

          <Stat
            icon={<Timer className="w-5 h-5" />}
            title="Flow blocks"
            metricKey="flowBlocks"
            value={`${minutes(metrics.flowBlocks.longestMs)} min`}
            explain={`Longest unbroken stretch. Typical block ${minutes(
              metrics.flowBlocks.medianMs
            )} min across ${metrics.flowBlocks.blockCount} blocks.`}
          />

          <Stat
            icon={<Activity className="w-5 h-5" />}
            title="Steady volume"
            metricKey="volumeStability"
            value={pct(metrics.volumeStability)}
            explain={
              metrics.volumeStability >= 0.6
                ? 'On the days you code, you put in a similar amount of time.'
                : 'Your daily volume swings a lot between the days you code.'
            }
          />

          <Stat
            icon={<Flame className="w-5 h-5" />}
            title="Coding cadence"
            metricKey="activeDaysRatio"
            value={pct(metrics.activeDaysRatio)}
            explain={`You coded on ${metrics.activeDays} of the last ${metrics.windowDays} days.${
              metrics.qualityStreak > 0
                ? ` Current streak with a deep block: ${metrics.qualityStreak} ${
                    metrics.qualityStreak === 1 ? 'day' : 'days'
                  }.`
                : ''
            }`}
          />

          <Stat
            icon={<Sunrise className="w-5 h-5" />}
            title="Peak window"
            metricKey="truePeakWindow"
            value={peak ? `${fmtHour(peak.startHour)}–${fmtHour(peak.endHour)}` : '—'}
            explain={
              peak
                ? `Your most productive two hours, scored on how much of what you wrote survived rather than on how busy you were. Seen on ${peak.days} separate days.`
                : ''
            }
          />

          <Stat
            icon={<Repeat className="w-5 h-5" />}
            title="Rework"
            metricKey="churnRatio"
            value={pct(metrics.churnRatio)}
            explain="Share of the lines you wrote that you deleted again within ten minutes. Some rework is normal; a sustained high figure usually points at a design problem."
          />

          <div className="p-5 rounded-xl md:col-span-2" style={card}>
            <div className="flex items-center gap-2 mb-1" style={{ color: theme.colors.primary }}>
              <Target className="w-5 h-5" />
              <h2 className="font-semibold">Estimation accuracy</h2>
              {isLow('estimationCalibration') && (
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{
                    color: theme.colors.textSecondary,
                    border: `1px solid ${theme.colors.textSecondary}55`,
                  }}
                >
                  early
                </span>
              )}
            </div>
            {cal ? (
              <>
                <p className="text-4xl font-bold" style={{ color: theme.colors.text }}>
                  {cal.factor}×
                </p>
                <p className="text-sm mt-2" style={{ color: theme.colors.textSecondary }}>
                  {cal.factor > 1.1
                    ? `You take about ${cal.factor}× longer than you estimate.`
                    : cal.factor < 0.9
                    ? 'You finish goals faster than you estimate.'
                    : 'Your estimates are close to reality.'}{' '}
                  {cal.sampleSize > 1
                    ? `Median across ${cal.sampleSize} completed goals, ranging ${cal.minFactor}×–${cal.maxFactor}×.`
                    : 'Based on one completed goal, so treat it as a first data point.'}
                </p>
              </>
            ) : (
              <p className="text-sm mt-2" style={{ color: theme.colors.textSecondary }}>
                Set a tech stack on a goal, then mark it complete from the Goals page. This will
                compare your estimate against the hours actually logged for it while it was open.
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          {secondary.map((item) => (
            <div key={item.label} className="p-4 rounded-xl" style={card}>
              <p className="text-2xl font-bold" style={{ color: theme.colors.text }}>
                {item.key && !ok(item.key) ? '—' : item.value}
              </p>
              <p className="text-xs mt-1" style={{ color: theme.colors.textSecondary }}>
                {item.label}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-6 text-xs" style={{ color: theme.colors.textSecondary }}>
          These figures are private to you and are never shown on the leaderboard. Times are shown
          in your local timezone.
        </p>
      </div>
    </div>
  );
}
