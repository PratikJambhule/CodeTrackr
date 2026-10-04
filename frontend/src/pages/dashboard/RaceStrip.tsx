import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import { useGroupDetails, useMyGroups } from '../../hooks/queries';
import { StandingsTower, type TowerRow } from '../../components/charts/StandingsTower';
import { ButtonLink, Skeleton } from '../../components/ui';
import { addDays, gapLabel, hm, localDateKey, mondayOf, weekdayShort } from '../../lib/format';
import { dayCells, movement, orderOnDay, ordinal, rank, type Racer } from '../../lib/standings';
import { readStored, writeStored } from '../../lib/storage';
import type { Me } from '../../types';

const PINNED = 'codetrackr.pinnedGroup';

/**
 * The first thing on the dashboard: where you stand in this week's race in one
 * of your groups, and the gap to the person just above you (spec §2: "catch the
 * person above you").
 */
export function RaceStrip({ user }: { user: Me }) {
  const groups = useMyGroups();
  const [pinned, setPinned] = useState(() => readStored(PINNED));
  const group = groups.data?.find((g) => g._id === pinned) ?? groups.data?.[0];
  const monday = useMemo(() => mondayOf(new Date()), []);
  const details = useGroupDetails(group?._id, { from: monday.toISOString() });

  if (groups.isPending || (group && details.isPending)) {
    return <Skeleton className="mb-6 h-[180px]" />;
  }

  if (!group) {
    return (
      <section className="card mb-6 flex flex-wrap items-center gap-6 p-6">
        <Users className="h-10 w-10 flex-none text-accent" aria-hidden="true" />
        <div className="min-w-[220px] flex-1">
          <h2 className="text-xl font-semibold">Race your friends this week</h2>
          <p className="mt-1 text-muted">Make a group, send your friends the link, and this space shows where you stand every day.</p>
        </div>
        <ButtonLink to="/groups" variant="primary">
          Create or join a group
        </ButtonLink>
      </section>
    );
  }

  const d = details.data;
  if (!d) return null;

  const todayKey = localDateKey(new Date());
  const weekKeys = Array.from({ length: 7 }, (_, i) => localDateKey(addDays(monday, i)));
  const byUser = d.daily?.byUser ?? {};
  const dates = d.daily?.dates ?? [];
  const racers: Racer[] = d.leaderboard.map((row) => ({
    id: row.userId,
    name: row.userName,
    isMe: row.userId === user.id,
    total: Math.round(row.codingHours * 3600),
    days: weekKeys.map((k) => byUser[row.userId]?.[dates.indexOf(k)] ?? 0),
  }));
  const todayIdx = Math.max(0, weekKeys.indexOf(todayKey));
  const cells = dayCells(racers, todayIdx + 1);
  const ranked = rank(racers);
  const meIdx = ranked.findIndex((r) => r.racer.isMe);
  const me = ranked[meIdx];
  const moves = todayIdx > 0 ? movement(orderOnDay(racers, todayIdx - 1), orderOnDay(racers, todayIdx)) : {};
  const daysLeft = 6 - todayIdx;

  const headline = !me
    ? 'You are not on this board yet.'
    : me.pos === 1
      ? ranked[1]
        ? `You lead ${ranked[1].racer.name} by ${hm(me.racer.total - ranked[1].racer.total)}`
        : 'You are the only one racing'
      : `${hm(ranked[meIdx - 1].racer.total - me.racer.total)} behind ${ranked[meIdx - 1].racer.name}`;

  // You and the people either side of you.
  const start = me ? Math.max(0, Math.min(meIdx - 1, ranked.length - 3)) : 0;
  const rows: TowerRow[] = ranked.slice(start, start + 3).map(({ racer, pos, gap }) => ({
    id: racer.id,
    name: racer.name,
    isMe: racer.isMe,
    value: pos === 1 ? hm(racer.total) : gapLabel(gap),
    cells: cells[racer.id],
    move: todayIdx > 0 ? moves[racer.id] : undefined,
    summary: `${hm(racer.total)} this week`,
  }));
  const posColor = me?.pos === 1 ? 'var(--gold)' : me?.pos === 2 ? 'var(--silver)' : me?.pos === 3 ? 'var(--bronze)' : 'var(--ink)';

  return (
    <section aria-labelledby="race-title" className="card mb-6 p-5 sm:p-6">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-5">
        <div className="min-w-[240px] flex-[1_1_260px]">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="race-title" className="eyebrow">
              This week · {group.name}
            </h2>
            {(groups.data?.length ?? 0) > 1 && (
              <label className="text-xs text-muted">
                <span className="sr-only">Show the race in</span>
                <select
                  value={group._id}
                  onChange={(e) => {
                    setPinned(e.target.value);
                    writeStored(PINNED, e.target.value);
                  }}
                  className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-xs text-ink"
                >
                  {groups.data?.map((g) => (
                    <option key={g._id} value={g._id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="mt-2 flex items-baseline gap-4">
            {me && (
              <span className="display text-balance text-[88px]" style={{ color: posColor }}>
                <span className="sr-only">You are </span>P{me.pos}
              </span>
            )}
            <p className="text-xl leading-snug">{headline}</p>
          </div>
          <p className="mt-1 font-mono text-[13px] text-muted">
            {me && moves[me.racer.id] ? (moves[me.racer.id] > 0 ? `▲${moves[me.racer.id]} since yesterday · ` : `▼${-moves[me.racer.id]} since yesterday · `) : ''}
            {me ? `${ordinal(me.pos)} of ${ranked.length}` : ''}
            {daysLeft > 0 ? ` · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left` : ' · last day'}
          </p>
        </div>
        <div className="min-w-0 flex-[1_1_420px]">
          <StandingsTower rows={rows} dense dayHeader={`${weekdayShort(weekKeys[0])} → ${weekdayShort(weekKeys[6])}`} label={`This week in ${group.name}`} />
          <div className="mt-2 text-right">
            <Link to={`/groups/${group._id}`} className="text-sm font-semibold">
              Open the group board
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
