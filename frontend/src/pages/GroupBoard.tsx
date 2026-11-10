import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Link2, LogOut, Pencil } from 'lucide-react';
import { apiSend, errorText } from '../api';
import { type BoardWindow, useGroupDetails } from '../hooks/queries';
import { GroupAdminPanel } from '../components/GroupAdminPanel';
import { GroupWeekBoard } from '../components/GroupWeekBoard';
import { isGroupAdmin, memberActions } from '../lib/groupRoles';
import { StandingsTower, type TowerRow } from '../components/charts/StandingsTower';
import { CellLegend } from '../components/charts/DayCells';
import { RaceChart } from '../components/charts/RaceChart';
import { Avatar, Button, Card, CardTitle, EmptyState, ErrorBox, Modal, PageHeader, Pill, Segmented, Skeleton, TextField, useToast } from '../components/ui';
import { addDays, dayLabel, fromDateKey, gapLabel, hm, localDateKey, mondayOf, plural, startOfDay, weekdayShort } from '../lib/format';
import { cellsSummary, dayCells, movement, orderOnDay, rank, type Racer } from '../lib/standings';
import type { Me } from '../types';

type Period = 'week' | '7d' | 'all' | 'contest';
type View = 'problems' | 'vscode' | 'members';

/** The board's window from the URL, so a contest week can be shared as a link. */
function useBoardPeriod() {
  const [params, setParams] = useSearchParams();
  const period = (['week', '7d', 'all', 'contest'].includes(params.get('period') ?? '') ? params.get('period') : 'week') as Period;
  const fromKey = params.get('from') ?? '';
  const toKey = params.get('to') ?? '';
  const range = useMemo((): BoardWindow & { keys: string[] | null } => {
    const now = new Date();
    if (period === 'week') {
      const monday = mondayOf(now);
      return { from: monday.toISOString(), keys: Array.from({ length: 7 }, (_, i) => localDateKey(addDays(monday, i))) };
    }
    if (period === '7d') {
      const start = addDays(startOfDay(now), -6);
      return { from: start.toISOString(), keys: Array.from({ length: 7 }, (_, i) => localDateKey(addDays(start, i))) };
    }
    if (period === 'contest' && fromKey && toKey && toKey >= fromKey) {
      const start = fromDateKey(fromKey);
      const endExclusive = addDays(fromDateKey(toKey), 1);
      const n = Math.round((endExclusive.getTime() - start.getTime()) / 864e5);
      return { from: start.toISOString(), to: endExclusive.toISOString(), keys: n <= 62 ? Array.from({ length: n }, (_, i) => localDateKey(addDays(start, i))) : null };
    }
    return { keys: null }; // all time: the API returns the last 7 days of cells
  }, [period, fromKey, toKey]);
  const set = (p: Period, extra: Record<string, string> = {}) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('period', p);
      next.delete('from');
      next.delete('to');
      for (const [k, v] of Object.entries(extra)) next.set(k, v);
      return next;
    }, { replace: true });
  return { period, range, set, fromKey, toKey };
}

