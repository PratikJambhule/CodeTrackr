import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { errorText } from '../../api';
import { useTypeAnalytics } from '../../hooks/queries';
import { RankedBars, SplitBar } from '../../components/charts/Bars';
import { Card, CardTitle, ErrorBox, Pill, Skeleton } from '../../components/ui';
import { hm, int, pct, plural } from '../../lib/format';
import { SPLIT_PARTS } from '../../lib/timeSplit';
import { biggestGroup, SETUP_WARN_SHARE, WORK_GROUPS, type WorkGroupId } from '../../lib/workTypes';
import type { TypeAnalytics as Data, TypeTabBase } from '../../types';

/** A headline number with its label and an optional note under it. */
function Figure({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'warn' }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <div className={`display text-[28px] ${tone === 'warn' ? 'text-warn-ink' : 'text-ink'}`}>{value}</div>
      <div className="mt-0.5 text-xs text-ink">{label}</div>
      {note && <div className="mt-0.5 font-mono text-[11px] text-muted">{note}</div>}
    </div>
  );
}

const Figures = ({ children }: { children: ReactNode }) => <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
const Sub = ({ children }: { children: ReactNode }) => <h3 className="mb-3 mt-5 text-sm font-semibold">{children}</h3>;
const share = (part: number, whole: number) => (whole > 0 ? pct(part / whole) : '—');
const fileBars = (files: { name: string; seconds: number }[]) => files.map((f) => ({ label: f.name, value: f.seconds, display: hm(f.seconds) }));

/** What every tab starts with: how many sessions, how sure, and writing / reading / running. */
function Basis({ g }: { g: TypeTabBase }) {
  const split = SPLIT_PARTS.filter((p) => p.key !== 'otherSec');
  const older = g.sessions - g.detailSessions;
  return (
    <div className="mb-5">
      <p className="mb-3 text-sm text-muted">
        {hm(g.minutes * 60)} over {plural(g.sessions, 'session')}, {g.confirmed} confirmed by you; the rest are CodeTrackr's guess.
      </p>
      <SplitBar label="Time by kind" parts={split.map((p) => ({ label: p.label, value: g.split[p.key], color: p.color }))} />
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {split.map((p) => (
          <li key={p.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} aria-hidden="true" />
            {p.label} <span className="font-mono text-xs text-muted num">{hm(g.split[p.key])}</span>
          </li>
        ))}
      </ul>
      {older > 0 && (
        <p className="mt-2 text-xs text-muted">
          {plural(older, 'session')} came from an extension older than 2.6.0, so {older === 1 ? 'it has' : 'they have'} time only, no command or file detail.
        </p>
      )}
    </div>
  );
}

function DsaTab({ g }: { g: Data['groups']['dsa'] }) {
  return (
    <>
      <Figures>
        <Figure label="Problems worked on" value={int(g.problemCount)} note="files you spent time in" />
        <Figure label="Days you practised" value={int(g.activeDays)} />
        <Figure label="Compile and run per problem" value={!g.problemCount ? '—' : g.runsPerProblem >= 10 ? String(Math.round(g.runsPerProblem)) : g.runsPerProblem.toFixed(1)} note={`${int(g.compiles)} compiles, ${int(g.runs)} runs`} />
        <Figure label="Compiles that failed" value={share(g.failedCompiles, g.compiles)} note={g.compiles ? `${g.failedCompiles} of ${g.compiles}` : 'no compiles counted'} />
      </Figures>
      <Sub>Time per problem</Sub>
      <RankedBars items={fileBars(g.problems)} empty="Time per problem appears with extension 2.6.0." />
      {g.languages.length > 0 && (
        <>
          <Sub>Languages</Sub>
          <div className="flex flex-wrap gap-2">
            {g.languages.map((l) => <Pill key={l.name}>{l.name} · {plural(l.sessions, 'session')}</Pill>)}
          </div>
        </>
      )}
      <p className="mt-4 text-xs text-muted">"Worked on", not "solved": CodeTrackr cannot see whether a judge accepted your answer.</p>
    </>
  );
}

function ProjectTab({ g }: { g: Data['groups']['project_work'] }) {
  const d = g.debugging;
  return (
    <>
      <Figures>
        <Figure label="Commits" value={int(g.commits)} note={`${g.commitsPerHour} per hour`} />
        <Figure label="Lines written" value={int(g.linesWritten)} />
        <Figure label="Debugging" value={hm(d.minutes * 60)} note={`${plural(d.sessions, 'debug session')}, ${plural(d.breakpointStops, 'breakpoint stop')}`} />
        <Figure label="Builds that failed" value={share(g.failedBuilds, g.builds)} note={g.builds ? `${g.failedBuilds} of ${g.builds}` : 'no builds counted'} />
      </Figures>
      <Sub>Time per project</Sub>
      <RankedBars items={g.projects.map((p) => ({ label: p.name, value: p.minutes, display: hm(p.minutes * 60) }))} />
      <Sub>Files with the most time</Sub>
      <RankedBars items={fileBars(g.topFiles)} empty="File times appear with extension 2.6.0." />
      <p className="mt-4 text-sm text-muted">
        {plural(g.tests, 'test run')}{g.tests ? `, ${g.failedTests} failed` : ''} · {plural(g.runs, 'program run')} (terminal, tasks, Run Without Debugging)
        {d.steps > 0 && ` · ${int(d.steps)} debugger steps`}
      </p>
    </>
  );
}

