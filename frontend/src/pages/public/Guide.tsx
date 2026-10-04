import type { ReactNode } from 'react';
import { CellLegend } from '../../components/charts/DayCells';
import { MARKETPLACE_URL } from '../../components/layout/PublicLayout';

const SECTIONS = [
  { id: 'install', title: 'Install the extension' },
  { id: 'sign-in', title: 'Connect VS Code' },
  { id: 'recorded', title: 'What gets recorded, and when' },
  { id: 'dashboard', title: 'Your dashboard' },
  { id: 'groups', title: 'Groups and contest weeks' },
  { id: 'goals', title: 'Goals' },
  { id: 'insights', title: 'Insights' },
  { id: 'fair', title: 'How time is counted' },
  { id: 'trouble', title: 'Troubleshooting' },
  { id: 'commands', title: 'Commands' },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-b border-line py-10 last:border-0">
      <h2 className="display text-balance mb-5 text-[40px]">{title}</h2>
      <div className="flex max-w-[68ch] flex-col gap-4 text-[16px] leading-relaxed text-muted [&_strong]:text-ink">{children}</div>
    </section>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return <span className="rounded-md border border-line-strong bg-surface px-1.5 py-0.5 font-mono text-[13px] text-ink">{children}</span>;
}

const COMMANDS = [
  ['CodeTrackr: Sign In', 'Connect this VS Code to your account with a short code (recommended).'],
  ['CodeTrackr: Show Connection Info', 'Whether you are connected, and to which server.'],
  ['CodeTrackr: Show Statistics', 'What has been recorded in this session.'],
  ['CodeTrackr: Show Event Logs', 'The extension’s log output.'],
  ['CodeTrackr: Flush Now', 'Send the current summary immediately.'],
  ['CodeTrackr: Start / Stop Tracking', 'Pause and resume tracking.'],
  ['CodeTrackr: Setup API Key', 'Older way to connect: paste a key from your Profile page.'],
];

