/** Shapes of the API's answers, as the pages use them. */

export interface Me {
  id: string;
  name: string;
  email: string;
  profilePictureUrl?: string;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  apiKeyCreatedAt?: string | null;
  legacyApiKey: boolean;
  isFirstLogin?: boolean;
  lastLogin?: string;
  createdAt?: string;
}

export interface TerminalSummary {
  totalCommands: number;
  terminalErrorCount: number;
  successfulCommands: number;
  failedCommands: number;
  successRate: number;
  buildRuns: number;
  testRuns: number;
  successfulBuilds: number;
  failedBuilds: number;
  buildSuccessRate: number;
  debuggingSessions: number;
  commandUsage: Record<string, number>;
  gitActivity: { commits: number; pushes: number; pulls: number; checkouts?: number; merges?: number; clones?: number };
  repeatedFailedCommands: { command: string; count: number }[];
}

/** /api/analytics/:id (today, by hour) and /api/analytics/weekly/:id (7 days, by day). */
export interface PeriodView {
  totalHours: number;
  projectCount: number;
  totalLinesAdded: number;
  streakDays: number;
  dailyActivity: { day: string; hours: number }[];
  languageBreakdown: { _id: string; hours: number }[];
  terminalSummary: TerminalSummary;
  terminalTimeline: { hour?: string; day?: string; success: number; failed: number }[];
  buildTimeline: { hour?: string; day?: string; success: number; failed: number }[];
  gitTimeline: { hour?: string; day?: string; commits: number; pushes: number; pulls: number }[];
}

export interface History {
  days: { date: string; seconds: number }[];
  hourOfDay: number[];
  projects: { name: string; seconds: number }[];
  commits7d: number;
}

export interface TimeSlot {
  totalMinutes: number;
  totalLines: number;
  fileCount: number;
  productivity: number;
  tenMinuteSlots: { label: string; lines: number }[];
  languages: { _id: string; minutes: number; lines: number }[];
  activityCount: number;
  terminalSummary: TerminalSummary;
}

export interface Group {
  _id: string;
  name: string;
  description: string;
  visibility: 'public' | 'private';
  createdBy?: { _id: string; name: string } | null;
  createdAt?: string;
}

export interface GroupBoardRow {
  rank: number;
  userId: string;
  userName: string;
  codingHours: number;
  totalLinesAdded: number;
  commits: number;
  failedCommands: number;
  totalCommands: number;
  commandFailureRate: number | null;
  failedBuilds: number;
  buildRuns: number;
  buildFailureRate: number | null;
}

export interface GroupDetails {
  group: Group;
  members: { id: string; name: string; joinedAt: string }[];
  leaderboard: GroupBoardRow[];
  window: { from: string; to: string } | null;
  daily: { dates: string[]; byUser: Record<string, number[]> } | null;
  source?: string;
}

export interface GroupPreview {
  group: Group;
  memberCount: number;
  isMember: boolean;
}

export interface LeaderRow {
  rank: number;
  userId: string;
  name: string;
  profilePictureUrl?: string;
  totalHours: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
  codeChanges: number;
  netCodeChanges: number;
  projectCount: number;
  commits: number;
  overall: string;
}

export interface Goal {
  _id: string;
  title: string;
  description?: string;
  targetHours: number;
  techStack?: string;
  deadline: string;
  status?: 'in-progress' | 'completed';
  completedAt?: string | null;
  createdAt?: string;
}

export interface GoalProgress {
  currentHours: number;
  progress: number;
  matched: boolean;
}

export interface AppNotification {
  _id: string;
  type: 'deadline_reminder' | 'deadline_missed' | 'goal_completed';
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  goalId?: { _id: string; title: string; deadline: string } | null;
}

export interface DeviceToken {
  id: string;
  clientName: string;
  hint: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

export type Confidence = 'insufficient' | 'low' | 'high';

export interface MetricMeta {
  confidence: Confidence;
  sampleSize: number;
  unit: string;
  baseline?: number;
  delta?: number | null;
}

export interface SessionSummary {
  startMs: number;
  endMs: number;
  minutes: number;
  archetype: string;
  reason: string;
  projects: string[];
  languages: string[];
  deepBlockCount: number;
  commits: number;
}

export interface Metrics {
  windowDays: number;
  deepWorkRatio: number;
  flowBlocks: { medianMs: number; longestMs: number; deepBlockCount: number; blockCount: number; totalMs: number };
  volumeStability: number;
  activeDaysRatio: number;
  activeDays: number;
  qualityStreak: number;
  truePeakWindow: { startHour: number; endHour: number; score: number; minutes: number; days: number } | null;
  estimationCalibration: { factor: number; minFactor: number; maxFactor: number; sampleSize: number } | null;
  churnRatio: number;
  comprehensionLoad: number;
  contextSwitchesPerHour: number;
  interruptionsPerHour: number;
  commits: number;
  totalHours: number;
  focusedHours: number;
  meta: Record<string, MetricMeta>;
  sessionCount: number;
  sessionWindowDays: number;
  archetypeMix: Record<string, { sessions: number; minutes: number }>;
  recentSessions: SessionSummary[];
  baselineDays?: number;
}

export type Severity = 'warning' | 'info' | 'positive';

export interface Finding {
  id: string;
  category: string;
  severity: Severity;
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
}

export interface InsightsPayload {
  findings: Finding[];
  skipped: { id: string; reason: string; metrics?: string[]; message?: string }[];
  totalFindings: number;
}
