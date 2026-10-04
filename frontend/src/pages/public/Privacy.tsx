import type { ReactNode } from 'react';
import { GITHUB_URL } from '../../components/layout/PublicLayout';

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line py-8 last:border-0">
      <h2 className="mb-4 text-2xl font-semibold">{title}</h2>
      <div className="flex flex-col gap-3 text-[16px] leading-relaxed text-muted [&_strong]:text-ink">{children}</div>
    </section>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

/** Plain-language account of what is collected, who sees it, and how long it is kept. */
export default function Privacy() {
  return (
    <div className="mx-auto max-w-[820px] px-4 py-12 sm:px-6">
      <header className="mb-4">
        <div className="eyebrow mb-3">Privacy</div>
        <h1 className="display text-balance text-[clamp(52px,6vw,88px)]">What we collect, plainly</h1>
        <p className="mt-4 text-lg text-muted">CodeTrackr is a student project. This page says exactly what it records and who can see it.</p>
      </header>

      <Block title="From VS Code">
        <p>After about two minutes of activity, the extension sends one small summary:</p>
        <List
          items={[
            'active coding time, the language, and the project (folder) name',
            'edit counts: characters and lines added and removed, saves, undo and redo counts, file switches, time spent reading versus writing',
            'how long the VS Code window had focus',
            'commit counts from the Git extension; debug sessions',
            'terminal commands counted by type (build, test, git, npm…) and whether they failed',
            'a command that keeps failing, shortened to 120 characters, with anything that looks like a password, token or key replaced by ***',
          ]}
        />
        <p>
          <strong>Never sent:</strong> your code or file contents, diffs, commit messages, full file paths, keystrokes, or anything from other apps.
        </p>
      </Block>

      <Block title="From Google">
        <p>Signing in with Google gives us your name, email address and profile picture. We do not get your password or access to anything else in your Google account.</p>
      </Block>

      <Block title="Who sees what">
        <List
          items={[
            'Your dashboard, goals and insights: only you.',
            'A group board: the group’s members see your name, hours, lines added, commits and how often your commands and builds failed, for that group.',
            'The global leaderboard: anyone signed in sees your name, profile picture and totals (hours, commits, lines changed).',
            'Email addresses are never shown to other people.',
          ]}
        />
      </Block>

      <Block title="Cookies and storage">
        <List
          items={[
            'One sign-in cookie (httpOnly, so page scripts cannot read it), valid for a day.',
            'A short-lived cookie during Google sign-in, to check the sign-in really started here.',
            'Your theme and daily target are kept in your browser’s local storage, not on the server.',
            'In VS Code, the extension keeps its key in your operating system’s keychain.',
          ]}
        />
      </Block>

      <Block title="Where it lives, and for how long">
        <p>
          The website is hosted on Vercel and the API on Render; data is stored in MongoDB Atlas. Activity records are deleted automatically after about 400 days. Server errors
          may be sent to an error-tracking service (Sentry) with the address that failed and a request id; we do not attach your name or email.
        </p>
        <p>The typefaces load from Google Fonts, so your browser asks Google for them.</p>
      </Block>

      <Block title="Deleting your data">
        <p>
          There is no delete button yet. To have your account and activity removed, open an issue on <a href={GITHUB_URL}>GitHub</a> and the maintainers will delete it. You can
          disconnect any computer yourself under Profile → Connected devices.
        </p>
      </Block>
    </div>
  );
}
