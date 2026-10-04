import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, KeyRound, Lock, PlayCircle, ShieldCheck, Timer, X as XIcon } from 'lucide-react';
import { StandingsTower, type TowerRow } from '../../components/charts/StandingsTower';
import { CellLegend } from '../../components/charts/DayCells';
import { RaceChart } from '../../components/charts/RaceChart';
import { Button, ButtonLink } from '../../components/ui';
import { MARKETPLACE_URL } from '../../components/layout/PublicLayout';
import { gapLabel, hm } from '../../lib/format';
import { cellsSummary, dayCells, movement, orderOnDay, rank, type Racer } from '../../lib/standings';
import { SAMPLE_DAYS, SAMPLE_WEEK } from './sampleWeek';
import { DemoVideo } from './DemoVideo';

const H = 3600;

function useReducedMotion() {
  return useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);
}

/** The hero: the example week plays day by day and the rows slide (spec §2, the one orchestrated moment). */
function HeroTower() {
  const reduced = useReducedMotion();
  const [day, setDay] = useState(reduced ? 6 : 0);
  const timer = useRef<number | null>(null);

  const play = () => {
    if (timer.current) window.clearInterval(timer.current);
    setDay(0);
    timer.current = window.setInterval(() => setDay((d) => Math.min(6, d + 1)), 1300);
  };

  // Stop at Sunday.
  useEffect(() => {
    if (day >= 6 && timer.current) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, [day]);

  useEffect(() => {
    if (!reduced) play();
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const racers: Racer[] = SAMPLE_WEEK.map((p) => ({
    id: p.id,
    name: p.name,
    isMe: p.isMe,
    days: p.hours.map((h) => h * H),
    total: p.hours.slice(0, day + 1).reduce((a, b) => a + b, 0) * H,
  }));
  const cells = dayCells(racers, day + 1);
  const moves = day > 0 ? movement(orderOnDay(racers, day - 1), orderOnDay(racers, day)) : {};
  const rows: TowerRow[] = rank(racers).map(({ racer, gap }, i) => ({
    id: racer.id,
    name: racer.name,
    isMe: racer.isMe,
    value: i === 0 ? hm(racer.total) : gapLabel(gap),
    move: day > 0 ? moves[racer.id] : undefined,
    cells: cells[racer.id],
    summary: `${hm(racer.total)} so far. ${cellsSummary(cells[racer.id], SAMPLE_DAYS)}`,
  }));

  return (
    <div className="card p-4 shadow-card sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
        <div>
          <div className="display text-balance text-[28px]">DSA week</div>
          <div className="font-mono text-xs text-muted" aria-live="polite">
            Example group · day {day + 1} of 7 · {SAMPLE_DAYS[day]}
          </div>
        </div>
        <Button size="sm" onClick={play}>
          Replay the week
        </Button>
      </div>
      <StandingsTower rows={rows} dayHeader="Mon → Sun" label="Example standings" />
      <CellLegend className="mt-4 px-1" />
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="card flex flex-col gap-3 p-6">
      <span className="display text-balance text-[44px] text-accent" aria-hidden="true">
        {n}
      </span>
      <h3 className="text-xl font-semibold">{title}</h3>
      <div className="text-[16px] text-muted">{children}</div>
    </li>
  );
}

const FAQ = [
  { q: 'Is it free?', a: 'Yes. The extension and the website are free.' },
  { q: 'Can my friends see my code?', a: 'No. People in your group see hours, languages, commits and how often commands failed. Never files, code or commit messages.' },
  { q: 'What if I code offline?', a: 'Summaries wait in a queue on your computer and are sent when you are back online, even after restarting VS Code. Each one is counted once.' },
  { q: 'Which editors work?', a: 'Visual Studio Code on Windows, macOS and Linux.' },
  { q: 'How do I disconnect a computer?', a: 'Open Profile, find it under Connected devices, and click Disconnect. Its key stops working straight away.' },
  { q: 'Why did my first visit take a while?', a: 'The free server sleeps when nobody is using it and takes about 20 seconds to wake up. After that it is quick.' },
];

export default function Landing() {
  const raceSeries = SAMPLE_WEEK.map((p) => ({ id: p.id, name: p.name, isMe: p.isMe, values: p.hours.map((h) => h * H) }));
  const raceDates = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];

  return (
    <>
      <section className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-12 px-4 pb-20 pt-12 sm:px-6 lg:pt-16">
        <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-6">
          <span className="eyebrow">VS Code extension · free</span>
          <h1 className="display text-balance text-[clamp(56px,7.4vw,112px)]">Your coding hours, on the scoreboard</h1>
          <p className="max-w-[540px] text-xl text-muted">
            CodeTrackr times your coding in VS Code on its own. Make a group with your friends, pick a week, and see who actually put in the hours, and whose builds kept failing.
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink to={MARKETPLACE_URL} external variant="primary" size="lg">
              Install for VS Code
            </ButtonLink>
            <ButtonLink to="/login" size="lg">
              Sign in with Google
            </ButtonLink>
            <a href="#demo" className="inline-flex min-h-[52px] items-center gap-2 px-2 font-semibold no-underline">
              <PlayCircle className="h-5 w-5" aria-hidden="true" />
              Watch the 1-minute demo
            </a>
          </div>
          <p className="text-sm text-muted">Setup is one command in VS Code and one click on this site. No keys to copy.</p>
        </div>
        <div className="min-w-0 flex-[1_1_520px]">
          <HeroTower />
        </div>
      </section>

      <section id="demo" aria-labelledby="demo-title" className="mx-auto max-w-[1200px] scroll-mt-20 px-4 pb-20 sm:px-6">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="flex min-w-0 flex-col gap-3">
            <span className="eyebrow">See it in action · 1 min</span>
            <h2 id="demo-title" className="display text-balance text-[clamp(44px,5vw,72px)]">
              CodeTrackr in one minute
            </h2>
            <p className="max-w-[560px] text-lg text-muted">Install it, sign in from VS Code, and race your friends. Captions included, no sound needed.</p>
          </div>
          <Link to="/guide" className="inline-flex items-center gap-1.5 font-semibold no-underline">
            Prefer reading? The step-by-step guide
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        <DemoVideo />
        <p className="sr-only">
          The video shows installing CodeTrackr for VS Code, running CodeTrackr: Sign In, approving the code on this site, then the dashboard, a group board with the
          standings and race chart, creating a goal, and the leaderboard.
        </p>
      </section>

      <section id="how" className="scroll-mt-20 border-y border-line">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6">
          <h2 className="display text-balance mb-10 text-[clamp(44px,5vw,72px)]">Set up in two minutes</h2>
          <ol className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr))]">
            <Step n={1} title="Install the extension">
              Search “CodeTrackr” in the VS Code Extensions view, or{' '}
              <a href={MARKETPLACE_URL}>install it from the Marketplace</a>.
            </Step>
            <Step n={2} title="Sign in from VS Code">
              <p>
                Run <span className="font-mono text-[14px] text-ink">CodeTrackr: Sign In</span>. This site opens with your code filled in. Click Approve.
              </p>
              <span className="mt-3 inline-block rounded-xl border border-dashed border-line-strong bg-bg px-4 py-2 font-mono text-[22px] tracking-[0.12em] text-ink">
                WXYZ-2345
              </span>
            </Step>
            <Step n={3} title="Code as usual">
              After about two minutes of real activity, a small summary is sent and your dashboard fills in. Offline? It waits and sends later.
            </Step>
            <Step n={4} title="Bring your friends">
              Create a group, share its invite link, and set the dates of your contest week.
            </Step>
          </ol>
        </div>
      </section>

      <section id="groups" className="mx-auto flex max-w-[1200px] scroll-mt-20 flex-wrap items-center gap-12 px-4 py-20 sm:px-6">
        <div className="flex min-w-0 flex-[1_1_400px] flex-col gap-5">
          <h2 className="display text-balance text-[clamp(44px,5vw,72px)]">Race your friends, one week at a time</h2>
          <p className="text-lg text-muted">
            A group board ranks everyone by hours, and shows commits and how often each person’s commands failed. Pick a start and end date and the board counts only that stretch.
          </p>
          <ul className="flex flex-col gap-3 text-[16px]">
            {[
              'Contest weeks with your own start and end dates',
              'Private groups, joined with a password',
              'One invite link to share in your group chat',
              'The group creator can rename it and remove members',
            ].map((t) => (
              <li key={t} className="flex items-start gap-3">
                <Check className="mt-0.5 h-5 w-5 flex-none text-good-ink" aria-hidden="true" />
                {t}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2" aria-label="Ways groups use it">
            {['Placement prep week', 'Daily DSA practice', 'Hackathon team', 'Semester project sprint'].map((t) => (
              <span key={t} className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm">
                {t}
              </span>
            ))}
          </div>
        </div>
        <div className="card min-w-0 flex-[1_1_480px] p-5">
          <div className="mb-2 font-mono text-xs text-muted">Race chart · example group · running total of hours</div>
          <RaceChart series={raceSeries} dates={raceDates} title="Example race chart: running total of hours per person across the week" />
        </div>
      </section>

      <section className="border-y border-line">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6">
          <div className="mb-10 max-w-3xl">
            <h2 className="display text-balance text-[clamp(44px,5vw,72px)]">Know your own game</h2>
            <p className="mt-4 text-lg text-muted">
              Your dashboard shows where your time went and how steady you are: a year at a glance, languages and projects, when in the day you code, and which commands keep failing. Insights are plain statistics over your own history, each with a confidence level. Not AI, and every number can be explained.
            </p>
          </div>
          <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(250px,100%),1fr))]">
            {[
              { Icon: Timer, title: 'Hours that count', body: 'Active coding time per day, week and year, by language and project.' },
              { Icon: ShieldCheck, title: 'Failed builds, counted', body: 'See which command keeps failing. Anything that looks like a password or token is masked before sending.' },
              { Icon: KeyRound, title: 'Goals with deadlines', body: 'Set a target in hours for a language or project, get a reminder before the deadline.' },
              { Icon: Lock, title: 'Private by default', body: 'Insights are yours alone. Groups see totals, never detail.' },
            ].map(({ Icon, title, body }) => (
              <div key={title} className="card flex flex-col gap-3 p-6">
                <Icon className="h-6 w-6 text-accent" aria-hidden="true" />
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="text-[15px] text-muted">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="fair" className="mx-auto flex max-w-[1200px] scroll-mt-20 flex-wrap gap-12 px-4 py-20 sm:px-6">
        <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-4">
          <h2 className="display text-balance text-[clamp(44px,5vw,72px)]">Hours you can’t fake by leaving VS Code open</h2>
          <p className="text-lg text-muted">A leaderboard is only fun if it is fair. The server checks every upload before it counts.</p>
        </div>
        <ul className="grid min-w-0 flex-[1_1_520px] gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))]">
          {[
            { k: 'focus + 2 min', v: 'Time counts only while the VS Code window has focus, plus two minutes of grace.' },
            { k: '≤ 10 min / 10 min', v: 'Nobody can earn more than ten minutes of credit in any ten-minute window.' },
            { k: 'counted once', v: 'Every upload carries an id, so a retry after a network error is never counted twice.' },
            { k: 'your own key', v: 'Each computer gets its own key. Disconnect a lost laptop without touching the others.' },
          ].map((f) => (
            <li key={f.k} className="card flex flex-col gap-2 p-5">
              <span className="font-mono text-[20px] text-accent-ink">{f.k}</span>
              <span className="text-[15px] text-muted">{f.v}</span>
            </li>
          ))}
        </ul>
      </section>

      <section id="privacy" className="scroll-mt-20 border-y border-line">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6">
          <h2 className="display text-balance mb-8 text-[clamp(44px,5vw,72px)]">What is sent, and what never is</h2>
          <div className="grid gap-5 [grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))]">
            <div className="card p-6">
              <h3 className="mb-3 text-lg font-semibold text-good-ink">Sent, as a small summary</h3>
              <ul className="flex flex-col gap-2.5 text-[15px] text-muted">
                {[
                  'Active coding time, the language, and the project (folder) name',
                  'Edit counts: lines added and removed, saves, reading vs writing time',
                  'Window-focus time, commit counts, debug sessions',
                  'Terminal commands by type (build, test, git) and whether they failed',
                  'A command that fails repeatedly, with passwords, tokens and keys replaced by ***',
                ].map((t) => (
                  <li key={t} className="flex gap-2.5">
                    <Check className="mt-0.5 h-4 w-4 flex-none text-good-ink" aria-hidden="true" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="card p-6">
              <h3 className="mb-3 text-lg font-semibold text-bad-ink">Never sent</h3>
              <ul className="flex flex-col gap-2.5 text-[15px] text-muted">
                {['Your code or file contents', 'Diffs and commit messages', 'Full file paths', 'Keystrokes', 'Anything from other apps on your computer'].map((t) => (
                  <li key={t} className="flex gap-2.5">
                    <XIcon className="mt-0.5 h-4 w-4 flex-none text-bad-ink" aria-hidden="true" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <ButtonLink to="/privacy" variant="ghost" className="mt-6 -ml-4" icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}>
            Read the privacy page
          </ButtonLink>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-[900px] scroll-mt-20 px-4 py-20 sm:px-6">
        <h2 className="display text-balance mb-8 text-[clamp(44px,5vw,72px)]">Questions</h2>
        <div className="flex flex-col">
          {FAQ.map((f) => (
            <details key={f.q} className="group border-b border-line py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold [&::-webkit-details-marker]:hidden">
                {f.q}
                <span aria-hidden="true" className="font-mono text-xl text-muted transition group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 text-[16px] text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pb-24 sm:px-6">
        <div className="card flex flex-col items-center gap-5 px-6 py-14 text-center">
          <h2 className="display text-balance text-[clamp(48px,6vw,88px)]">Start this week’s race</h2>
          <p className="max-w-[560px] text-lg text-muted">Install the extension, sign in once, and send your friends the group link.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <ButtonLink to={MARKETPLACE_URL} external variant="primary" size="lg">
              Install for VS Code
            </ButtonLink>
            <ButtonLink to="/login" size="lg">
              Sign in with Google
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
