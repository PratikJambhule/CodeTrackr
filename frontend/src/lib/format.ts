/**
 * Formatting and local-date helpers. Pure functions, unit-tested in
 * format.test.ts. Durations come from the API in SECONDS unless a name says
 * otherwise.
 */

/** "2h 05m", "45m", "0m". */
export function hm(seconds: number): string {
  const total = Math.max(0, Math.round((Number(seconds) || 0) / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h === 0 ? `${m}m` : `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Same, from hours (some endpoints answer in hours). */
export const hoursHm = (hours: number) => hm((Number(hours) || 0) * 3600);

/** Compact for chart labels: "2h", "2h30", "45m", "". */
export function hmCompact(seconds: number): string {
  const total = Math.max(0, Math.round((Number(seconds) || 0) / 60));
  if (total === 0) return '';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

/** Gap to the leader, as on a timing screen: "+1h 05m". */
export const gapLabel = (seconds: number) => `+${hm(seconds)}`;

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function pct(ratio: number, digits = 0): string {
  const v = (Number(ratio) || 0) * 100;
  return `${v.toFixed(digits)}%`;
}

export function int(n: number): string {
  return Math.round(Number(n) || 0).toLocaleString('en-IN');
}

/** "Just now", "5m ago", "3h ago", "2d ago", then the date. */
export function timeAgo(iso: string | number | Date, now = Date.now()): string {
  const seconds = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ---- Local calendar dates -----------------------------------------------------

/**
 * The browser's local calendar date as YYYY-MM-DD.
 * Never `toISOString().slice(0, 10)`: that is the UTC date, so between 00:00
 * and 05:30 in India it is yesterday, and a date picked on a calendar became
 * the day before (the old Goals page bug).
 */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local midnight of a YYYY-MM-DD key. */
export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds());
}

/** Monday 00:00 of the local week containing `d`. */
export function mondayOf(d: Date): Date {
  const day = startOfDay(d);
  return addDays(day, -((day.getDay() + 6) % 7));
}

/** Whole local days from `from` to `to` (both date keys or dates). */
export function daysBetween(from: string | Date, to: string | Date): number {
  const a = typeof from === 'string' ? fromDateKey(from) : startOfDay(from);
  const b = typeof to === 'string' ? fromDateKey(to) : startOfDay(to);
  return Math.round((b.getTime() - a.getTime()) / 864e5);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const weekdayShort = (key: string) => WEEKDAYS[fromDateKey(key).getDay()];
export const monthShort = (monthIndex: number) => MONTHS[monthIndex];

/** "Mon 28 Sep". */
export function dayLabel(key: string): string {
  const d = fromDateKey(key);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "today", "tomorrow", "in 6 days", "yesterday", "3 days ago". */
export function relativeDay(key: string, today = new Date()): string {
  const n = daysBetween(today, key);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** Date.getTimezoneOffset(): what the API's ?timezone= expects (IST = -330). */
export const tzOffset = () => new Date().getTimezoneOffset();

/** Deadlines are stored as UTC midnight of the chosen date; read the date part back. */
export function deadlineKey(iso: string): string {
  return String(iso).slice(0, 10);
}
