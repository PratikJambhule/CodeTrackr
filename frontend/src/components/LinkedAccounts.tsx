import { useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Code2, GitBranch, Trophy } from 'lucide-react';
import { apiSend, errorText } from '../api';
import { useLinks } from '../hooks/queries';
import { difficultyMix, ratingLine } from '../lib/linked';
import { int, plural, timeAgo } from '../lib/format';
import type { CodeforcesLink, GithubLink, LeetCodeLink, LinkedBase, Links } from '../types';
import { Button, Modal, Pill, Skeleton, TextField, useToast } from './ui';

type Provider = 'leetcode' | 'codeforces' | 'github';
const NAMES: Record<Provider, string> = { leetcode: 'LeetCode', codeforces: 'Codeforces', github: 'GitHub' };
const FIELD: Record<Provider, { label: string; placeholder: string }> = {
  leetcode: { label: 'LeetCode username', placeholder: 'e.g. asha_01' },
  codeforces: { label: 'Codeforces handle', placeholder: 'e.g. asha_cf' },
  github: { label: 'GitHub username', placeholder: 'e.g. asha-dev' },
};
const WHERE: Record<Provider, ReactNode> = {
  codeforces: <>your Codeforces <strong>first name</strong>, last name or organization (Settings → Social)</>,
  leetcode: <>your LeetCode profile's <strong>About</strong> text (Edit profile → README / About me)</>,
  github: <>your GitHub <strong>bio</strong> (github.com/settings/profile)</>,
};
const DIFF_COLOR = { easy: 'var(--good)', medium: 'var(--warn)', hard: 'var(--bad)' };

/** Link form, or the linked account with "Change" and "Unlink". */
function Account({ provider, linked, icon, children }: { provider: Provider; linked: LinkedBase | null; icon: ReactNode; children?: ReactNode }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirm, setConfirm] = useState(false);
  const [checking, setChecking] = useState(false);
  const [verifyError, setVerifyError] = useState<string | undefined>();

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const res = await apiSend<{ links: Links }>('PUT', `/api/user/links/${provider}`, { username: name.trim() });
      qc.setQueryData(['links'], res.links);
      await qc.invalidateQueries({ queryKey: ['practice'] });
      setEditing(false);
      setName('');
      toast(`Linked ${NAMES[provider]}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const unlink = async () => {
    try {
      const res = await apiSend<{ links: Links }>('DELETE', `/api/user/links/${provider}`);
      qc.setQueryData(['links'], res.links);
      await qc.invalidateQueries({ queryKey: ['practice'] });
      toast(`Unlinked ${NAMES[provider]}; its data was deleted`);
    } catch (err) {
      toast(errorText(err), 'error');
    }
    setConfirm(false);
  };

  const getCode = async () => {
    setVerifyError(undefined);
    try {
      const res = await apiSend<{ code: string }>('POST', `/api/user/links/${provider}/verify-code`);
      qc.setQueryData<Links>(['links'], (old) => (old && old[provider] ? { ...old, [provider]: { ...old[provider]!, verifyCode: res.code } } : old));
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };
  const check = async () => {
    setChecking(true);
    setVerifyError(undefined);
    try {
      const res = await apiSend<{ links: Links }>('POST', `/api/user/links/${provider}/verify`);
      qc.setQueryData(['links'], res.links);
      await qc.invalidateQueries({ queryKey: ['groups', 'practice'] });
      await qc.invalidateQueries({ queryKey: ['leaderboard', 'practice'] });
      toast(`${NAMES[provider]} verified. You now appear on your groups' boards.`);
    } catch (err) {
      setVerifyError(errorText(err));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted" aria-hidden="true">{icon}</span>
        <h3 className="text-lg font-semibold">{NAMES[provider]}</h3>
        {linked && <span className="font-mono text-sm text-accent-ink">@{linked.username}</span>}
        {linked && (linked.verified ? <Pill tone="good">verified · on boards</Pill> : <Pill>private</Pill>)}
        {linked && (
          <span className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>Change</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>Unlink</Button>
          </span>
        )}
      </div>

      {(!linked || editing) && (
        <form onSubmit={save} className="flex flex-wrap items-end gap-3">
          <TextField
            label={FIELD[provider].label}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={FIELD[provider].placeholder}
            autoComplete="off"
            error={error}
            className="min-w-[220px]"
            required
          />
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>{busy ? 'Linking…' : linked ? 'Save' : 'Link'}</Button>
        </form>
      )}

      {linked && !editing && !linked.verified && (
        <div className="rounded-xl border border-dashed border-line-strong p-4 text-sm">
          {linked.verifyCode ? (
            <div className="flex flex-col gap-3">
              <p>
                Put <code className="rounded bg-bg px-1.5 py-0.5 font-mono text-ink">{linked.verifyCode}</code> in {WHERE[provider]}, save it there, then press Check. You can remove it
                after.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="primary" disabled={checking} onClick={check}>{checking ? 'Checking…' : 'Check'}</Button>
                <Button size="sm" variant="ghost" onClick={getCode}>New code</Button>
              </div>
              {verifyError && <p role="alert" className="text-bad-ink">{verifyError}</p>}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted">
                Only you see these numbers. Verify that this is your account to appear on your groups' boards.
              </p>
              <Button size="sm" onClick={getCode}>Verify</Button>
            </div>
          )}
        </div>
      )}
      {linked && !editing && children}
      {linked && (
        <p className="font-mono text-[12px] text-muted">
          {linked.lastSyncAt ? `updated ${timeAgo(linked.lastSyncAt)}` : 'not updated yet'} · refreshed every hour
          {linked.lastError && <span className="text-bad-ink"> · last update failed: {linked.lastError}</span>}
        </p>
      )}

      <Modal open={confirm} onClose={() => setConfirm(false)} title={`Unlink ${NAMES[provider]}?`} description="Everything CodeTrackr pulled from it is deleted. You can link it again later.">
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
          <Button variant="danger" onClick={unlink}>Unlink</Button>
        </div>
      </Modal>
    </div>
  );
}

