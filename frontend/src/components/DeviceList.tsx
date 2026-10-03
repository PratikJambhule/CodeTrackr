import { useQuery } from '@tanstack/react-query';
import { MonitorSmartphone } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { apiGet } from '../api';
import { API_URL } from '../config';

interface DeviceToken {
  id: string;
  clientName: string;
  hint: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

/**
 * VS Code installs connected through "CodeTrackr: Sign In" (roadmap item 13).
 * Each has its own key, so one lost laptop can be cut off without touching
 * the others or the profile key.
 */
export default function DeviceList() {
  const { theme } = useTheme();
  const devices = useQuery({ queryKey: ['device-tokens'], queryFn: () => apiGet<DeviceToken[]>('/api/device/tokens') });

  const revoke = async (d: DeviceToken) => {
    if (!window.confirm(`Disconnect ${d.clientName}? It will stop uploading until you sign in again.`)) return;
    await fetch(`${API_URL}/api/device/tokens/${d.id}`, { method: 'DELETE', credentials: 'include' });
    void devices.refetch();
  };

  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : 'never');

  return (
    <div className="backdrop-blur-lg rounded-2xl p-8 mt-6 border" style={{ backgroundColor: `${theme.colors.surface}cc`, borderColor: `${theme.colors.primary}40` }}>
      <div className="flex items-center gap-3 mb-4">
        <MonitorSmartphone className="w-6 h-6" style={{ color: theme.colors.primary }} />
        <h2 className="text-2xl font-bold" style={{ color: theme.colors.text }}>Connected devices</h2>
      </div>
      <p className="mb-4 text-sm" style={{ color: theme.colors.textSecondary }}>
        In VS Code, run <strong>CodeTrackr: Sign In</strong> to connect without copying a key. Each device gets its own key that expires after a year.
      </p>
      {devices.isPending && <p style={{ color: theme.colors.textSecondary }}>Loading…</p>}
      {devices.isError && <p role="alert" style={{ color: theme.colors.accent }}>Could not load your devices.</p>}
      {devices.data && devices.data.length === 0 && (
        <p style={{ color: theme.colors.textSecondary }}>No devices connected with Sign In yet.</p>
      )}
      <ul className="space-y-2">
        {devices.data?.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg p-3" style={{ backgroundColor: `${theme.colors.background}80` }}>
            <div className="flex-1 min-w-0">
              <div className="font-medium" style={{ color: theme.colors.text }}>{d.clientName}</div>
              <div className="text-xs font-mono truncate" style={{ color: theme.colors.textSecondary }}>
                {d.hint} · added {day(d.createdAt)} · last used {day(d.lastUsedAt)} · expires {day(d.expiresAt)}
              </div>
            </div>
            <button onClick={() => revoke(d)} className="text-sm px-3 py-1 rounded-md" style={{ border: `1px solid ${theme.colors.border}`, color: theme.colors.text }}>
              Disconnect
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
