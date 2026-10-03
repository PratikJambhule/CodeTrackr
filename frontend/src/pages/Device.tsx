import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MonitorSmartphone, CheckCircle } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { API_URL } from '../config';

/**
 * Approve a VS Code sign-in (roadmap item 13). The extension shows a code like
 * WXYZ-2345 and opens this page; approving it gives that VS Code its own
 * revocable key, so nobody has to copy an API key by hand.
 */
export default function Device() {
  const { theme } = useTheme();
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get('code') || '');
  const [clientName, setClientName] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);

  // Look the code up so the user sees which device they are approving.
  useEffect(() => {
    setClientName(null);
    setMessage('');
    const compact = code.replace(/[\s-]/g, '');
    if (compact.length !== 8) return;
    let cancelled = false;
    fetch(`${API_URL}/api/device/pending/${encodeURIComponent(compact)}`, { credentials: 'include' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) setClientName(data.clientName);
        else setMessage(data.message || 'That code is not valid or has expired.');
      })
      .catch(() => { if (!cancelled) setMessage('Could not reach the server.'); });
    return () => { cancelled = true; };
  }, [code]);

  const approve = async () => {
    setBusy(true);
    setMessage('');
    try {
      const res = await fetch(`${API_URL}/api/device/approve`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userCode: code }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setApproved(true);
      else setMessage(data.message || 'Could not approve that code.');
    } catch {
      setMessage('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const card = { backgroundColor: `${theme.colors.surface}cc`, borderColor: `${theme.colors.primary}40` };

  return (
    <div className="min-h-screen py-12 px-4" style={{ backgroundColor: theme.colors.background }}>
      <div className="max-w-md mx-auto rounded-2xl p-8 border" style={card}>
        <div className="flex items-center gap-3 mb-4">
          <MonitorSmartphone className="w-6 h-6" style={{ color: theme.colors.primary }} />
          <h1 className="text-2xl font-bold" style={{ color: theme.colors.text }}>Connect VS Code</h1>
        </div>

        {approved ? (
          <p role="status" className="flex items-center gap-2" style={{ color: theme.colors.text }}>
            <CheckCircle className="w-5 h-5" style={{ color: theme.colors.primary }} />
            Done. {clientName || 'VS Code'} is connected; you can close this tab.
          </p>
        ) : (
          <>
            <p className="mb-4 text-sm" style={{ color: theme.colors.textSecondary }}>
              Enter the code shown in VS Code. Only approve a code that YOUR editor is showing right now.
            </p>
            <label htmlFor="device-code" className="block text-sm mb-1" style={{ color: theme.colors.text }}>Code</label>
            <input
              id="device-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="WXYZ-2345"
              maxLength={9}
              autoComplete="off"
              className="w-full font-mono text-xl tracking-widest px-3 py-2 rounded-lg mb-3"
              style={{ backgroundColor: theme.colors.background, color: theme.colors.text, border: `1px solid ${theme.colors.border}` }}
            />
            {clientName && (
              <p className="mb-3 text-sm" style={{ color: theme.colors.textSecondary }}>
                Device: <strong style={{ color: theme.colors.text }}>{clientName}</strong>
              </p>
            )}
            {message && <p role="alert" className="mb-3 text-sm" style={{ color: theme.colors.accent }}>{message}</p>}
            <button
              onClick={approve}
              disabled={!clientName || busy}
              className="w-full py-3 rounded-lg text-white font-semibold disabled:opacity-50"
              style={{ background: `linear-gradient(to right, ${theme.colors.primary}, ${theme.colors.accent})` }}
            >
              {busy ? 'Approving…' : 'Approve this device'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
