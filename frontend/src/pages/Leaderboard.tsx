import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Code2, Trophy } from 'lucide-react';
import { errorText } from '../api';
import { useLeaderboard, usePracticeLeaderboard } from '../hooks/queries';
import { StandingsTower, type TowerRow } from '../components/charts/StandingsTower';
import { PracticeStandings } from '../components/PracticeStandings';
import { Avatar, Card, CardTitle, EmptyState, ErrorBox, PageHeader, Segmented, Skeleton } from '../components/ui';
import { hoursHm, int, plural } from '../lib/format';
import { ordinal } from '../lib/standings';
import type { Me } from '../types';

const PODIUM = ['var(--gold)', 'var(--silver)', 'var(--bronze)'];
type Mode = 'hours' | 'problems';

/** The top three as cards. `value` is what each is ranked by (hours, or problems this week). */
function Podium({ items, meId }: { items: { id: string; name: string; picture?: string; value: string }[]; meId: string }) {
  return (
    <ol
      aria-label="Top three"
      className="col-span-12 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr))] xl:sticky xl:top-20 xl:col-span-4 xl:grid-cols-1"
    >
      {items.slice(0, 3).map((r, i) => (
        <Card as="li" key={r.id} className={`flex items-center gap-4 p-5 ${r.id === meId ? 'bg-me' : ''}`}>
          <span className="display text-balance w-10 text-[56px]" style={{ color: PODIUM[i] }} aria-hidden="true">
            {i + 1}
          </span>
          <Avatar name={r.name} src={r.picture} size={44} />
          <div className="min-w-0">
            <div className="truncate font-semibold">
              <span className="sr-only">{ordinal(i + 1)}: </span>
              {r.name}
              {r.id === meId && <span className="ml-2 font-mono text-[11px] text-accent-ink">you</span>}
            </div>
            <div className="font-mono text-sm text-muted num">{r.value}</div>
          </div>
        </Card>
      ))}
    </ol>
  );
}

function HoursBoard({ user, days }: { user: Me; days: number | null }) {
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

  if (q.isPending) return <Skeleton className="h-[480px]" />;
  if (q.isError) return <ErrorBox message={errorText(q.error)} onRetry={() => q.refetch()} />;
  if (!active.length) {
    return (
      <Card>
        <EmptyState icon={<Trophy className="h-10 w-10" />} title="Nobody has coded in this period yet">
          Code for a couple of minutes with the extension connected and you will be the first one here.
        </EmptyState>
      </Card>
    );
  }
  return (
    // Wide screens: the podium in a left column (it stays in view while the table scrolls),
    // the full table beside it. Narrower: podium above the table.
    <div className="grid grid-cols-12 items-start gap-4">
      <Podium items={rows.map((r) => ({ id: r.userId, name: r.name, picture: r.profilePictureUrl, value: hoursHm(r.totalHours) }))} meId={user.id} />
      <Card className="col-span-12 min-w-0 p-4 sm:p-5 xl:col-span-8">
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
    </div>
  );
}

function ProblemsBoard({ user }: { user: Me }) {
  const q = usePracticeLeaderboard(true);
  const rows = q.data ?? [];
  const meIdx = rows.findIndex((r) => r.userId === user.id);
  if (q.isPending) return <Skeleton className="h-[480px]" />;
  if (q.isError) return <ErrorBox message={errorText(q.error)} onRetry={() => q.refetch()} />;
  if (!rows.length) {
    return (
      <Card>
        <EmptyState icon={<Code2 className="h-10 w-10" />} title="Nobody has a verified LeetCode or Codeforces account yet" action={<Link to="/profile">Link and verify yours</Link>}>
          Verified accounts are ranked here by problems solved in the last 7 days.
        </EmptyState>
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-12 items-start gap-4">
      <Podium items={rows.map((r) => ({ id: r.userId, name: r.name, picture: r.profilePictureUrl, value: `${plural(r.solved7d, 'problem')} this week` }))} meId={user.id} />
      <Card className="col-span-12 min-w-0 p-4 sm:p-5 xl:col-span-8">
        <CardTitle aside="verified accounts · updated nightly">
          {meIdx >= 0 ? (
            <span>
              You are {ordinal(meIdx + 1)} of {rows.length}
              {meIdx > 0 && <span className="font-normal text-muted"> · {plural(rows[meIdx - 1].solved7d - rows[meIdx].solved7d, 'problem')} behind {rows[meIdx - 1].name}</span>}
            </span>
          ) : (
            <span>
              Standings <span className="font-normal text-muted">· <Link to="/profile">verify your account</Link> to join</span>
            </span>
          )}
        </CardTitle>
        <PracticeStandings rows={rows} meId={user.id} dense label="Leaderboard: problems solved in the last 7 days" />
        {q.isFetching && <p className="mt-3 font-mono text-xs text-muted">updating…</p>}
      </Card>
    </div>
  );
}

/** Everyone on CodeTrackr: by credited coding hours, or by problems solved on LeetCode and Codeforces. */
export default function Leaderboard({ user }: { user: Me }) {
  const [mode, setMode] = useState<Mode>('hours');
  const [days, setDays] = useState<number | null>(null);
  return (
    <>
      <PageHeader
        eyebrow="Everyone on CodeTrackr"
        title="Leaderboard"
        actions={
          <>
            <Segmented
              label="Ranked by"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'hours', label: 'Coding hours' },
                { value: 'problems', label: 'Problems solved' },
              ]}
            />
            {mode === 'hours' && (
              <Segmented
                label="Period"
                value={days ?? 0}
                onChange={(v) => setDays(v === 0 ? null : v)}
                options={[
                  { value: 0, label: 'All time' },
                  { value: 30, label: '30 days' },
                  { value: 7, label: '7 days' },
                ]}
              />
            )}
          </>
        }
      >
        {mode === 'hours'
          ? 'Ranked by hours. Hours are credited time: they count only while VS Code had focus.'
          : 'Ranked by problems solved on LeetCode and Codeforces in the last 7 days. Only accounts their owners have verified are shown.'}
      </PageHeader>
      {mode === 'hours' ? <HoursBoard user={user} days={days} /> : <ProblemsBoard user={user} />}
    </>
  );
}
