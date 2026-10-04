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
 * Signed-in layout: a sidebar on desktop, a bottom tab bar on phones (spec
 * §5), and a top bar with notifications and the account menu.
 */
export function AppShell({ user }: { user: Me }) {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>
      <div className="flex">
        <aside className="sticky top-0 hidden h-screen w-[248px] flex-none flex-col gap-8 border-r border-line px-4 py-6 lg:flex">
          <NavLink to="/dashboard" className="px-2 no-underline" aria-label="CodeTrackr dashboard">
            <Logo />
          </NavLink>
          <nav aria-label="Main" className="flex flex-col gap-1">
            {NAV.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-[15px] no-underline transition ${
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
          <div className="mt-auto rounded-xl border border-line bg-surface p-4 text-sm">
            <p className="font-semibold text-ink">Tracking from VS Code</p>
            <p className="mt-1 text-muted">
              Run <span className="font-mono text-[12px] text-ink">CodeTrackr: Sign In</span> on each computer you code on.
            </p>
            <NavLink to="/profile" className="mt-2 inline-block font-semibold">
              Connected devices
            </NavLink>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg-glass px-4 py-3 backdrop-blur sm:px-6 lg:px-8">
            <NavLink to="/dashboard" className="no-underline lg:hidden" aria-label="CodeTrackr dashboard">
              <Logo size={28} showName={false} />
            </NavLink>
            <div className="flex-1" />
            <NotificationBell />
            <AccountMenu user={user} />
          </header>
          <main id="main" className="mx-auto w-full max-w-[1240px] px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-12">
            <Suspense fallback={<div aria-busy="true" aria-label="Loading" className="skeleton h-[60vh]" />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>

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