function LearningTab({ g }: { g: Data['groups']['learning_setup'] }) {
  const heavySetup = g.setupShare >= SETUP_WARN_SHARE;
  return (
    <>
      <Figures>
        <Figure label="Learning" value={hm(g.learningMinutes * 60)} />
        <Figure label="Setup" value={hm(g.setupMinutes * 60)} />
        <Figure label="Setup share of all coding" value={pct(g.setupShare)} tone={heavySetup ? 'warn' : undefined} />
        <Figure label="Installs that failed" value={share(g.failedInstalls, g.installs)} note={g.installs ? `${g.failedInstalls} of ${g.installs}` : 'no installs counted'} />
      </Figures>
      {heavySetup && (
        <p className="mb-4 rounded-xl border border-warn px-3 py-2 text-sm" role="note">
          Setup took {pct(g.setupShare)} of your coding time. A starter template or a saved setup script could give some of it back.
        </p>
      )}
      <Sub>Reading</Sub>
      <p className="text-sm text-muted">
        {hm(g.docSec)} in docs and notes · {plural(g.navigations, 'jump')} to definitions or references · {plural(g.filesOpenedNotEdited, 'file')} opened and only read
      </p>
      {g.clonedRepos.length > 0 && (
        <>
          <Sub>Repos you explored</Sub>
          <div className="flex flex-wrap gap-2">{g.clonedRepos.map((r) => <Pill key={r}>{r}</Pill>)}</div>
        </>
      )}
      {g.configFiles.length > 0 && (
        <>
          <Sub>Config files you touched</Sub>
          <div className="flex flex-wrap gap-2">{g.configFiles.map((f) => <Pill key={f}>{f}</Pill>)}</div>
        </>
      )}
    </>
  );
}

const EMPTY: Record<WorkGroupId, string> = {
  dsa: 'No DSA practice in this window.',
  project_work: 'No project work in this window.',
  learning_setup: 'No learning or setup sessions in this window.',
};

/**
 * Analytics per kind of work (decision D-55): DSA, Project work and Learning & setup each answer their
 * own question. A session counts by your answer, else the VS Code picker, else CodeTrackr's guess.
 */
export function TypeAnalytics({ days }: { days: number }) {
  const window = Math.min(days, 60);
  const q = useTypeAnalytics(window);
  const [picked, setPicked] = useState<WorkGroupId | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  if (q.isPending) return <Skeleton className="mb-6 h-72" />;
  if (q.isError) return <div className="mb-6"><ErrorBox message={errorText(q.error)} onRetry={() => q.refetch()} /></div>;
  const data = q.data;
  if (data.totalMinutes === 0 && data.waiting === 0) return null;

  const active = picked ?? biggestGroup(data.groups);
  const g = data.groups[active];
  function onKey(e: KeyboardEvent, i: number) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + WORK_GROUPS.length) % WORK_GROUPS.length;
    setPicked(WORK_GROUPS[next].id);
    tabs.current[next]?.focus();
  }

  return (
    <Card className="mb-6 p-5">
      <CardTitle aside={`last ${window} days`}>By kind of work</CardTitle>
      <div role="tablist" aria-label="Kind of work" className="mb-5 inline-flex flex-wrap rounded-xl border border-line bg-surface p-1">
        {WORK_GROUPS.map((t, i) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => { tabs.current[i] = el; }}
              type="button"
              role="tab"
              id={`kind-tab-${t.id}`}
              aria-selected={on}
              aria-controls="kind-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => setPicked(t.id)}
              onKeyDown={(e) => onKey(e, i)}
              className={`min-h-[40px] rounded-lg px-4 text-sm font-semibold transition ${on ? 'bg-accent-soft text-ink' : 'text-muted hover:text-ink'}`}
            >
              {t.label} <span className="font-mono text-xs text-muted">{hm(data.groups[t.id].minutes * 60)}</span>
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id="kind-panel" aria-labelledby={`kind-tab-${active}`}>
        {g.sessions === 0 ? (
          <p className="text-sm text-muted">{EMPTY[active]} Sessions show up here when CodeTrackr guesses this kind or you say so below.</p>
        ) : (
          <>
            <Basis g={g} />
            {active === 'dsa' && <DsaTab g={data.groups.dsa} />}
            {active === 'project_work' && <ProjectTab g={data.groups.project_work} />}
            {active === 'learning_setup' && <LearningTab g={data.groups.learning_setup} />}
          </>
        )}
      </div>
      {data.waiting > 0 && (
        <p className="mt-4 text-xs text-muted">
          {plural(data.waiting, 'session')} {data.waiting === 1 ? 'waits' : 'wait'} for your answer below and {data.waiting === 1 ? 'is' : 'are'} not counted yet.
        </p>
      )}
    </Card>
  );
}
