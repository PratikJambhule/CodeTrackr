import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Circle } from 'lucide-react';
import type { ReactNode } from 'react';
import { apiGet, apiSend } from '../api';
import { useMyGroups } from '../hooks/queries';
import { MARKETPLACE_URL } from '../components/layout/PublicLayout';
import { Button, ButtonLink, Card, PageHeader } from '../components/ui';
import { tzOffset } from '../lib/format';
import type { DeviceToken, Me, PeriodView } from '../types';

function Step({ done, n, title, children, active }: { done: boolean; n: number; title: string; children: ReactNode; active: boolean }) {
  return (
    <li className={`card flex gap-4 p-5 ${active ? 'border-accent' : ''}`}>
      <span
        aria-hidden="true"
        className={`flex h-9 w-9 flex-none items-center justify-center rounded-full ${done ? 'bg-good text-white' : active ? 'bg-accent-soft text-accent-ink' : 'bg-surface-2 text-muted'}`}
      >
        {done ? <Check className="h-5 w-5" /> : <span className="font-mono text-sm">{n}</span>}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          {title}
          <span className="sr-only">{done ? '(done)' : '(to do)'}</span>
        </h2>
        {!done && <div className="mt-2 text-[15px] text-muted">{children}</div>}
      </div>
      {!done && !active && <Circle className="h-5 w-5 flex-none text-faint" aria-hidden="true" />}
    </li>
  );
}

/**
 * A checklist that ticks itself as each step is finished: it watches for a
 * connected device, the first upload, and a group (spec §5).
 */
export default function Onboarding({ user }: { user: Me }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => apiGet<DeviceToken[]>('/api/device/tokens'), refetchInterval: (q) => (q.state.data?.length ? false : 5000) });
  const week = useQuery({
    queryKey: ['analytics', 'week', user.id, tzOffset()],
    queryFn: () => apiGet<PeriodView>(`/api/analytics/weekly/${user.id}?timezone=${tzOffset()}`),
    refetchInterval: (q) => ((q.state.data?.totalHours ?? 0) > 0 ? false : 10000),
  });
  const groups = useMyGroups();

  const coded = (week.data?.totalHours ?? 0) > 0;
  const connected = (devices.data?.length ?? 0) > 0 || coded;
  const installed = connected;
  const grouped = (groups.data?.length ?? 0) > 0;
  const doneCount = [installed, connected, coded, grouped].filter(Boolean).length;
  const active = !installed ? 1 : !connected ? 2 : !coded ? 3 : !grouped ? 4 : 0;

  const finish = async () => {
    await apiSend('POST', '/api/user/complete-onboarding').catch(() => {});
    await qc.invalidateQueries({ queryKey: ['me'] });
    navigate('/dashboard');
  };

  return (
    <div className="mx-auto max-w-[760px]">
      <PageHeader eyebrow={`${doneCount} of 4 done`} title={`Welcome, ${user.name.split(' ')[0]}`}>
        Four steps and you are on the scoreboard. This page ticks them off as they happen.
      </PageHeader>
      <ol className="flex flex-col gap-3" aria-live="polite">
        <Step n={1} done={installed} active={active === 1} title="Install the extension">
          <p>
            In VS Code, open Extensions (<span className="font-mono text-ink">Ctrl+Shift+X</span>), search <strong className="text-ink">CodeTrackr</strong> and click Install.
          </p>
          <ButtonLink to={MARKETPLACE_URL} external className="mt-3">
            Open the Marketplace page
          </ButtonLink>
        </Step>
        <Step n={2} done={connected} active={active === 2} title="Sign in from VS Code">
          <p>
            Press <span className="font-mono text-ink">Ctrl+Shift+P</span>, run <strong className="text-ink">CodeTrackr: Sign In</strong>, and approve the code on the page that
            opens. This step ticks itself within a few seconds.
          </p>
        </Step>
        <Step n={3} done={coded} active={active === 3} title="Code for two minutes">
          <p>Write some code as usual. After about two minutes of activity your first summary arrives and this step ticks.</p>
        </Step>
        <Step n={4} done={grouped} active={active === 4} title="Join or create a group">
          <p>The fun part: a weekly race with your friends. Create a group and send them the invite link, or join theirs.</p>
          <ButtonLink to="/groups" variant="primary" className="mt-3">
            Go to Groups
          </ButtonLink>
        </Step>
      </ol>
      <Card className="mt-6 flex flex-wrap items-center justify-between gap-4 p-5">
        <p className="text-sm text-muted">
          Cannot use Sign In? <Link to="/profile">Connect with an API key</Link> instead.
        </p>
        <Button variant={doneCount === 4 ? 'primary' : 'secondary'} onClick={finish}>
          {doneCount === 4 ? 'Go to the dashboard' : 'Skip for now'}
        </Button>
      </Card>
    </div>
  );
}
