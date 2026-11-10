import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { ApiError, apiSend, errorText } from '../api';
import { useInvitePreview } from '../hooks/queries';
import { Button, ButtonLink, Card, EmptyState, ErrorBox, Pill, Skeleton, useToast } from '../components/ui';
import { plural } from '../lib/format';

/** Where a one-off invite link lands (/invite/:token). No group password is needed. */
export default function InviteJoin() {
  const { token } = useParams();
  const q = useInvitePreview(token);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (q.isPending) return <Skeleton className="mx-auto mt-10 h-72 max-w-[520px]" />;
  if (q.isError) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <div className="mx-auto mt-10 max-w-[520px]">
        {gone ? (
          <Card>
            <EmptyState icon={<Users className="h-10 w-10" />} title="This invite link is not valid any more" action={<ButtonLink to="/groups">Browse groups</ButtonLink>}>
              It may have expired, been revoked or run out of uses. Ask the group admin for a new one.
            </EmptyState>
          </Card>
        ) : (
          <ErrorBox message={errorText(q.error)} onRetry={() => q.refetch()} />
        )}
      </div>
    );
  }

  const { group, memberCount, isMember } = q.data;
  const join = async () => {
    setBusy(true);
    setError('');
    try {
      await apiSend('POST', '/api/groups/invites/join', { token });
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
        <div className="mt-3">
          <Pill>{plural(memberCount, 'member')}</Pill>
        </div>
        <p className="mt-4 text-muted">{group.description}</p>
        {group.createdByName && <p className="mt-2 text-sm text-muted">Owner: {group.createdByName}</p>}
        <p className="mt-4 text-sm text-muted">Members see each other's coding hours, commits and build failures on the group board, and problems solved and GitHub pushes for verified accounts.</p>
        {error && <p role="alert" className="mt-4 text-sm text-bad-ink">{error}</p>}
        <div className="mt-6">
          {isMember ? (
            <ButtonLink to={`/groups/${group._id}`}>Open the group</ButtonLink>
          ) : (
            <Button variant="primary" disabled={busy} onClick={join}>
              Join group
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
