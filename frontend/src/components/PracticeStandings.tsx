import { StandingsTower, type TowerRow } from './charts/StandingsTower';
import { plural } from '../lib/format';
import type { PracticeRow } from '../types';

/**
 * Problems solved on LeetCode and Codeforces in the last 7 days, as a standings tower (D-62).
 * Used by the group board and the leaderboard. Verified accounts only.
 */
export function PracticeStandings({ rows, meId, label, dense = false }: { rows: PracticeRow[]; meId: string; label: string; dense?: boolean }) {
  const tower: TowerRow[] = rows.map((r, i) => ({
    id: r.userId,
    name: r.name,
    isMe: r.userId === meId,
    pos: i + 1,
    value: String(r.solved7d),
    extras: [
      r.leetcode ? String(r.leetcode.solved7d) : '—',
      r.codeforces ? String(r.codeforces.solved7d) : '—',
      r.codeforces?.rating != null ? String(r.codeforces.rating) : '—',
      r.leetcode?.rating != null ? String(r.leetcode.rating) : '—',
    ],
    summary: `${plural(r.solved7d, 'problem')} solved in the last 7 days${r.codeforces?.rating != null ? `, Codeforces ${r.codeforces.rating}` : ''}${r.leetcode?.rating != null ? `, LeetCode contest ${r.leetcode.rating}` : ''}, ${r.solvedTotal} solved in all`,
  }));
  return (
    <StandingsTower
      rows={tower}
      dense={dense}
      label={label}
      valueHeader="7 days"
      columns={[
        { label: 'LeetCode', title: 'LeetCode problems solved in the last 7 days' },
        { label: 'CF', title: 'Codeforces problems solved in the last 7 days' },
        { label: 'CF rating', title: 'Codeforces rating' },
        { label: 'LC rating', title: 'LeetCode contest rating' },
      ]}
    />
  );
}
