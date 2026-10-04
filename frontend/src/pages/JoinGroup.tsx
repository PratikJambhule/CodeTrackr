import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Lock, Users } from 'lucide-react';
import { ApiError, apiSend, errorText } from '../api';
import { useGroupPreview } from '../hooks/queries';
import { Button, ButtonLink, Card, EmptyState, ErrorBox, Pill, Skeleton, TextField, useToast } from '../components/ui';
import { plural } from '../lib/format';

/** Where a group invite link lands (/join/:groupId). Signed-out visitors sign in first and come back. */
export default function JoinGroup() {
  const { groupId } = useParams();
  const q = useGroupPreview(groupId);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (q.isPending) return <Skeleton className="mx-auto mt-10 h-72 max-w-[520px]" />;
  if (q.isError) {
    const notFound = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400);
    return (
      <div className="mx-auto mt-10 max-w-[520px]">
        {notFound ? (
          <Card>
            <EmptyState icon={<Users className="h-10 w-10" />} title="This invite link does not lead to a group" action={<ButtonLink to="/groups">Browse groups</ButtonLink>}>
              The group may have been deleted, or the link was copied incompletely.
            </EmptyState>
          </Card>
        ) : (
          <ErrorBox message={errorText(q.error)} onRetry={() => q.refetch()} />
        )}
      </div>
    );
  }

  const { group, memberCount, isMember } = q.data;
  const isPrivate = group.visibility === 'private';

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await apiSend('POST', `/api/groups/${group._id}/join`, isPrivate ? { password } : {});
      await qc.invalidateQueries({ queryKey: ['groups'] });
      toast(`Joined ${group.name}`);
      navigate(`/groups/${group._id}`, { replace: true });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-6 max-w-[520px]">
      <Card className="p-7 shadow-card">
        <div className="eyebrow mb-3">You are invited to</div>
        <h1 className="display text-balance text-[52px]">{group.name}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {isPrivate ? (
            <Pill>
              <Lock className="h-3 w-3" aria-hidden="true" /> private
            </Pill>
          ) : (
            <Pill>public</Pill>
          )}
          <span className="text-sm text-muted">
            {plural(memberCount, 'member')} · created by {group.createdBy?.name ?? 'someone'}
          </span>
        </div>
        {group.description && <p className="mt-4 text-muted">{group.description}</p>}
        {isMember ? (
          <div className="mt-7">
            <p className="mb-4 font-semibold text-good-ink">You are already in this group.</p>
            <ButtonLink to={`/groups/${group._id}`} variant="primary">
              Open the board
            </ButtonLink>
          </div>
        ) : (
          <form onSubmit={join} className="mt-7 flex flex-col gap-4">
            {isPrivate && (
              <TextField
                label="Group password"
                type="password"
                required
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                hint="Ask the person who sent you the link."
                error={error || undefined}
              />
            )}
            {!isPrivate && error && (
              <p role="alert" className="text-sm text-bad-ink">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" disabled={busy}>
              {busy ? 'Joining…' : `Join ${group.name}`}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
