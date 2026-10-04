import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, LogOut } from 'lucide-react';
import { apiSend, errorText } from '../api';
import DeviceList from '../components/DeviceList';
import { signOut } from '../components/layout/signOut';
import { ThemeToggle } from '../components/layout/ThemeToggle';
import { Avatar, Button, Card, CardTitle, Modal, PageHeader, useToast } from '../components/ui';
import { readStored, writeStored } from '../lib/storage';
import type { Me } from '../types';

const TARGET_KEY = 'codetrackr.dailyTarget';

function ApiKeySection({ user }: { user: Me }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const regenerate = async () => {
    setBusy(true);
    try {
      const res = await apiSend<{ apiKey: string }>('POST', '/api/user/regenerate-api-key');
      setFresh(res.apiKey);
      await qc.invalidateQueries({ queryKey: ['me'] });
      setConfirm(false);
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Copy did not work. Select the key and copy it by hand.', 'info');
    }
  };

  return (
    <details className="card group p-5" open={fresh !== null}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-3">
          <KeyRound className="h-5 w-5 text-muted" aria-hidden="true" />
          <span className="text-lg font-semibold">Advanced: connect with an API key</span>
        </span>
        <span aria-hidden="true" className="font-mono text-xl text-muted transition group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="mt-4 flex flex-col gap-4 text-sm text-muted">
        <p>
          The older way to connect, for setups where Sign In is not possible: paste a key into VS Code with <span className="font-mono text-ink">CodeTrackr: Setup API Key</span>. Keys are
          stored hashed, so a key is shown only once, when it is created.
        </p>
        {fresh ? (
          <div role="status" className="flex flex-col gap-2">
            <span className="font-semibold text-ink">Your new key. Copy it now: it will not be shown again.</span>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-xl border border-line-strong bg-bg px-3 py-2.5 font-mono text-[13px] text-ink">{fresh}</code>
              <Button onClick={copy} icon={copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        ) : (
          <p>
            Active key:{' '}
            <span className="font-mono text-ink">
              {user.apiKeyHint ?? (user.legacyApiKey ? 'an old-format key (still works; create a new one to upgrade)' : 'none')}
            </span>
            {user.apiKeyHint && <span> (its id and last four characters, not the key itself)</span>}
          </p>
        )}
        <div>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            {user.hasApiKey || user.legacyApiKey ? 'Create a new key' : 'Create a key'}
          </Button>
        </div>
        <p className="text-xs">Creating a new key stops the old one at once. Computers connected with Sign In are not affected: they have their own keys.</p>
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Create a new API key?" description="Any VS Code still using the old key will stop uploading until you paste the new one.">
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
          <Button variant="danger" disabled={busy} onClick={regenerate}>
            {busy ? 'Creating…' : 'Create new key'}
          </Button>
        </div>
      </Modal>
    </details>
  );
}

export default function Profile({ user }: { user: Me }) {
  const [target, setTarget] = useState(() => readStored(TARGET_KEY) ?? '2');
  const joined = user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  return (
    <>
      <PageHeader eyebrow="Your account" title="Profile" />
      <div className="flex flex-col gap-6">
        <Card className="flex flex-wrap items-center gap-5 p-6">
          <Avatar name={user.name} src={user.profilePictureUrl} size={72} />
          <div className="min-w-0 flex-1">
            <div className="text-2xl font-semibold">{user.name}</div>
            <div className="text-muted">{user.email}</div>
            {joined && <div className="mt-1 font-mono text-[12px] text-muted">joined {joined}</div>}
          </div>
          <Button variant="ghost" icon={<LogOut className="h-4 w-4" aria-hidden="true" />} onClick={signOut}>
            Sign out
          </Button>
        </Card>

        <Card className="p-6">
          <CardTitle>Connected computers</CardTitle>
          <p className="mb-5 text-sm text-muted">
            To connect a computer, run <span className="font-mono text-ink">CodeTrackr: Sign In</span> in VS Code and approve the code on this site. Each one gets its own key that
            expires after a year.
          </p>
          <DeviceList />
        </Card>

        <Card className="p-6">
          <CardTitle>Preferences</CardTitle>
          <div className="flex flex-wrap items-end gap-8">
            <div>
              <div className="mb-2 text-sm font-medium">Theme</div>
              <ThemeToggle withLabels />
            </div>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Daily target
              <select
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  writeStored(TARGET_KEY, e.target.value);
                }}
                className="min-h-[44px] rounded-xl border border-line-strong bg-bg px-3 text-ink"
              >
                {[1, 2, 3, 4, 6].map((h) => (
                  <option key={h} value={String(h)}>
                    {h} hours a day
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mt-4 text-xs text-muted">Kept in this browser only.</p>
        </Card>

        <ApiKeySection user={user} />

        <p className="text-sm text-muted">
          What CodeTrackr records and how to have it deleted: <Link to="/privacy">privacy page</Link>.
        </p>
      </div>
    </>
  );
}
