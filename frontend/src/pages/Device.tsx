import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Laptop } from 'lucide-react';
import { ApiError, apiGet, apiSend, errorText } from '../api';
import { Button, ButtonLink, Card } from '../components/ui';

/**
 * Approve a VS Code sign-in (device flow, roadmap item 13). The extension shows
 * a code like WXYZ-2345 and opens this page; approving gives that VS Code its
 * own key, so nobody copies a key by hand.
 */
export default function Device() {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const [code, setCode] = useState((params.get('code') || '').toUpperCase());
  const [clientName, setClientName] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);

  // Look the code up so the person sees which device they are approving.
  useEffect(() => {
    setClientName(null);
    setMessage('');
    const compact = code.replace(/[\s-]/g, '');
    if (compact.length !== 8) return;
    let cancelled = false;
    apiGet<{ clientName: string }>(`/api/device/pending/${encodeURIComponent(compact)}`)
      .then((d) => !cancelled && setClientName(d.clientName))
      .catch((err) => {
        if (cancelled) return;
        setMessage(err instanceof ApiError && err.status < 500 ? 'That code is not valid or has expired. Run CodeTrackr: Sign In again for a new one.' : errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const approve = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await apiSend('POST', '/api/device/approve', { userCode: code });
      setApproved(true);
      void qc.invalidateQueries({ queryKey: ['devices'] });
    } catch (err) {
      setMessage(errorText(err, 'Could not approve that code.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-6 max-w-[480px]">
      <Card className="p-7 shadow-card">
        <div className="mb-5 flex items-center gap-3">
          <Laptop className="h-6 w-6 text-accent" aria-hidden="true" />
          <h1 className="display text-balance text-[44px]">Connect VS Code</h1>
        </div>
        {approved ? (
          <div role="status" className="flex flex-col gap-4">
            <p className="flex items-center gap-2 text-lg font-semibold text-good-ink">
              <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
              {clientName ?? 'VS Code'} is connected.
            </p>
            <p className="text-muted">You can close this tab. Your first summary arrives after about two minutes of coding.</p>
            <ButtonLink to="/dashboard" variant="primary">
              Go to the dashboard
            </ButtonLink>
          </div>
        ) : (
          <form onSubmit={approve} className="flex flex-col gap-4">
            <p className="text-muted">
              Enter the code VS Code is showing. Only approve a code that <strong className="text-ink">your own</strong> editor is showing right now.
            </p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="device-code" className="text-sm font-medium">
                Code
              </label>
              <input
                id="device-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="WXYZ-2345"
                maxLength={9}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={message ? 'device-message' : undefined}
                className="rounded-xl border border-line-strong bg-bg px-4 py-3 text-center font-mono text-[26px] tracking-[0.15em] text-ink focus:border-accent focus:outline-none"
              />
            </div>
            {clientName && (
              <p className="text-sm text-muted">
                Device: <strong className="text-ink">{clientName}</strong>
              </p>
            )}
            {message && (
              <p id="device-message" role="alert" className="text-sm text-bad-ink">
                {message}
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" disabled={!clientName || busy}>
              {busy ? 'Approving…' : 'Approve this device'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