export default function Guide() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6">
      <header className="mb-6 max-w-3xl">
        <div className="eyebrow mb-3">Guide</div>
        <h1 className="display text-balance text-[clamp(52px,6vw,88px)]">Everything, step by step</h1>
        <p className="mt-4 text-lg text-muted">From installing the extension to running a contest week with your friends. Five minutes to read.</p>
      </header>
      <div className="flex flex-wrap gap-12">
        <nav aria-label="On this page" className="w-full flex-none lg:sticky lg:top-24 lg:w-56 lg:self-start">
          <ol className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
            {SECTIONS.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="block rounded-lg px-3 py-1.5 text-sm text-muted no-underline hover:bg-surface-2 hover:text-ink">
                  <span className="mr-2 font-mono text-[11px] text-faint">{String(i + 1).padStart(2, '0')}</span>
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="min-w-0 flex-1">
          <Section id="install" title="Install the extension">
            <p>
              In VS Code, open the Extensions view (<Kbd>Ctrl+Shift+X</Kbd>, or <Kbd>Cmd+Shift+X</Kbd> on a Mac), search for <strong>CodeTrackr</strong> and click
              Install. Or open <a href={MARKETPLACE_URL}>CodeTrackr on the Visual Studio Marketplace</a>.
            </p>
          </Section>

          <Section id="sign-in" title="Connect VS Code">
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                Open the Command Palette (<Kbd>Ctrl+Shift+P</Kbd>) and run <strong>CodeTrackr: Sign In</strong>.
              </li>
              <li>VS Code copies a short code such as <span className="font-mono text-ink">WXYZ-2345</span> and opens this website.</li>
              <li>Sign in with Google if asked, check that the code matches the one VS Code shows, and click <strong>Approve this device</strong>.</li>
            </ol>
            <p>
              That is the whole setup. Each computer gets its own key, kept in your operating system’s keychain. Keys expire after a year; run Sign In again when one does.
              You can see and disconnect computers under <strong>Profile → Connected devices</strong>.
            </p>
            <p>Only approve a code that your own VS Code is showing right now. Someone who sends you a code is asking for access to upload as you.</p>
          </Section>

          <Section id="recorded" title="What gets recorded, and when">
            <p>
              The extension watches for real activity: typing, saving, switching files, running commands. After about <strong>two minutes</strong> of it, a small summary is sent:
              time, language, project name, edit counts, commits, and how many commands and builds failed. The full list is on the <a href="/privacy">privacy page</a>.
            </p>
            <p>
              Offline, or the server is waking up? Summaries wait in a queue on your computer, survive restarting VS Code, and are sent oldest first. Each carries an id,
              so a retry is never counted twice.
            </p>
          </Section>

          <Section id="dashboard" title="Your dashboard">
            <p>
              <strong>Today</strong> shows your day hour by hour; click an hour to see what you did in that two-hour window. <strong>This week</strong> shows the last seven days
              against your daily target, which you can change on the chart.
            </p>
            <p>
              Below that: your <strong>year</strong> at a glance (darker purple means more time), your <strong>languages and projects</strong>, <strong>when you code</strong>,
              and <strong>build health</strong>: how many commands failed and which one fails most.
            </p>
          </Section>

          <Section id="groups" title="Groups and contest weeks">
            <p>
              Create a group from the Groups page. Public groups can be joined by anyone signed in; private ones need the password you set. Use <strong>Copy invite link</strong> to
              send it to your friends.
            </p>
            <p>
              Each group has a board: everyone ranked by hours, with commits and failure rates beside them. Choose <strong>This week</strong>, <strong>Last 7 days</strong>,
              <strong> All time</strong>, or set your own contest dates.
            </p>
            <p>The small cells next to each name are the days of the period, coloured like a race timing screen:</p>
            <CellLegend />
            <p>The race chart under the board shows each person’s running total, so you can see who made a late push.</p>
            <p>The person who created a group can rename it and remove members. If they leave, the longest-standing member takes over.</p>
          </Section>

          <Section id="goals" title="Goals">
            <p>
              A goal is a number of hours for a <strong>language or project</strong> by a date: “20 hours of python by 15 October”. Hours count when the language or project name
              matches, from when you create the goal until its deadline. You get a reminder before the deadline. Marking a goal complete teaches Insights how well you estimate.
            </p>
          </Section>

          <Section id="insights" title="Insights">
            <p>
              Insights are plain statistics over your own history: deep-work share, your longest focus blocks, how steady your week is, your best hours. Each has a confidence level,
              and anything without enough data shows a dash instead of a misleading number. They are private to you. They are not AI.
            </p>
          </Section>

          <Section id="fair" title="How time is counted">
            <p>
              A leaderboard is only fun if it is fair, so the server checks every summary. Time counts only while the VS Code window has focus, plus two minutes of grace. Nobody can
              earn more than ten minutes of credit in any ten-minute window. A long upload after being offline is spread over the time it covers, so honest work is never cut.
            </p>
          </Section>

          <Section id="trouble" title="Troubleshooting">
            <dl className="flex flex-col gap-4">
              {[
                ['Nothing shows on the dashboard', 'Run CodeTrackr: Show Connection Info in VS Code. If it says you are not connected, run CodeTrackr: Sign In. Summaries are sent after about two minutes of activity; Flush Now sends one immediately.'],
                ['The first visit of the day is slow', 'The free server sleeps when idle and takes about 20 seconds to wake. Nothing is lost: the extension’s queue waits and retries.'],
                ['The extension says the key was rejected', 'Device keys expire after a year, or the computer was disconnected on the Profile page. Run CodeTrackr: Sign In again.'],
                ['Signing in loops back to the sign-in page', 'Your browser is blocking this site’s cookie. Allow cookies for this site, or try another browser.'],
              ].map(([q, a]) => (
                <div key={q}>
                  <dt className="font-semibold text-ink">{q}</dt>
                  <dd className="mt-1">{a}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section id="commands" title="Commands">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-[15px]">
                <thead>
                  <tr className="border-b border-line text-sm text-ink">
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      Command
                    </th>
                    <th scope="col" className="py-2 font-semibold">
                      What it does
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMMANDS.map(([c, d]) => (
                    <tr key={c} className="border-b border-line">
                      <td className="py-2.5 pr-4 font-mono text-[13px] text-ink">{c}</td>
                      <td className="py-2.5">{d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
