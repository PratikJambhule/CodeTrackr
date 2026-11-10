import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Link2, RefreshCw } from 'lucide-react';
import { ApiError, apiSend, errorText } from '../api';
import { useEvent, useEventBoard } from '../hooks/queries';
import { hm, plural, timeAgo } from '../lib/format';
import type { EventDetails } from '../types';
import { Button, Card, CardTitle, EmptyState, ErrorBox, PageHeader, Pill, Skeleton, TextField, useToast } from '../components/ui';

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const STATUS = { upcoming: 'Starts soon', live: 'Live now', ended: 'Ended' } as const;

function Teams({ d, eventId }: { d: EventDetails; eventId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['events', eventId] });
  const join = async (teamId: string, teamName: string) => {
    try {
      await apiSend('POST', `/api/events/${eventId}/teams/${teamId}/join`);
      await refresh();
      toast(`Joined ${teamName}`);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiSend('POST', `/api/events/${eventId}/teams`, { name: name.trim() });
      setName('');
      await refresh();
      toast('Team created');
    } catch (err) {
      setError(errorText(err));
    }
  };
  const canJoin = !d.myTeamId && d.event.status !== 'ended';
  return (
    <Card className="min-w-0 p-5">
      <CardTitle aside={`up to ${plural(d.event.maxTeamSize, 'person', 'people')} each`}>Teams</CardTitle>
      {d.teams.length === 0 ? (
        <p className="text-sm text-muted">No teams yet.</p>
      ) : (
        <ul className="flex flex-col">
          {d.teams.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 border-t border-line py-2.5 first:border-0">
              <span className="font-medium">{t.name}</span>
              {t.id === d.myTeamId && <Pill tone="accent">your team</Pill>}
              <span className="min-w-0 flex-1 truncate text-sm text-muted">{t.members.join(', ')}</span>
              <span className="font-mono text-xs text-muted">{t.size}/{d.event.maxTeamSize}</span>
              {canJoin && (
                <Button size="sm" disabled={t.size >= d.event.maxTeamSize} onClick={() => join(t.id, t.name)}>
                  {t.size >= d.event.maxTeamSize ? 'Full' : 'Join'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canJoin && (
        <form onSubmit={create} className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <TextField label="Or start a team" value={name} onChange={(e) => setName(e.target.value)} placeholder="Team name" maxLength={40} error={error || undefined} className="min-w-[220px]" />
          <Button type="submit" variant="primary" disabled={name.trim().length < 2}>Create team</Button>
        </form>
      )}
    </Card>
  );
}

function MyTeam({ d }: { d: EventDetails }) {
  const team = d.teams.find((t) => t.id === d.myTeamId);
  if (!team) return null;
  return (
    <Card className="p-5">
      <p className="text-sm text-muted">Your team</p>
      <p className="mt-1 text-lg font-semibold text-ink">{team.name}</p>
      <p className="text-sm text-muted">{team.members.join(', ')}</p>
      <p className="mt-3 text-sm"><Link to={`/groups/${team.id}`}>Team page</Link> <span className="text-muted">to leave or see its VS Code time.</span></p>
    </Card>
  );
}

function Board({ eventId, isOrganizer, vscodeRule, aside }: { eventId: string; isOrganizer: boolean; vscodeRule: boolean; aside?: ReactNode }) {
  const q = useEventBoard(eventId);
  const toast = useToast();
  const qc = useQueryClient();
  if (q.isPending) return <Skeleton className="mb-6 h-48" />;
  if (q.isError) return <div className="mb-6"><ErrorBox message={errorText(q.error)} onRetry={() => q.refetch()} /></div>;
  const b = q.data;
  const refresh = async () => {
    try {
      const r = await apiSend<{ accounts: number }>('POST', `/api/events/${eventId}/refresh`);
      toast(`Asking GitHub for ${plural(r.accounts, 'account')}. Check back in a minute.`);
      setTimeout(() => qc.invalidateQueries({ queryKey: ['events', eventId, 'board'] }), 30000);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };
  const showTime = vscodeRule || b.teams.some((t) => t.vscodeSeconds > 0);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="min-w-0 p-5">
        <CardTitle aside={b.status === 'live' ? 'updates every minute' : undefined}>Activity</CardTitle>
        <p className="-mt-2 mb-4 text-sm text-muted">
          Counts between the start and the end: pushes to public GitHub repos from verified accounts{showTime ? ', and time tracked in VS Code' : ''}. This shows activity, not the quality of a project. It is not judging.
          GitHub can take a while to show a push; accounts refresh every hour.
        </p>
        {b.teams.length === 0 ? (
          <EmptyState title="No teams yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="border-b border-line py-2 pr-4 font-medium">Team</th>
                  <th scope="col" className="border-b border-line py-2 pr-4 text-right font-medium">GitHub pushes</th>
                  {showTime && <th scope="col" className="border-b border-line py-2 pr-4 text-right font-medium">VS Code time</th>}
                  <th scope="col" className="border-b border-line py-2 pr-4 text-right font-medium">Last push</th>
                </tr>
              </thead>
              <tbody>
                {b.teams.map((t) => (
                  <tr key={t.id}>
                    <td className="border-b border-line py-2.5 pr-4">
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs text-muted">{t.members.map((m) => m.name).join(', ')}</div>
                    </td>
                    <td className="border-b border-line py-2.5 pr-4 text-right font-mono">{t.pushes}</td>
                    {showTime && <td className="border-b border-line py-2.5 pr-4 text-right font-mono">{hm(t.vscodeSeconds)}</td>}
                    <td className="border-b border-line py-2.5 pr-4 text-right font-mono text-xs text-muted">{t.lastPushAt ? timeAgo(t.lastPushAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <aside className="flex flex-col gap-4">
      {aside}
      {isOrganizer && b.checks && (
        <Card className="p-5">
          <CardTitle aside="only you see this">For the organiser</CardTitle>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Button size="sm" icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />} onClick={refresh}>Refresh GitHub now</Button>
            <span className="text-xs text-muted">{b.lastRefreshAt ? `last asked ${timeAgo(b.lastRefreshAt)}` : 'at most once every 5 minutes'}</span>
          </div>
          {b.checks.length === 0 ? (
            <p className="text-sm text-muted">Nothing to check right now.</p>
          ) : (
            <>
              <p className="mb-2 text-sm text-muted">Worth a look. These are facts from the counts, not penalties.</p>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                {b.checks.map((c, i) => <li key={i}>{c.text}</li>)}
              </ul>
            </>
          )}
        </Card>
      )}
      </aside>
    </div>
  );
}

/** A hackathon: details, teams, and the activity board while it runs (D-71). */
export default function EventPage() {
  const { eventId = '' } = useParams();
  const q = useEvent(eventId);
  const toast = useToast();
  if (q.isPending) return <Skeleton className="h-80" />;
  if (q.isError) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return missing
      ? <Card><EmptyState title="This event does not exist">The link may be wrong, or the event was removed.</EmptyState></Card>
      : <ErrorBox message={errorText(q.error)} onRetry={() => q.refetch()} />;
  }
  const d = q.data;
  const e = d.event;
  const copy = async () => {
    const url = `${window.location.origin}/events/${e.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Event link copied');
    } catch {
      toast(`Copy this link: ${url}`, 'info');
    }
  };
  return (
    <>
      <PageHeader
        title={e.name}
        actions={<Button icon={<Link2 className="h-4 w-4" aria-hidden="true" />} onClick={copy}>Copy event link</Button>}
      >
        {e.description && <p>{e.description}</p>}
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <Pill tone={e.status === 'live' ? 'accent' : 'neutral'}>{STATUS[e.status]}</Pill>
          <span>{when(e.startsAt)} – {when(e.endsAt)}</span>
          <span>{e.editorRule === 'vscode' ? 'VS Code required' : 'Any editor'}</span>
          <span>Teams of up to {e.maxTeamSize}</span>
          <span>Organiser: {e.organizerName ?? 'someone who left'}</span>
        </p>
      </PageHeader>
      {(d.myTeamId || e.isOrganizer) ? (
        <Board
          eventId={e.id}
          isOrganizer={e.isOrganizer}
          vscodeRule={e.editorRule === 'vscode'}
          aside={d.myTeamId ? <MyTeam d={d} /> : <Teams d={d} eventId={e.id} />}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Teams d={d} eventId={e.id} />
          <Card className="p-5 text-sm text-muted">
            <h3 className="mb-2 text-base font-semibold text-ink">How it works</h3>
            <p>Join or start a team. Once you are in, you'll see every team's activity during the event.</p>
            <p className="mt-2">Pushes only count from a GitHub account verified on your <Link to="/profile">profile</Link>{e.editorRule === 'vscode' ? ', and this event asks you to connect the VS Code extension before it starts' : ''}.</p>
          </Card>
        </div>
      )}
    </>
  );
}
