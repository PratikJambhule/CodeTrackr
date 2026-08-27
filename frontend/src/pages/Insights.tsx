import { useState, useEffect, useCallback } from 'react';
import { Brain, Timer, Activity, Sunrise, Target, RefreshCw } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import GradientText from '../components/GradientText';
import { API_URL } from '../config';

interface Metrics {
  windowDays: number;
  deepWorkRatio: number;
  flowBlocks: { medianMs: number; longestMs: number; deepBlockCount: number; blockCount: number };
  consistencyIndex: number;
  truePeakWindow: { hour: number; score: number } | null;
  estimationCalibration: { factor: number; sampleSize: number } | null;
  churnRatio: number;
  comprehensionLoad: number;
  contextSwitchesPerHour: number;
  commits: number;
  totalHours: number;
}

const minutes = (ms: number) => Math.round(ms / 60000);

const hourLabel = (hour: number) => {
  const start = ((hour % 24) + 24) % 24;
  const end = (start + 1) % 24;
  const fmt = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return `${fmt(start)}–${fmt(end)}`;
};

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

  // Focus data only exists from extension 2.1.0 onward. Showing a confident
  // 0% to someone who simply has not upgraded would be misleading.
  const hasFocusData = metrics.flowBlocks.blockCount > 0;

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
          Based on {metrics.totalHours} hours tracked over the last {metrics.windowDays} days.
        </p>

        {!hasFocusData && (
          <div
            className="mb-6 p-4 rounded-xl"
            style={{ ...card, border: `1px solid ${theme.colors.primary}66` }}
          >
            <p style={{ color: theme.colors.text }}>
              Focus and flow metrics need CodeTrackr <strong>2.1.0 or newer</strong>. Update the
              extension and they will start filling in — the other insights below work already.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 1. Deep work ratio */}
          <div className="p-5 rounded-xl" style={card}>
            <div className="flex items-center gap-2 mb-1" style={{ color: theme.colors.primary }}>
              <Brain className="w-5 h-5" />
              <h2 className="font-semibold">Deep work</h2>
            </div>
            <p className="text-4xl font-bold" style={{ color: theme.colors.text }}>
              {hasFocusData ? `${Math.round(metrics.deepWorkRatio * 100)}%` : '—'}
            </p>
            <p className="text-sm mt-2" style={{ color: theme.colors.textSecondary }}>
              {hasFocusData
                ? 'Share of your focused time spent in unbroken stretches of 25 minutes or more.'
                : 'Waiting for data from extension 2.1.0.'}
            </p>
          </div>

          {/* 2. Flow blocks */}
          <div className="p-5 rounded-xl" style={card}>
            <div className="flex items-center gap-2 mb-1" style={{ color: theme.colors.primary }}>
              <Timer className="w-5 h-5" />
              <h2 className="font-semibold">Flow blocks</h2>
            </div>
            <p className="text-4xl font-bold" style={{ color: theme.colors.text }}>
              {hasFocusData ? `${minutes(metrics.flowBlocks.longestMs)} min` : '—'}
            </p>
            <p className="text-sm mt-2" style={{ color: theme.colors.textSecondary }}>
              {hasFocusData
                ? `Longest unbroken stretch. Typical block ${minutes(
                    metrics.flowBlocks.medianMs
                  )} min across ${metrics.flowBlocks.blockCount} sessions.`
                : 'Waiting for data from extension 2.1.0.'}
            </p>
          </div>

          {/* 3. Consistency */}
          <div className="p-5 rounded-xl" style={card}>
            <div className="flex items-center gap-2 mb-1" style={{ color: theme.colors.primary }}>
              <Activity className="w-5 h-5" />
              <h2 className="font-semibold">Consistency</h2>
            </div>
            <p className="text-4xl font-bold" style={{ color: theme.colors.text }}>
              {Math.round(metrics.consistencyIndex * 100)}%
            </p>
            <p className="text-sm mt-2" style={{ color: theme.colors.textSecondary }}>
              {metrics.consistencyIndex >= 0.6
                ? 'You code at a steady daily rhythm.'
                : 'Your daily coding time swings a lot. Steady beats heroic.'}
            </p>
          </div>

          {/* 4. True peak hours */}
          <div className="p-5 rounded-xl" style={card}>
            <div className="flex items-center gap-2 mb-1" style={{ color: theme.colors.primary }}>
              <Sunrise className="w-5 h-5" />
              <h2 className="font-semibold">Peak hour</h2>
            </div>
            <p className="text-4xl font-bold" style={{ color: theme.colors.text }}>
              {metrics.truePeakWindow ? hourLabel(metrics.truePeakWindow.hour) : '—'}
            </p>
            <p className="text-sm mt-2" style={{ color: theme.colors.textSecondary }}>
              {metrics.truePeakWindow
                ? 'Your most productive hour, scored on commits and low rework — not simply the hour you are busiest.'
                : 'Not enough data yet.'}
            </p>
          </div>

          {/* 5. Estimation accuracy */}
          <div className="p-5 rounded-xl md:col-span-2" style={card}>
            <div className="flex items-center gap-2 mb-1" style={{ color: theme.colors.primary }}>
              <Target className="w-5 h-5" />
              <h2 className="font-semibold">Estimation accuracy</h2>
            </div>
            {metrics.estimationCalibration ? (
              <>
                <p className="text-4xl font-bold" style={{ color: theme.colors.text }}>
                  {metrics.estimationCalibration.factor}×
                </p>
                <p className="text-sm mt-2" style={{ color: theme.colors.textSecondary }}>
                  {metrics.estimationCalibration.factor > 1.1
                    ? `You take about ${metrics.estimationCalibration.factor}× longer than you estimate.`
                    : metrics.estimationCalibration.factor < 0.9
                    ? 'You finish goals faster than you estimate.'
                    : 'Your estimates are close to reality.'}{' '}
                  Based on {metrics.estimationCalibration.sampleSize} completed goals.
                </p>
              </>
            ) : (
              <p className="text-sm mt-2" style={{ color: theme.colors.textSecondary }}>
                Complete at least two goals with a tech stack set, and this will compare your
                estimates against the hours you actually logged.
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Commits', value: metrics.commits },
            { label: 'Rework ratio', value: hasFocusData ? `${Math.round(metrics.churnRatio * 100)}%` : '—' },
            { label: 'Time reading', value: hasFocusData ? `${Math.round(metrics.comprehensionLoad * 100)}%` : '—' },
            { label: 'File switches / hr', value: hasFocusData ? metrics.contextSwitchesPerHour : '—' },
          ].map((item) => (
            <div key={item.label} className="p-4 rounded-xl" style={card}>
              <p className="text-2xl font-bold" style={{ color: theme.colors.text }}>
                {item.value}
              </p>
              <p className="text-xs mt-1" style={{ color: theme.colors.textSecondary }}>
                {item.label}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-6 text-xs" style={{ color: theme.colors.textSecondary }}>
          These figures are private to you and are never shown on the leaderboard.
        </p>
      </div>
    </div>
  );
}
