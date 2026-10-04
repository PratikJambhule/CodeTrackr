import { Suspense, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import type { Me } from '../../types';
import { ButtonLink, Logo } from '../ui';
import { ThemeToggle } from './ThemeToggle';

export const MARKETPLACE_URL = 'https://marketplace.visualstudio.com/items?itemName=CodeTrackr-ext.codetrackr-vscode';
export const GITHUB_URL = 'https://github.com/PratikJambhule/CodeTrackr';

const LINKS = [
  { href: '/#how', label: 'How it works' },
  { href: '/#groups', label: 'Groups' },
  { href: '/#fair', label: 'Fair play' },
  { href: '/guide', label: 'Guide' },
  { href: '/privacy', label: 'Privacy' },
];

/** Landing, guide and privacy pages: a top bar and a footer, no app chrome. */
export function PublicLayout({ user }: { user: Me | null | undefined }) {
  const [menu, setMenu] = useState(false);
  return (
    <div className="min-h-screen bg-bg text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line bg-bg-glass backdrop-blur">
        <div className="mx-auto flex max-w-[1200px] items-center gap-6 px-4 py-3 sm:px-6">
          <Link to="/" className="flex-none no-underline" aria-label="CodeTrackr home">
            <span className="sm:hidden">
              <Logo showName={false} />
            </span>
            <span className="hidden sm:block">
              <Logo />
            </span>
          </Link>
          <nav aria-label="Site" className="hidden flex-1 items-center gap-6 md:flex">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} className="text-[15px] font-medium text-muted no-underline hover:text-ink">
                {l.label}
              </a>
            ))}
          </nav>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 md:flex-none">
            {user ? (
              <ButtonLink to="/dashboard" variant="primary">
                Open dashboard
              </ButtonLink>
            ) : (
              <>
                <ButtonLink to="/login" variant="ghost" className="hidden sm:inline-flex">
                  Sign in
                </ButtonLink>
                <ButtonLink to={MARKETPLACE_URL} variant="primary" external>
                  Install for VS Code
                </ButtonLink>
              </>
            )}
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-line md:hidden"
              aria-expanded={menu}
              aria-controls="site-menu"
              aria-label={menu ? 'Close menu' : 'Open menu'}
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
            </button>
          </div>
        </div>
        {menu && (
          <nav id="site-menu" aria-label="Site" className="border-t border-line px-4 pb-4 md:hidden">
            {LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setMenu(false)} className="block min-h-[44px] py-3 font-medium text-ink no-underline">
                {l.label}
              </a>
            ))}
            {!user && (
              <Link to="/login" onClick={() => setMenu(false)} className="block min-h-[44px] py-3 font-semibold no-underline">
                Sign in with Google
              </Link>
            )}
          </nav>
        )}
      </header>

      <main id="main">
        <Suspense fallback={<div aria-busy="true" aria-label="Loading" className="skeleton h-[60vh]" />}>
          <Outlet />
        </Suspense>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-8 gap-y-4 px-4 py-8 text-sm text-muted sm:px-6">
          <span className="min-w-[260px] flex-1">CodeTrackr · built by Pratik Jambhule, Kartik Kharat and Soham Budhewar</span>
          <Link to="/guide" className="text-muted hover:text-ink">
            Guide
          </Link>
          <Link to="/privacy" className="text-muted hover:text-ink">
            Privacy
          </Link>
          <a href={GITHUB_URL} className="text-muted hover:text-ink">
            GitHub
          </a>
          <a href={MARKETPLACE_URL} className="text-muted hover:text-ink">
            Marketplace
          </a>
          <ThemeToggle />
        </div>
      </footer>
    </div>
  );
}
