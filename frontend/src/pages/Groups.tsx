import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, Search, Users } from 'lucide-react';
import { apiSend, errorText } from '../api';
import { useDiscoverGroups, useMyGroups } from '../hooks/queries';
import { Button, Card, EmptyState, ErrorBox, Modal, PageHeader, Pill, Segmented, Skeleton, TextArea, TextField, useToast } from '../components/ui';
import type { Group } from '../types';

function GroupCard({ group, action, mine }: { group: Group; action: ReactNode; mine: boolean }) {
  return (
    <Card as="li" className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold text-ink">
          {mine ? (
            <Link to={`/groups/${group._id}`} className="text-ink no-underline hover:underline">
              {group.name}
            </Link>
          ) : (
            group.name
          )}
        </h3>
        {group.visibility === 'private' ? (
          <Pill title="Joined with a password">
            <Lock className="h-3 w-3" aria-hidden="true" />
            private
          </Pill>
        ) : (
          <Pill>public</Pill>
        )}
      </div>
      <p className="line-clamp-2 flex-1 text-sm text-muted">{group.description}</p>
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-xs text-muted">by {group.createdBy?.name ?? 'someone'}</span>
        {action}
      </div>
    </Card>
  );
}

function CreateGroup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ groupName: '', groupDescription: '', visibility: 'public' as 'public' | 'private', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await apiSend<{ group: Group }>('POST', '/api/groups/create', form);
      await qc.invalidateQueries({ queryKey: ['groups'] });
      toast(`Created ${res.group.name}. Share the invite link with your friends.`);
      onClose();
      navigate(`/groups/${res.group._id}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Create a group" description="You will be its admin: you can rename it and remove members.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField label="Name" required maxLength={80} value={form.groupName} onChange={(e) => setForm({ ...form, groupName: e.target.value })} placeholder="CSE Squad" />
        <TextArea label="Description" required maxLength={500} rows={3} value={form.groupDescription} onChange={(e) => setForm({ ...form, groupDescription: e.target.value })} placeholder="Weekly race before placements." />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-ink">Who can join</legend>
          <Segmented
            label="Who can join"
            value={form.visibility}
            onChange={(v) => setForm({ ...form, visibility: v })}
            options={[
              { value: 'public', label: 'Anyone signed in' },
              { value: 'private', label: 'Only with a password' },
            ]}
          />
        </fieldset>
        {form.visibility === 'private' && (
          <TextField label="Password" type="password" required autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} hint="Share it with your friends along with the invite link." />
        )}
        {error && (
          <p role="alert" className="text-sm text-bad-ink">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create group'}
        </Button>
      </form>
    </Modal>
  );
}

function JoinPrivate({ group, onClose }: { group: Group | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!group) return;
    setError('');
    try {
      await apiSend('POST', `/api/groups/${group._id}/join`, { password });
      await qc.invalidateQueries({ queryKey: ['groups'] });
      toast(`Joined ${group.name}`);
      onClose();
      navigate(`/groups/${group._id}`);
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <Modal open={group !== null} onClose={onClose} title={group ? `Join ${group.name}` : ''} description="This is a private group. Ask a member for the password.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField label="Password" type="password" required autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} error={error || undefined} />
        <Button type="submit" variant="primary">
          Join group
        </Button>
      </form>
    </Modal>
  );
}

export default function Groups() {
  const [tab, setTab] = useState<'mine' | 'discover'>('mine');
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState<Group | null>(null);
  const mine = useMyGroups();
  const discover = useDiscoverGroups(submitted, tab === 'discover');
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();

  const joinPublic = async (g: Group) => {
    try {
      await apiSend('POST', `/api/groups/${g._id}/join`, {});
      await qc.invalidateQueries({ queryKey: ['groups'] });
      toast(`Joined ${g.name}`);
      navigate(`/groups/${g._id}`);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };

  const list = tab === 'mine' ? mine : discover;
  return (
    <>
      <PageHeader
        eyebrow="Race your friends"
        title="Groups"
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setCreating(true)}>
            Create a group
          </Button>
        }
      >
        Each group has its own board. Pick a week and see who put in the hours.
      </PageHeader>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Segmented
          label="Groups to show"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'mine', label: 'My groups' },
            { value: 'discover', label: 'Discover' },
          ]}
        />
        {tab === 'discover' && (
          <form
            role="search"
            className="flex min-w-[240px] flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(search.trim());
            }}
          >
            <label htmlFor="group-search" className="sr-only">
              Search groups by name
            </label>
            <input
              id="group-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search groups by name"
              className="min-h-[44px] w-full flex-1 rounded-xl border border-line-strong bg-bg px-3.5 text-[15px] text-ink placeholder:text-faint focus:border-accent focus:outline-none"
            />
            <Button type="submit" aria-label="Search" icon={<Search className="h-4 w-4" aria-hidden="true" />} />
          </form>
        )}
      </div>

      {list.isPending ? (
        <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(280px,100%),1fr))]">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-[170px]" />
          ))}
        </ul>
      ) : list.isError ? (
        <ErrorBox message={errorText(list.error)} onRetry={() => list.refetch()} />
      ) : (list.data?.length ?? 0) === 0 ? (
        <Card>
          {tab === 'mine' ? (
            <EmptyState
              icon={<Users className="h-10 w-10" />}
              title="You are not in a group yet"
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    Create a group
                  </Button>
                  <Button onClick={() => setTab('discover')}>Find one to join</Button>
                </div>
              }
            >
              Make one for your friends and send them the invite link, or join an existing group.
            </EmptyState>
          ) : (
            <EmptyState icon={<Search className="h-10 w-10" />} title={submitted ? `No groups match “${submitted}”` : 'No other groups yet'}>
              Try another name, or create your own group.
            </EmptyState>
          )}
        </Card>
      ) : (
        <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(280px,100%),1fr))]">
          {list.data!.map((g) =>
            tab === 'mine' ? (
              <GroupCard
                key={g._id}
                group={g}
                mine
                action={
                  <Link to={`/groups/${g._id}`} className="text-sm font-semibold">
                    Open board
                  </Link>
                }
              />
            ) : (
              <GroupCard
                key={g._id}
                group={g}
                mine={false}
                action={
                  <Button size="sm" variant="secondary" onClick={() => (g.visibility === 'private' ? setJoining(g) : joinPublic(g))}>
                    Join
                  </Button>
                }
              />
            ),
          )}
        </ul>
      )}

      <CreateGroup open={creating} onClose={() => setCreating(false)} />
      <JoinPrivate group={joining} onClose={() => setJoining(null)} />
    </>
  );
}
