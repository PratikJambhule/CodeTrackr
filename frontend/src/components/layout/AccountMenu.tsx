import { Link } from 'react-router-dom';
import { BookOpen, LogOut, UserRound } from 'lucide-react';
import type { Me } from '../../types';
import { Avatar } from '../ui';
import { ThemeToggle } from './ThemeToggle';
import { usePopover } from './usePopover';
import { signOut } from './signOut';

export function AccountMenu({ user }: { user: Me }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={`Account menu for ${user.name}`}
        className="flex h-11 items-center gap-2 rounded-xl border border-line bg-surface pl-1.5 pr-2 hover:bg-surface-2 sm:pr-3"
      >
        <Avatar name={user.name} src={user.profilePictureUrl} size={32} />
        <span className="hidden max-w-[140px] truncate text-sm font-semibold text-ink sm:block">{user.name}</span>
      </button>
      {open && (
        <div className="card absolute right-0 top-[52px] z-40 w-[280px] p-2 shadow-card">
          <div className="px-3 py-2">
            <div className="truncate font-semibold text-ink">{user.name}</div>
            <div className="truncate text-sm text-muted">{user.email}</div>
          </div>
          <div className="my-1 border-t border-line" />
          <Link to="/profile" onClick={() => setOpen(false)} className="flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium text-ink hover:bg-surface-2">
            <UserRound className="h-4 w-4 text-muted" aria-hidden="true" />
            Profile and devices
          </Link>
          <Link to="/guide" onClick={() => setOpen(false)} className="flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium text-ink hover:bg-surface-2">
            <BookOpen className="h-4 w-4 text-muted" aria-hidden="true" />
            Guide
          </Link>
          <div className="px-3 py-2">
            <div className="mb-2 text-xs text-muted">Theme</div>
            <ThemeToggle withLabels />
          </div>
          <div className="my-1 border-t border-line" />
          <button type="button" onClick={signOut} className="flex min-h-[44px] w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-ink hover:bg-surface-2">
            <LogOut className="h-4 w-4 text-muted" aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