export default function GroupBoard({ user }: { user: Me }) {
  const { groupId } = useParams();
  const { period, range, set, fromKey, toKey } = useBoardPeriod();
  const [params, setParams] = useSearchParams();
  const view = (['problems', 'vscode', 'members'].includes(params.get('view') ?? '') ? params.get('view') : 'problems') as View;
  const setView = (v: View) => setParams((prev) => { const next = new URLSearchParams(prev); next.set('view', v); return next; }, { replace: true });
  const q = useGroupDetails(groupId, range);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [contestOpen, setContestOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [transferring, setTransferring] = useState<{ id: string; name: string } | null>(null);
  const today = useMemo(() => new Date(), []);

  if (q.isPending) return <Skeleton className="h-[520px]" />;
  if (q.isError) {
    const status = (q.error as { status?: number }).status;
    return (
      <>
        <BackLink />
        {status === 403 ? (
          <Card>
            <EmptyState title="You are not a member of this group" action={<Link to={`/join/${groupId}`}>See the group and join</Link>}>
              Only members can see a group’s board.
            </EmptyState>
          </Card>
        ) : (
          <ErrorBox message={errorText(q.error)} onRetry={() => q.refetch()} />
        )}
      </>
    );
  }

  const d = q.data;
  const isAdmin = isGroupAdmin(d.myRole);
  const isOwner = d.myRole === 'owner';
  const todayKey = localDateKey(today);
  const keys = range.keys ?? d.daily?.dates ?? [];
  const byUser = d.daily?.byUser ?? {};
  const dates = d.daily?.dates ?? [];
  const racers: Racer[] = d.leaderboard.map((row) => ({
    id: row.userId,
    name: row.userName,
    isMe: row.userId === user.id,
    total: Math.round(row.codingHours * 3600),
    days: d.daily ? keys.map((k) => byUser[row.userId]?.[dates.indexOf(k)] ?? 0) : undefined,
  }));
  const futureIdx = keys.findIndex((k) => k > todayKey);
  const futureFrom = futureIdx === -1 ? keys.length : futureIdx;
  const cells = d.daily ? dayCells(racers, futureFrom) : {};
  const lastIdx = Math.max(0, futureFrom - 1);
  const moves = d.daily && lastIdx > 0 ? movement(orderOnDay(racers, lastIdx - 1), orderOnDay(racers, lastIdx)) : {};
  const ranked = rank(racers);
  const dayNames = keys.map((k) => (keys.length <= 7 ? weekdayShort(k) : dayLabel(k)));
  const isAll = period === 'all';
  const showRace = Boolean(d.daily) && !isAll && keys.length > 1;
  const rows: TowerRow[] = ranked.map(({ racer, pos, gap }) => {
    const row = d.leaderboard.find((r) => r.userId === racer.id)!;
    const cmd = row.commandFailureRate === null ? '—' : `${Math.round(row.commandFailureRate * 100)}%`;
    const build = row.buildFailureRate === null ? '—' : `${Math.round(row.buildFailureRate * 100)}%`;
    return {
      id: racer.id,
      name: racer.name,
      isMe: racer.isMe,
      value: pos === 1 ? hm(racer.total) : gapLabel(gap),
      move: d.daily ? moves[racer.id] : undefined,
      cells: cells[racer.id],
      cellTitles: racer.days?.map((v, i) => `${dayNames[i]}: ${i >= futureFrom ? 'not yet' : v ? hm(v) : 'no coding'}`),
      extras: [row.commits, cmd, build],
      summary: `${hm(racer.total)}, ${plural(row.commits, 'commit')}, commands failed ${cmd}, builds failed ${build}. ${cells[racer.id] ? cellsSummary(cells[racer.id], dayNames) : ''}`,
    };
  });

  const periodLabel =
    period === 'week'
      ? 'This week'
      : period === '7d'
        ? 'Last 7 days'
        : period === 'contest' && fromKey && toKey
          ? `${dayLabel(fromKey)} – ${dayLabel(toKey)}`
          : 'All time';
  const inviteUrl = `${window.location.origin}/join/${d.group._id}`;

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast(d.group.visibility === 'private' ? 'Invite link copied. Send the password separately.' : 'Invite link copied');
    } catch {
      toast(`Copy this link: ${inviteUrl}`, 'info');
    }
  };
  const leave = async () => {
    try {
      await apiSend('POST', `/api/groups/${d.group._id}/leave`);
      await qc.invalidateQueries({ queryKey: ['groups'] });
      toast(`You left ${d.group.name}`);
      navigate('/groups');
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };
  const setRole = async (id: string, name: string, role: 'admin' | 'member') => {
    try {
      await apiSend('PATCH', `/api/groups/${d.group._id}/members/${id}/role`, { role });
      await qc.invalidateQueries({ queryKey: ['groups', 'details', d.group._id] });
      await qc.invalidateQueries({ queryKey: ['groups', 'audit', d.group._id] });
      toast(role === 'admin' ? `${name} is now an admin` : `${name} is now a member`);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };
  const transfer = async () => {
    if (!transferring) return;
    try {
      await apiSend('POST', `/api/groups/${d.group._id}/transfer`, { userId: transferring.id });
      await qc.invalidateQueries({ queryKey: ['groups', 'details', d.group._id] });
      await qc.invalidateQueries({ queryKey: ['groups', 'audit', d.group._id] });
      toast(`${transferring.name} now owns this group`);
    } catch (err) {
      toast(errorText(err), 'error');
    }
    setTransferring(null);
  };
  const remove = async () => {
    if (!removing) return;
    try {
      await apiSend('DELETE', `/api/groups/${d.group._id}/members/${removing.id}`);
      await qc.invalidateQueries({ queryKey: ['groups', 'details', d.group._id] });
      await qc.invalidateQueries({ queryKey: ['groups', 'audit', d.group._id] });
      toast(`Removed ${removing.name}`);
    } catch (err) {
      toast(errorText(err), 'error');
    }
    setRemoving(null);
  };

  return (
    <>
      <BackLink />
      <PageHeader
        title={d.group.name}
        actions={
          <Button icon={<Link2 className="h-4 w-4" aria-hidden="true" />} onClick={copyInvite}>
            Copy invite link
          </Button>
        }
      >
        <p>{d.group.description}</p>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span>{d.group.visibility === 'private' ? 'Private' : 'Public'} · {plural(d.members.length, 'member')}</span>
          {isAdmin && <Pill tone="accent">you are {isOwner ? 'the owner' : 'an admin'}</Pill>}
        </p>
      </PageHeader>

      <div className="mb-6 border-b border-line">
        <nav aria-label="Group sections" className="-mb-px flex gap-1 overflow-x-auto">
          {([['problems', 'Problems'], ['vscode', 'VS Code time'], ['members', `Members · ${d.members.length}`]] as [View, string][]).map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-current={view === v ? 'page' : undefined}
              onClick={() => setView(v)}
              className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${view === v ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {view === 'problems' && <GroupWeekBoard groupId={d.group._id} groupName={d.group.name} meId={user.id} />}

      {view === 'vscode' && (
      <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented
          label="Board period"
          value={period === 'contest' ? ('contest' as Period) : period}
          onChange={(p) => (p === 'contest' ? setContestOpen(true) : set(p))}
          options={[
            { value: 'week', label: 'This week' },
            { value: '7d', label: 'Last 7 days' },
            { value: 'all', label: 'All time' },
            ...(period === 'contest' ? [{ value: 'contest' as Period, label: periodLabel }] : []),
          ]}
        />
        <Button size="sm" variant="ghost" onClick={() => setContestOpen(true)}>Set contest dates</Button>
        {q.isFetching && <span className="font-mono text-xs text-muted">updating…</span>}
      </div>

      {/* Wide screens: the tower and the race chart side by side; otherwise stacked. */}
      <div className="mb-6 grid grid-cols-12 gap-4">
        <Card className={`col-span-12 min-w-0 p-4 sm:p-5 ${showRace ? '2xl:col-span-7' : ''}`}>
          <CardTitle aside={isAll ? 'cells: last 7 days' : periodLabel}>VS Code time</CardTitle>
          <p className="-mt-2 mb-3 text-sm text-muted">Time tracked by the VS Code extension, for people who use it. Each small box is one day. This doesn't change the problems ranking.</p>
          {ranked.length === 0 ? (
            <EmptyState title="No members yet" />
          ) : (
            <StandingsTower
              rows={rows}
              label={`${d.group.name} standings, ${periodLabel}`}
              valueHeader={isAll ? 'Hours' : 'Behind leader'}
              dayHeader={keys.length ? `${weekdayShort(keys[0])} → ${weekdayShort(keys[keys.length - 1])}` : undefined}
              columns={[
                { label: 'Commits' },
                { label: 'Failed commands', title: 'Share of terminal commands that failed' },
                { label: 'Failed builds', title: 'Share of builds that failed' },
              ]}
            />
          )}
          {d.daily && <CellLegend className="mt-4 px-3" />}
        </Card>
        {showRace && (
          <Card className="col-span-12 min-w-0 p-4 sm:p-5 2xl:col-span-5">
            <CardTitle aside="running total of hours">How it unfolded</CardTitle>
            <RaceChart
              title={`${d.group.name}: running total of hours, ${periodLabel}`}
              dates={keys.slice(0, Math.max(1, futureFrom))}
              series={racers.map((r) => ({ id: r.id, name: r.name, isMe: r.isMe, values: (r.days ?? []).slice(0, Math.max(1, futureFrom)) }))}
            />
          </Card>
        )}
      </div>
      </>
      )}

      {view === 'members' && (
      <div className="flex flex-col gap-4">
      <Card className="p-5">
        <CardTitle aside={<span className="hidden sm:inline">{inviteUrl}</span>}>Members</CardTitle>
        <ul className="flex flex-col">
          {d.members.map((m) => {
            const can = memberActions(d.myRole, m.role, m.id === user.id);
            return (
            <li key={m.id} className="flex flex-wrap items-center gap-3 border-t border-line py-3 first:border-0">
              <Avatar name={m.name} size={36} />
              <span className="min-w-[140px] flex-1 font-medium">
                {m.name}
                {m.id === user.id && <span className="ml-2 font-mono text-[11px] text-accent-ink">you</span>}
                {m.role !== 'member' && <span className="ml-2 font-mono text-[11px] text-muted">{m.role}</span>}
              </span>
              <span className="font-mono text-xs text-muted">joined {new Date(m.joinedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              {can.promote && (
                <Button size="sm" variant="ghost" onClick={() => setRole(m.id, m.name, 'admin')}>
                  Make admin
                </Button>
              )}
              {can.demote && (
                <Button size="sm" variant="ghost" onClick={() => setRole(m.id, m.name, 'member')}>
                  Remove admin
                </Button>
              )}
              {can.transfer && (
                <Button size="sm" variant="ghost" onClick={() => setTransferring({ id: m.id, name: m.name })}>
                  Make owner
                </Button>
              )}
              {can.remove && (
                <Button size="sm" variant="danger" onClick={() => setRemoving({ id: m.id, name: m.name })}>
                  Remove
                </Button>
              )}
            </li>
            );
          })}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          {isAdmin && (
            <Button size="sm" icon={<Pencil className="h-4 w-4" aria-hidden="true" />} onClick={() => setRenameOpen(true)}>
              Rename group
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<LogOut className="h-4 w-4" aria-hidden="true" />} onClick={() => setLeaveOpen(true)}>
            Leave group
          </Button>
        </div>
      </Card>

      {isAdmin && <GroupAdminPanel groupId={d.group._id} />}
      </div>
      )}

      <ContestDialog
        open={contestOpen}
        onClose={() => setContestOpen(false)}
        initialFrom={fromKey || localDateKey(mondayOf(today))}
        initialTo={toKey || localDateKey(addDays(mondayOf(today), 6))}
        onApply={(from, to) => {
          set('contest', { from, to });
          setContestOpen(false);
        }}
      />
      <RenameDialog open={renameOpen} onClose={() => setRenameOpen(false)} groupId={d.group._id} name={d.group.name} description={d.group.description} />
      <Modal open={leaveOpen} onClose={() => setLeaveOpen(false)} title={`Leave ${d.group.name}?`} description={isOwner ? 'You are the owner. The longest-standing admin takes over, or the longest-standing member if there are no admins.' : 'You can join again later.'}>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setLeaveOpen(false)}>Stay</Button>
          <Button variant="danger" onClick={leave}>
            Leave group
          </Button>
        </div>
      </Modal>
      <Modal open={transferring !== null} onClose={() => setTransferring(null)} title={`Make ${transferring?.name ?? ''} the owner?`} description="You will stay in the group as an admin. Only the new owner can undo this.">
        <div className="flex justify-end gap-2">
          <Button onClick={() => setTransferring(null)}>Cancel</Button>
          <Button variant="primary" onClick={transfer}>
            Make owner
          </Button>
        </div>
      </Modal>
      <Modal open={removing !== null} onClose={() => setRemoving(null)} title={`Remove ${removing?.name ?? ''}?`} description="They will no longer see this board. They can join again with the invite link.">
        <div className="flex justify-end gap-2">
          <Button onClick={() => setRemoving(null)}>Cancel</Button>
          <Button variant="danger" onClick={remove}>
            Remove
          </Button>
        </div>
      </Modal>
    </>
  );
}

function BackLink() {
  return (
    <Link to="/groups" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold no-underline">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      All groups
    </Link>
  );
}

function ContestDialog({ open, onClose, initialFrom, initialTo, onApply }: { open: boolean; onClose: () => void; initialFrom: string; initialTo: string; onApply: (from: string, to: string) => void }) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const error = to < from ? 'The last day must be on or after the first day.' : undefined;
  return (
    <Modal open={open} onClose={onClose} title="Contest dates" description="The board counts only these days. The link to this board includes the dates, so you can share it.">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!error) onApply(from, to);
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <TextField label="First day" type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextField label="Last day" type="date" required value={to} min={from} onChange={(e) => setTo(e.target.value)} error={error} />
        </div>
        <Button type="submit" variant="primary" disabled={Boolean(error)}>
          Show this contest
        </Button>
      </form>
    </Modal>
  );
}

function RenameDialog({ open, onClose, groupId, name, description }: { open: boolean; onClose: () => void; groupId: string; name: string; description: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ groupName: name, groupDescription: description });
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiSend('PATCH', `/api/groups/${groupId}`, form);
      await qc.invalidateQueries({ queryKey: ['groups'] });
      toast('Group updated');
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Rename group">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField label="Name" required maxLength={80} value={form.groupName} onChange={(e) => setForm({ ...form, groupName: e.target.value })} />
        <TextField label="Description" required maxLength={500} value={form.groupDescription} onChange={(e) => setForm({ ...form, groupDescription: e.target.value })} />
        {error && (
          <p role="alert" className="text-sm text-bad-ink">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary">
          Save
        </Button>
      </form>
    </Modal>
  );
}
