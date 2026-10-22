import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { apiSend, errorText } from '../../api';
import { useSessions } from '../../hooks/queries';
import { Button, Card, CardTitle, ErrorBox, Pill, Skeleton } from '../../components/ui';
import { plural } from '../../lib/format';
import { TYPE_LABEL, WORK_GROUPS, groupLabel, groupMinutes, groupOf, sessionState, toLabel } from '../../lib/workTypes';
import type { WorkSession, WorkTypeId } from '../../types';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** The 5 types under their 3 group headings: what "Change" and blind questions offer. */
function TypeChoice({ onPick, busy }: { onPick: (t: WorkTypeId) => void; busy: boolean }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2" role="group" aria-label="Choose what kind of work this was">
      {WORK_GROUPS.map((g) => (
        <div key={g.id} className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-muted">{g.label}:</span>
          {g.types.map((t) => (
            <Button key={t} size="sm" disabled={busy} onClick={() => onPick(t)}>
              {TYPE_LABEL[t]}
            </Button>
          ))}
        </div>
      ))}
    </div>
  );
}

function SessionRow({ s }: { s: WorkSession }) {
  const qc = useQueryClient();
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const state = sessionState(s);

  async function label(type: WorkTypeId) {
    setBusy(true);
    setError('');
    try {
      await apiSend('PUT', '/api/sessions/label', { startAt: s.startAt, workType: type });
      setChoosing(false);
      await qc.invalidateQueries({ queryKey: ['sessions'] });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const said = s.userLabel ?? s.pickerLabel;
  return (
    <li className="rounded-xl bg-surface-2 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm">
          {when(s.startAt)} · {s.minutes} min{s.projects.length ? ` · ${s.projects.join(', ')}` : ''}
        </span>
        {state === 'answered' || state === 'picker' ? (
          <span className="flex items-center gap-2 text-sm">
            <Pill tone="good">{groupLabel(groupOf(said!.type))}</Pill>
            <span className="text-xs text-muted">
              {state === 'picker' ? 'you said in VS Code' : 'you said'}: {TYPE_LABEL[said!.type as WorkTypeId] ?? said!.type}
            </span>
            {!choosing && (
              <button type="button" className="text-xs text-accent-ink underline" onClick={() => setChoosing(true)}>
                Change
              </button>
            )}
          </span>
        ) : state === 'guess' ? (
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Looks like:</span>
            <Pill tone="accent">{s.workType?.type === 'not_sure' ? 'Not sure' : groupLabel(groupOf(s.workType?.type))}</Pill>
            {s.workType?.type !== 'not_sure' && !choosing && (
              <Button size="sm" disabled={busy} icon={<Check className="h-3.5 w-3.5" aria-hidden="true" />}
                onClick={() => label(s.workType!.type as WorkTypeId)}>
                Right
              </Button>
            )}
            {!choosing && (
              <Button size="sm" disabled={busy} onClick={() => setChoosing(true)}>
                {s.workType?.type === 'not_sure' ? 'Tell us' : 'Change'}
              </Button>
            )}
          </span>
        ) : state === 'blind' ? (
          <span className="text-sm font-medium">What was this session?</span>
        ) : (
          <span className="text-xs text-muted">Too short to say</span>
        )}
      </div>
      {state === 'guess' && s.workType?.reason && <p className="mt-1 text-xs text-muted">{s.workType.reason}</p>}
      {(choosing || state === 'blind') && <TypeChoice onPick={label} busy={busy} />}
      {error && <p className="mt-1 text-xs text-bad-ink" role="alert">{error}</p>}
    </li>
  );
}

/**
 * "How you worked" (plan W2): each session's kind of work, shown as 3 groups, with ✓ / Change.
 * About 1 in 5 sessions is asked without a guess, so the answers can test the guesses fairly.
 */
export function WorkSessions({ days }: { days: number }) {
  const window = Math.min(days, 60);
  const q = useSessions(window);
  const [onlyToLabel, setOnlyToLabel] = useState(false);

  if (q.isPending) return <Skeleton className="mb-6 h-56" />;
  if (q.isError) return <div className="mb-6"><ErrorBox message={errorText(q.error)} onRetry={() => q.refetch()} /></div>;

  const sessions = q.data.sessions;
  if (!sessions.length) return null;
  const pending = toLabel(sessions, 7);
  const shown = onlyToLabel ? pending : sessions.slice(0, 8);
  const mix = groupMinutes(sessions);

  return (
    <Card className="mb-6 p-5">
      <CardTitle aside={`last ${window} days`}>How you worked: {plural(sessions.length, 'session')}</CardTitle>
      <div className="mb-3 flex flex-wrap gap-2">
        {mix.map((g) => (
          <span key={g.label} className="rounded-full border border-line bg-surface-2 px-3 py-1 text-sm">
            {g.label}: <span className="text-muted">{g.minutes} min</span>
          </span>
        ))}
      </div>
      {pending.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-accent px-3 py-2 text-sm">
          <span>
            {onlyToLabel
              ? `${plural(pending.length, 'session')} from the last 7 days still need an answer.`
              : `Help CodeTrackr learn: ${plural(pending.length, 'session')} from the last 7 days ${pending.length === 1 ? 'needs' : 'need'} a one-tap answer.`}
          </span>
          <Button size="sm" variant={onlyToLabel ? 'secondary' : 'primary'} onClick={() => setOnlyToLabel((v) => !v)}>
            {onlyToLabel ? 'Show all sessions' : 'Label your past week'}
          </Button>
        </div>
      )}
      <ul className="flex flex-col gap-2">
        {shown.map((s) => <SessionRow key={s.startAt} s={s} />)}
      </ul>
      <p className="mt-3 text-xs text-muted">
        The guess comes from simple rules over your activity, not AI. Some sessions are asked without a
        guess so your answers can check how good the guesses are. Your answers are private.
      </p>
    </Card>
  );
}
