import { Link } from 'react-router-dom';
import { errorText } from '../api';
import { useGroupWeekBoard } from '../hooks/queries';
import { plural } from '../lib/format';
import type { GroupWeekBoard as Board } from '../types';
import { StandingsTower, type TowerRow } from './charts/StandingsTower';
import { ButtonLink, Card, EmptyState, ErrorBox, Skeleton } from './ui';

const shortDate = (key: string) => new Date(`${key}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`;

/** Where you stand, in plain counts: your place, and how many problems separate you from the next person up. */
function YourWeek({ b, meId }: { b: Board; meId: string }) {
  const me = b.rows.find((r) => r.id === meId);
  if (!me) {
    return (
      <div className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold text-ink">You're not on this board</h3>
        <p className="text-sm text-muted">Link LeetCode, Codeforces or GitHub on your profile and press Verify. Your problems solved show up here within the hour.</p>
        <ButtonLink to="/profile" variant="primary">Verify an account</ButtonLink>
      </div>
    );
  }
  const ahead = [...b.rows].reverse().find((r) => r.problems > me.problems);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-muted">Your week</p>
        <p className="display text-[40px] leading-none text-ink">{ordinal(me.pos)}</p>
        <p className="mt-1 text-sm text-muted">of {plural(b.rows.length, 'person', 'people')} on the board</p>
      </div>
      <p className="text-sm text-ink">
        {plural(me.problems, 'problem')} solved
        {ahead ? <>, <strong>{ahead.problems - me.problems}</strong> behind {ahead.name}.</> : me.problems > 0 ? '. Nobody has solved more.' : '. Solve one to get on the board.'}
      </p>
      <dl className="grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
        <div><dt className="text-muted">Contests</dt><dd className="font-mono text-ink">{me.contests}</dd></div>
        <div><dt className="text-muted">GitHub pushes</dt><dd className="font-mono text-ink">{me.pushes}</dd></div>
      </dl>
    </div>
  );
}

/** Problems solved this week, ranked, with contests and pushes beside them. Plain counts from the sites themselves. */
export function GroupWeekBoard({ groupId, groupName, meId }: { groupId: string; groupName: string; meId: string }) {
  const q = useGroupWeekBoard(groupId);
  if (q.isPending) return <Skeleton className="h-72" />;
  if (q.isError) return <ErrorBox message={errorText(q.error)} onRetry={() => q.refetch()} />;
  const b = q.data;
  const tower: TowerRow[] = b.rows.map((r) => ({
    id: r.id,
    name: r.name,
    isMe: r.id === meId,
    pos: r.pos,
    value: String(r.problems),
    extras: [String(r.contests), String(r.pushes)],
    summary: `${plural(r.problems, 'problem')} solved, ${plural(r.contests, 'contest')}, ${plural(r.pushes, 'GitHub push', 'GitHub pushes')}`,
  }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Card className="min-w-0 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1">
          <h2 className="text-lg font-semibold text-ink">Problems solved this week</h2>
          <span className="font-mono text-xs text-muted">{shortDate(b.week.startsOn)} – {shortDate(b.week.endsOn)} · {b.week.daysLeft ? `${plural(b.week.daysLeft, 'day')} left` : 'last day'}</span>
        </div>
        {b.rows.length === 0 ? (
          <EmptyState title="Nobody here has a verified account yet">
            Link LeetCode, Codeforces or GitHub on your profile and press Verify to appear here.
          </EmptyState>
        ) : (
          <StandingsTower
            rows={tower}
            label={`${groupName}: problems solved this week`}
            valueHeader="Solved"
            columns={[
              { label: 'Contests', title: 'Rated contests entered this week' },
              { label: 'Pushes', title: 'Pushes to public GitHub repos this week' },
            ]}
          />
        )}
        <p className="mt-4 border-t border-line px-1 pt-3 text-xs text-muted">
          LeetCode and Codeforces count problems; GitHub counts pushes to public repos. Verified accounts only, updated every hour.
        </p>
      </Card>

      <aside className="flex flex-col gap-4">
        <Card className="p-5"><YourWeek b={b} meId={meId} /></Card>
        {b.lastWeek && (
          <Card className="p-5">
            <p className="text-sm text-muted">Last week's top solver</p>
            <p className="mt-1 text-lg font-semibold text-ink">{b.lastWeek.names.join(', ')}</p>
            <p className="text-sm text-muted">{plural(b.lastWeek.problems, 'problem')}</p>
          </Card>
        )}
        {b.unranked.length > 0 && (
          <p className="px-1 text-sm text-muted">
            Not on the board yet: {b.unranked.map((u) => u.name).join(', ')}.{' '}
            {!b.unranked.some((u) => u.id === meId) && 'They need to verify an account.'}
            {b.unranked.some((u) => u.id === meId) && <Link to="/profile">Verify yours</Link>}
          </p>
        )}
      </aside>
    </div>
  );
}
