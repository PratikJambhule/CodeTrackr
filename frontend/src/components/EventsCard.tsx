import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Trophy } from 'lucide-react';
import { apiSend, errorText } from '../api';
import { useMyEvents } from '../hooks/queries';
import type { HackEvent } from '../types';
import { Button, Card, CardTitle, Modal, Pill, SelectField, TextArea, TextField } from './ui';

const STATUS: Record<HackEvent['status'], string> = { upcoming: 'upcoming', live: 'live now', ended: 'ended' };
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** datetime-local wants local time without a zone. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function CreateEvent({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const start = new Date(Date.now() + 864e5);
  start.setMinutes(0, 0, 0);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startsAt, setStartsAt] = useState(localInput(start));
  const [endsAt, setEndsAt] = useState(localInput(new Date(start.getTime() + 24 * 3600e3)));
  const [editorRule, setEditorRule] = useState<'any' | 'vscode'>('any');
  const [maxTeamSize, setMaxTeamSize] = useState(4);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await apiSend<{ event: HackEvent }>('POST', '/api/events', {
        name, description, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), editorRule, maxTeamSize,
      });
      await qc.invalidateQueries({ queryKey: ['events'] });
      navigate(`/events/${res.event.id}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create a hackathon" description="You will be the organiser. Share the event link; people make or join teams there.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="e.g. SPIT Hack 2027" />
        <TextArea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
          <TextField label="Ends" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required hint="At most 7 days long" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Editor" value={editorRule} onChange={(e) => setEditorRule(e.target.value as 'any' | 'vscode')}
            hint={editorRule === 'vscode' ? 'Everyone must connect the VS Code extension' : 'Pushes count from any editor'}>
            <option value="any">Any editor</option>
            <option value="vscode">VS Code required</option>
          </SelectField>
          <SelectField label="Team size" value={maxTeamSize} onChange={(e) => setMaxTeamSize(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>Up to {n}</option>)}
          </SelectField>
        </div>
        {error && <p role="alert" className="text-sm text-bad-ink">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || name.trim().length < 3}>Create event</Button>
        </div>
      </form>
    </Modal>
  );
}

/** The header button on the Groups page. */
export function CreateEventButton() {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <Button icon={<Trophy className="h-4 w-4" aria-hidden="true" />} onClick={() => setCreating(true)}>Create a hackathon</Button>
      <CreateEvent open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

/** Hackathons you organise or have a team in. Nothing is shown when there are none. */
export function EventsCard() {
  const q = useMyEvents();
  const events = q.data?.events ?? [];
  if (q.isError) return <p role="alert" className="mb-6 text-sm text-bad-ink">{errorText(q.error)}</p>;
  if (!events.length) return null;
  return (
    <Card className="mb-6 p-5">
      <CardTitle>Your hackathons</CardTitle>
      {(
        <ul className="flex flex-col">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-3 border-t border-line py-2.5 first:border-0">
              <Link to={`/events/${e.id}`} className="font-medium">{e.name}</Link>
              <Pill tone={e.status === 'live' ? 'accent' : 'neutral'}>{STATUS[e.status]}</Pill>
              <span className="ml-auto font-mono text-xs text-muted">{when(e.startsAt)} – {when(e.endsAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
