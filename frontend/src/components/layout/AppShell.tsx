import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Sparkles, Target, Trophy, Users } from 'lucide-react';
import type { Me } from '../../types';
import { Logo } from '../ui';
import { AccountMenu } from './AccountMenu';
import { NotificationBell } from './NotificationBell';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { to: '/groups', label: 'Groups', Icon: Users },
  { to: '/leaderboard', label: 'Leaderboard', Icon: Trophy },
  { to: '/goals', label: 'Goals', Icon: Target },
  { to: '/insights', label: 'Insights', Icon: Sparkles },
];

/**
 * Signed-in layout: one top bar with the logo, the sections in a row,
 * notifications and the account menu (the left sidebar was dropped on
 * 2026-10-04 at the user's request, so pages get the full width). Phones keep
 * a bottom tab bar, where five sections fit under a thumb.
 */
export function AppShell({ user }: { user: Me }) {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-bg-glass backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1240px] items-center gap-3 px-4 sm:px-6 lg:gap-8 lg:px-8">
          <NavLink to="/dashboard" className="flex-none no-underline" aria-label="CodeTrackr dashboard">
            <span className="lg:hidden">
              <Logo size={28} showName={false} />
            </span>
            <span className="hidden lg:block">
              <Logo size={30} />
            </span>
          </NavLink>
          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {NAV.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex h-10 items-center gap-2 rounded-xl px-3 text-[15px] no-underline transition ${
                    isActive ? 'bg-accent-soft font-semibold text-ink' : 'font-medium text-muted hover:bg-surface-2 hover:text-ink'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={`h-[18px] w-[18px] ${isActive ? 'text-accent' : ''}`} aria-hidden="true" />
                    {label}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="flex-1" />
          <NotificationBell />
          <AccountMenu user={user} />
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-[1240px] px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-12">
        <Suspense fallback={<div aria-busy="true" aria-label="Loading" className="skeleton h-[60vh]" />}>
          <Outlet />
        </Suspense>
      </main>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface-glass pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold no-underline ${isActive ? 'text-accent-ink' : 'text-muted'}`
            }
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
