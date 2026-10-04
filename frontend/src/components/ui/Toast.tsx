import { useCallback, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { ToastContext, type ToastTone } from './toastContext';

interface Toast {
  id: number;
  tone: ToastTone;
  text: string;
}

/**
 * Short confirmations ("Joined CSE Squad", "Copied") in a polite live region,
 * instead of the old blocking alert() boxes.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (id: number) => setToasts((all) => all.filter((t) => t.id !== id));
  const show = useCallback((text: string, tone: ToastTone = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-2), { id, tone, text }]);
    window.setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end lg:pr-6">
        {toasts.map((t) => {
          const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'error' ? TriangleAlert : Info;
          const tone = t.tone === 'success' ? 'text-good-ink' : t.tone === 'error' ? 'text-bad-ink' : 'text-accent-ink';
          return (
            <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'} className="card pointer-events-auto flex max-w-sm items-start gap-3 px-4 py-3 shadow-card">
              <Icon className={`mt-0.5 h-5 w-5 flex-none ${tone}`} aria-hidden="true" />
              <span className="text-sm text-ink">{t.text}</span>
              <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="-mr-1 ml-1 rounded p-1 text-muted hover:text-ink">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
