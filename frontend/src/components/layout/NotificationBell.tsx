import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Bell, CircleCheck, TriangleAlert, X } from 'lucide-react';
import { apiGet, apiSend } from '../../api';
import { useNotifications, useUnreadCount } from '../../hooks/queries';
import { timeAgo } from '../../lib/format';
import type { AppNotification } from '../../types';
import { usePopover } from './usePopover';

const ICON = { deadline_reminder: AlarmClock, deadline_missed: TriangleAlert, goal_completed: CircleCheck } as const;
const TONE = { deadline_reminder: 'text-warn-ink', deadline_missed: 'text-bad-ink', goal_completed: 'text-good-ink' } as const;

function browserNotificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * Goal reminders. The unread count is polled every 30 s; the list loads when
 * the panel opens, and opening it counts as reading: the badge clears, and the
 * rows that were new stay highlighted until the panel closes. If the person
 * allows it, new reminders also appear as browser notifications.
 */
export function NotificationBell() {
  const qc = useQueryClient();
  const { open, setOpen, ref } = usePopover();
  const unread = useUnreadCount();
  const list = useNotifications(open);
  const [permission, setPermission] = useState(() => (browserNotificationsSupported() ? Notification.permission : 'denied'));
  const [permissionNote, setPermissionNote] = useState('');
  const shown = useRef(new Set<string>());
  const lastCount = useRef<number | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());

  // Opening the panel marks what it shows as read (it used to need a click per
  // row, so the same count greeted people on every visit).
  useEffect(() => {
    if (!open) {
      setFresh(new Set());
      return;
    }
    const unreadIds = (list.data ?? []).filter((n) => !n.read).map((n) => n._id);
    if (!unreadIds.length) return;
    setFresh((prev) => new Set([...prev, ...unreadIds]));
    apiSend('PATCH', '/api/notifications/mark-all-read')
      .then(() => qc.invalidateQueries({ queryKey: ['notifications', 'unread'], exact: true }))
      .catch(() => {});
  }, [open, list.data, qc]);

  // When the count goes up and the browser allows it, show the new reminders.
  useEffect(() => {
    const count = unread.data;
    if (count === undefined) return;
    const previous = lastCount.current;
    lastCount.current = count;
    if (previous === null || count <= previous || permission !== 'granted') return;
    apiGet<AppNotification[]>('/api/notifications')
      .then((all) => {
        for (const n of all.filter((x) => !x.read && !shown.current.has(x._id))) {
          shown.current.add(n._id);
          new Notification(n.title, { body: n.message, icon: '/icon.png', tag: n._id });
        }
      })
      .catch(() => {});
  }, [unread.data, permission]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  const remove = async (n: AppNotification) => {
    await apiSend('DELETE', `/api/notifications/${n._id}`).catch(() => {});
    refresh();
  };
  const askPermission = async () => {
    if (!browserNotificationsSupported()) return;
    if (Notification.permission === 'denied') {
      setPermissionNote('Notifications are blocked for this site. Allow them in your browser’s site settings, then reload.');
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    setPermissionNote(result === 'granted' ? 'Browser notifications are on.' : 'Browser notifications stay off.');
  };

  const count = unread.data ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
        className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface text-ink hover:bg-surface-2"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {count > 0 && (
          <span aria-hidden="true" className="absolute right-1.5 top-1.5 min-w-[18px] rounded-full bg-bad px-1 text-center font-mono text-[10px] font-semibold leading-[18px] text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="card fixed inset-x-4 top-[68px] z-40 shadow-card sm:absolute sm:inset-x-auto sm:right-0 sm:top-[52px] sm:w-[360px]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="font-semibold text-ink">Notifications</h2>
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {list.isPending && <p className="px-4 py-6 text-sm text-muted">Loading…</p>}
            {list.isError && <p className="px-4 py-6 text-sm text-bad-ink">Could not load notifications.</p>}
            {list.data?.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted">No notifications. Goal reminders show up here.</p>}
            <ul>
              {list.data?.map((n) => {
                const Icon = ICON[n.type] ?? Bell;
                const isNew = fresh.has(n._id) || !n.read;
                return (
                  <li key={n._id} className={`flex items-start gap-3 border-b border-line px-4 py-3 last:border-0 ${isNew ? 'bg-accent-soft' : ''}`}>
                    <Icon className={`mt-0.5 h-5 w-5 flex-none ${TONE[n.type] ?? 'text-muted'}`} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink">
                        {n.title}
                        {isNew && <span className="sr-only"> (new)</span>}
                      </span>
                      <span className="block text-sm text-muted">{n.message}</span>
                      <span className="mt-1 block font-mono text-[11px] text-faint">{timeAgo(n.createdAt)}</span>
                    </div>
                    <button type="button" onClick={() => remove(n)} aria-label={`Delete “${n.title}”`} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink">
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          {browserNotificationsSupported() && permission !== 'granted' && (
            <div className="border-t border-line px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Get reminders even when this tab is in the background.</span>
                <button type="button" onClick={askPermission} className="rounded-lg border border-line-strong px-3 py-1.5 font-semibold text-ink hover:bg-surface-2">
                  Turn on
                </button>
              </div>
              {permissionNote && <p role="status" className="mt-2 text-xs text-muted">{permissionNote}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
