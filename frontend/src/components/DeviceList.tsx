import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Laptop } from 'lucide-react';
import { apiSend, errorText } from '../api';
import { useDevices } from '../hooks/queries';
import type { DeviceToken } from '../types';
import { Button, EmptyState, Modal, Skeleton, useToast } from './ui';
import { relativeDay, localDateKey, timeAgo } from '../lib/format';

/**
 * VS Code installs connected with "CodeTrackr: Sign In". Each has its own key,
 * so one lost laptop can be cut off without touching the others.
 */
export default function DeviceList() {
  const devices = useDevices();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState<DeviceToken | null>(null);

  const revoke = async () => {
    if (!confirm) return;
    try {
      await apiSend('DELETE', `/api/device/tokens/${confirm.id}`);
      await qc.invalidateQueries({ queryKey: ['devices'] });
      toast(`Disconnected ${confirm.clientName}`);
    } catch (err) {
      toast(errorText(err), 'error');
    }
    setConfirm(null);
  };

  if (devices.isPending) return <Skeleton className="h-24" />;
  if (devices.isError) return <p role="alert" className="text-sm text-bad-ink">Could not load your devices. {errorText(devices.error)}</p>;
  if (!devices.data.length) {
    return (
      <EmptyState icon={<Laptop className="h-9 w-9" />} title="No computers connected with Sign In yet">
        In VS Code, run <span className="font-mono text-[13px] text-ink">CodeTrackr: Sign In</span> and approve the code on this website.
      </EmptyState>
    );
  }
  return (
    <>
      <ul className="flex flex-col">
        {devices.data.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-3 border-t border-line py-3.5 first:border-0 first:pt-0">
            <Laptop className="h-5 w-5 flex-none text-muted" aria-hidden="true" />
            <div className="min-w-[200px] flex-1">
              <div className="font-semibold text-ink">{d.clientName}</div>
              <div className="font-mono text-[12px] text-muted">
                {d.lastUsedAt ? `last upload ${timeAgo(d.lastUsedAt)}` : 'not used yet'} · key expires {relativeDay(localDateKey(new Date(d.expiresAt)))} · {d.hint}
              </div>
            </div>
            <Button size="sm" variant="danger" onClick={() => setConfirm(d)}>
              Disconnect
            </Button>
          </li>
        ))}
      </ul>
      <Modal open={confirm !== null} onClose={() => setConfirm(null)} title={`Disconnect ${confirm?.clientName ?? ''}?`} description="It stops uploading straight away. Run CodeTrackr: Sign In on it to connect it again.">
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirm(null)}>Keep it</Button>
          <Button variant="danger" onClick={revoke}>
            Disconnect
          </Button>
        </div>
      </Modal>
    </>
  );
}
