import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Link2, Trash2 } from 'lucide-react';
import { apiSend, errorText } from '../api';
import { useGroupAudit, useGroupInvites } from '../hooks/queries';
import { auditText } from '../lib/groupRoles';
import { plural } from '../lib/format';
import type { CreatedInvite } from '../types';
import { Button, Card, CardTitle, EmptyState, ErrorBox, SelectField, Skeleton, useToast } from './ui';

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Invite links and the activity log. Shown to the owner and admins only. */
export function GroupAdminPanel({ groupId }: { groupId: string }) {
  const invites = useGroupInvites(groupId);
  const audit = useGroupAudit(groupId);
  const qc = useQueryClient();
  const toast = useToast();
  const [days, setDays] = useState(7);
  const [maxUses, setMaxUses] = useState(25);
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['groups', 'invites', groupId] }),
    qc.invalidateQueries({ queryKey: ['groups', 'audit', groupId] }),
  ]);
  const link = created ? `${window.location.origin}/invite/${created.token}` : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied');
    } catch {
      toast('Select the link and copy it', 'info');
    }
  };
  const create = async () => {
    setBusy(true);
    try {
      const res = await apiSend<{ invite: CreatedInvite }>('POST', `/api/groups/${groupId}/invites`, { days, maxUses });
      setCreated(res.invite);
      await refresh();
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    try {
      await apiSend('DELETE', `/api/groups/${groupId}/invites/${id}`);
      if (created?.id === id) setCreated(null);
      await refresh();
      toast('Invite link revoked');
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <CardTitle aside="admins only">Invite links</CardTitle>
        <p className="mb-4 text-sm text-muted">Anyone with a link can join without the group password, until it expires or runs out.</p>
        <div className="flex flex-wrap items-end gap-3">
          <SelectField label="Expires in" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>1 day</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
          </SelectField>
          <SelectField label="Can be used" value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))}>
            <option value={1}>1 time</option>
            <option value={5}>5 times</option>
            <option value={25}>25 times</option>
            <option value={500}>500 times</option>
          </SelectField>
          <Button icon={<Link2 className="h-4 w-4" aria-hidden="true" />} disabled={busy} onClick={create}>
            Create link
          </Button>
        </div>

        {created && (
          <div className="mt-4 rounded-lg border border-line p-3">
            <div className="mb-2 text-sm font-medium text-ink">Copy this link now. It is shown only once.</div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all font-mono text-xs text-muted">{link}</code>
              <Button size="sm" icon={<Copy className="h-4 w-4" aria-hidden="true" />} onClick={copy}>
                Copy
              </Button>
            </div>
          </div>
        )}

        <div className="mt-4">
          {invites.isPending ? (
            <Skeleton className="h-16" />
          ) : invites.isError ? (
            <ErrorBox message={errorText(invites.error)} onRetry={() => invites.refetch()} />
          ) : invites.data.invites.length === 0 ? (
            <p className="text-sm text-muted">No active links.</p>
          ) : (
            <ul className="flex flex-col">
              {invites.data.invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 border-t border-line py-2.5 first:border-0">
                  <span className="min-w-[160px] flex-1 text-sm text-ink">
                    {i.uses} of {plural(i.maxUses, 'use')}
                    <span className="ml-2 font-mono text-xs text-muted">by {i.createdByName ?? 'someone who left'}</span>
                  </span>
                  <span className="font-mono text-xs text-muted">until {when(i.expiresAt)}</span>
                  <Button size="sm" variant="ghost" aria-label="Revoke this invite link" icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={() => revoke(i.id)}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <CardTitle aside="last 50">Activity log</CardTitle>
        {audit.isPending ? (
          <Skeleton className="h-32" />
        ) : audit.isError ? (
          <ErrorBox message={errorText(audit.error)} onRetry={() => audit.refetch()} />
        ) : audit.data.entries.length === 0 ? (
          <EmptyState title="Nothing yet">Admin actions in this group will appear here.</EmptyState>
        ) : (
          <ul className="flex max-h-[320px] flex-col overflow-y-auto">
            {audit.data.entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-line py-2.5 text-sm first:border-0">
                <span className="text-ink">
                  <span className="font-medium">{e.actorName ?? 'Someone who left'}</span> {auditText(e.action, e.targetName, e.detail)}
                </span>
                <span className="font-mono text-xs text-muted">{when(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