function LeetCodeStats({ lc }: { lc: LeetCodeLink }) {
  const s = lc.summary;
  const mix = difficultyMix(s.solved);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="display text-4xl">{int(s.solved?.all ?? 0)}</span>
        <span className="text-sm text-muted">problems solved</span>
        {s.rating != null && <span className="text-sm">contest rating <strong>{s.rating}</strong></span>}
        <span className="text-sm text-muted">{plural(s.activeDays30 ?? 0, 'active day')} in the last 30</span>
      </div>
      <div>
        <div className="flex h-3 overflow-hidden rounded-full bg-line" role="img" aria-label={mix.map((m) => `${m.label} ${m.count}`).join(', ')}>
          {mix.map((m) => <span key={m.key} style={{ width: `${m.share * 100}%`, background: DIFF_COLOR[m.key] }} />)}
        </div>
        <div className="mt-2 flex gap-5 font-mono text-[12px] text-muted">
          {mix.map((m) => <span key={m.key}><span style={{ color: DIFF_COLOR[m.key] }}>●</span> {m.label} {m.count}</span>)}
        </div>
      </div>
      {!!s.topics?.length && (
        <div>
          <div className="mb-2 text-sm font-medium">Top topics</div>
          <div className="flex flex-wrap gap-2">
            {s.topics.slice(0, 10).map((t) => <Pill key={t.name}>{t.name} · {t.solved}</Pill>)}
          </div>
        </div>
      )}
      {!!lc.recentSolves.length && (
        <div>
          <div className="mb-2 text-sm font-medium">Recently solved</div>
          <ul className="flex flex-col gap-1.5 text-sm">
            {lc.recentSolves.slice(0, 5).map((p) => (
              <li key={p.titleSlug} className="flex flex-wrap items-baseline gap-x-3">
                <a href={`https://leetcode.com/problems/${p.titleSlug}/`} target="_blank" rel="noreferrer">{p.title}</a>
                {p.difficulty && <span className="font-mono text-[12px]" style={{ color: DIFF_COLOR[p.difficulty.toLowerCase() as 'easy'] }}>{p.difficulty}</span>}
                <span className="font-mono text-[12px] text-muted">{timeAgo(p.solvedAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CodeforcesStats({ cf }: { cf: CodeforcesLink }) {
  const s = cf.summary;
  const line = ratingLine(s.ratingHistory ?? [], 300, 48);
  const most = Math.max(1, ...(s.byDifficulty ?? []).map((b) => b.count));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="display text-4xl">{s.rating ?? '—'}</span>
        <span className="text-sm text-muted">{s.rating == null ? 'not rated yet' : `rating${s.rank ? ` · ${s.rank}` : ''}`}</span>
        {s.maxRating != null && <span className="text-sm">best <strong>{s.maxRating}</strong></span>}
        <span className="text-sm text-muted">{plural(s.contests ?? 0, 'contest')} · {int(s.solvedAll ?? 0)} solved · {plural(s.activeDays30 ?? 0, 'active day')} in the last 30</span>
      </div>
      {line && (
        <svg viewBox="0 0 300 48" preserveAspectRatio="none" className="h-12 w-full" role="img" aria-label={`Rating over the last ${s.ratingHistory?.length ?? 0} contests`}>
          <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {!!s.byDifficulty?.length && (
        <div>
          <div className="mb-2 text-sm font-medium">Solved by problem difficulty</div>
          <ul className="flex flex-col gap-1.5 text-sm">
            {s.byDifficulty.map((b) => (
              <li key={b.label} className="flex items-center gap-3">
                <span className="w-24 font-mono text-[12px] text-muted">{b.label}</span>
                <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full" style={{ width: `${(b.count / most) * 100}%`, background: 'var(--accent)' }} /></span>
                <span className="w-10 text-right font-mono text-[12px]">{b.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!s.topics?.length && (
        <div>
          <div className="mb-2 text-sm font-medium">Top topics</div>
          <div className="flex flex-wrap gap-2">
            {s.topics.map((t) => <Pill key={t.name}>{t.name} · {t.solved}</Pill>)}
          </div>
        </div>
      )}
      {!!s.recentSolves?.length && (
        <div>
          <div className="mb-2 text-sm font-medium">Recently solved</div>
          <ul className="flex flex-col gap-1.5 text-sm">
            {s.recentSolves.map((p) => (
              <li key={`${p.contestId}${p.index}`} className="flex flex-wrap items-baseline gap-x-3">
                <a href={`https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`} target="_blank" rel="noreferrer">{p.title}</a>
                {p.rating && <span className="font-mono text-[12px] text-muted">{p.rating}</span>}
                <span className="font-mono text-[12px] text-muted">{timeAgo(p.solvedAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function GithubStats({ gh }: { gh: GithubLink }) {
  const s = gh.summary;
  const weeks = s.weekly ?? [];
  const most = Math.max(1, ...weeks.map((w) => w.pushes));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="display text-4xl">{int(s.pushes30d ?? 0)}</span>
        <span className="text-sm text-muted">public pushes in 30 days</span>
        <span className="text-sm"><strong>{s.pushes7d ?? 0}</strong> this week</span>
        <span className="text-sm text-muted">{plural(s.activeDays30 ?? 0, 'active day')} · {plural(s.mergedPrs30d ?? 0, 'pull request')} merged · {plural(s.repos30d ?? 0, 'repo')}</span>
      </div>
      {!!weeks.length && (
        <ul className="flex flex-col gap-1.5 text-sm" aria-label="Public pushes per week">
          {weeks.map((w) => (
            <li key={w.weekEnding} className="flex items-center gap-3">
              <span className="w-24 font-mono text-[12px] text-muted">to {new Date(w.weekEnding).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full" style={{ width: `${(w.pushes / most) * 100}%`, background: 'var(--accent)' }} /></span>
              <span className="w-10 text-right font-mono text-[12px]">{w.pushes}</span>
            </li>
          ))}
        </ul>
      )}
      {!!s.topRepos?.length && (
        <div>
          <div className="mb-2 text-sm font-medium">Most active repos</div>
          <div className="flex flex-wrap gap-2">
            {s.topRepos.map((r) => <Pill key={r.name}>{r.name} · {r.pushes}</Pill>)}
          </div>
        </div>
      )}
      <p className="text-sm text-muted">
        Public repos only. Private work is not visible here, and GitHub can take a while to show new pushes.
        {s.truncated && ' You are very active, so GitHub only showed part of the last 30 days.'}
      </p>
    </div>
  );
}

/**
 * Coding practice (D-59, D-60): link a LeetCode username and a Codeforces handle to see solved
 * problems, ratings and topics next to your VS Code time. Public data only; shown only to you.
 */
export default function LinkedAccounts() {
  const links = useLinks();
  if (links.isPending) return <Skeleton className="h-40" />;
  if (links.isError) return <p role="alert" className="text-sm text-bad-ink">Could not load your linked accounts. {errorText(links.error)}</p>;
  const { leetcode, codeforces, github } = links.data;
  return (
    <div className="flex flex-col gap-4">
      <Account provider="leetcode" linked={leetcode} icon={<Code2 className="h-5 w-5" />}>
        {leetcode && <LeetCodeStats lc={leetcode} />}
      </Account>
      <Account provider="codeforces" linked={codeforces} icon={<Trophy className="h-5 w-5" />}>
        {codeforces && <CodeforcesStats cf={codeforces} />}
      </Account>
      <Account provider="github" linked={github} icon={<GitBranch className="h-5 w-5" />}>
        {github && <GithubStats gh={github} />}
      </Account>
    </div>
  );
}
