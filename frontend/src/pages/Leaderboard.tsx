import { useState } from 'react';
import { Trophy } from 'lucide-react';
import { errorText } from '../api';
import { useLeaderboard } from '../hooks/queries';
import { StandingsTower, type TowerRow } from '../components/charts/StandingsTower';
import { Avatar, Card, CardTitle, EmptyState, ErrorBox, PageHeader, Segmented, Skeleton } from '../components/ui';
import { hoursHm, int, plural } from '../lib/format';
import { ordinal } from '../lib/standings';
import type { LeaderRow, Me } from '../types';

const PODIUM = ['var(--gold)', 'var(--silver)', 'var(--bronze)'];

function Podium({ rows, meId }: { rows: LeaderRow[]; meId: string }) {
  return (
    <ol aria-label="Top three" className="mb-6 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))]">
      {rows.slice(0, 3).map((r, i) => (
        <Card as="li" key={r.userId} className={`flex items-center gap-4 p-5 ${r.userId === meId ? 'bg-me' : ''}`}>
          <span className="display text-balance w-10 text-[56px]" style={{ color: PODIUM[i] }} aria-hidden="true">
            {i + 1}
          </span>
          <Avatar name={r.name} src={r.profilePictureUrl} size={44} />
          <div className="min-w-0">
            <div className="truncate font-semibold">
              <span className="sr-only">{ordinal(i + 1)}: </span>
              {r.name}
              {r.userId === meId && <span className="ml-2 font-mono text-[11px] text-accent-ink">you</span>}
            </div>
            <div className="font-mono text-sm text-muted num">{hoursHm(r.totalHours)}</div>
          </div>
        </Card>
      ))}
    </ol>
  );
}

/** Everyone on CodeTrackr, ranked by credited hours. */
export default function Leaderboard({ user }: { user: Me }) {
  const [days, setDays] = useState<number | null>(null);
  const q = useLeaderboard(days);
  const rows = q.data ?? [];
  const active = rows.filter((r) => r.totalHours > 0);
  const meIdx = rows.findIndex((r) => r.userId === user.id);
  const me = rows[meIdx];
  const average = active.length ? active.reduce((a, r) => a + r.totalHours, 0) / active.length : 0;

  const tower: TowerRow[] = rows.map((r) => ({
    id: r.userId,
    name: r.name,
    isMe: r.userId === user.id,
    value: hoursHm(r.totalHours),
    extras: [int(r.commits), int(r.codeChanges)],
    summary: `${hoursHm(r.totalHours)}, ${plural(r.commits, 'commit')}, ${int(r.codeChanges)} lines changed`,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Everyone on CodeTrackr"
        title="Leaderboard"
        actions={
          <Segmented
            label="Period"
            value={days ?? 0}
            onChange={(v) => setDays(v === 0 ? null : v)}
            options={[
              { value: 0, label: 'All time' },
              { value: 30, label: 'Last 30 days' },
              { value: 7, label: 'Last 7 days' },
            ]}
          />
        }
      >
        Ranked by hours. Hours are credited time: they count only while VS Code had focus.
      </PageHeader>

      {q.isPending ? (
        <Skeleton className="h-[480px]" />
      ) : q.isError ? (
        <ErrorBox message={errorText(q.error)} onRetry={() => q.refetch()} />
      ) : active.length === 0 ? (
        <Card>
          <EmptyState icon={<Trophy className="h-10 w-10" />} title="Nobody has coded in this period yet">
            Code for a couple of minutes with the extension connected and you will be the first one here.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Podium rows={rows} meId={user.id} />
          <Card className="p-4 sm:p-5">
            <CardTitle aside={`average ${hoursHm(average)} across ${plural(active.length, 'person', 'people')}`}>
              {me ? (
                <span>
                  You are {ordinal(meIdx + 1)} of {rows.length}
                  {meIdx > 0 && <span className="font-normal text-muted"> · {hoursHm(rows[meIdx - 1].totalHours - me.totalHours)} behind {rows[meIdx - 1].name}</span>}
                </span>
              ) : (
                'Standings'
              )}
            </CardTitle>
            <StandingsTower rows={tower} dense valueHeader="Hours" label="Leaderboard" columns={[{ label: 'Commits' }, { label: 'Lines', title: 'Lines added plus lines removed' }]} />
            {q.isFetching && <p className="mt-3 font-mono text-xs text-muted">updating…</p>}
          </Card>
        </>
      )}
    </>
  );
}
