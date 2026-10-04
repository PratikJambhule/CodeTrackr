import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, Target } from 'lucide-react';
import { apiSend, errorText } from '../api';
import { useGoalProgress, useGoals } from '../hooks/queries';
import { Ring } from '../components/charts/Ring';
import { Button, Card, CardTitle, EmptyState, ErrorBox, Modal, PageHeader, Pill, Skeleton, TextArea, TextField, useToast } from '../components/ui';
import { dayLabel, daysBetween, deadlineKey, hoursHm, localDateKey, monthShort, relativeDay } from '../lib/format';
import type { Goal, GoalProgress } from '../types';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function NewGoalDialog({ open, onClose, deadline }: { open: boolean; onClose: () => void; deadline: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const todayKey = localDateKey(new Date());
  const [form, setForm] = useState({ title: '', description: '', targetHours: '10', techStack: '', deadline });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Re-seed the date when the dialog is opened from a different calendar day.
  const [seed, setSeed] = useState(deadline);
  if (open && seed !== deadline) {
    setSeed(deadline);
    setForm((f) => ({ ...f, deadline }));
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // The date is sent exactly as picked (YYYY-MM-DD). The old calendar converted
      // local midnight with toISOString(), which in India made it the day before.
      await apiSend('POST', '/api/goals/create', { ...form, targetHours: Number(form.targetHours) });
      await qc.invalidateQueries({ queryKey: ['goals'] });
      toast(`Goal set: ${form.title}`);
      setForm({ title: '', description: '', targetHours: '10', techStack: '', deadline });
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="New goal" description="Hours on a language or project, by a date.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField label="Goal" required maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Finish the DSA sheet" />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Hours" type="number" required min={0.5} step={0.5} value={form.targetHours} onChange={(e) => setForm({ ...form, targetHours: e.target.value })} />
          <TextField label="Deadline" type="date" required min={todayKey} value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
        </div>
        <TextField
          label="Language or project"
          value={form.techStack}
          onChange={(e) => setForm({ ...form, techStack: e.target.value })}
          placeholder="python"
          hint="Hours count when the language or the project (folder) name matches, from now until the deadline."
        />
        <TextArea label="Notes (optional)" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        {error && (
          <p role="alert" className="text-sm text-bad-ink">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Set goal'}
        </Button>
      </form>
    </Modal>
  );
}

function GoalItem({ goal, progress }: { goal: Goal; progress?: GoalProgress }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = deadlineKey(goal.deadline);
  const done = goal.status === 'completed';
  const ratio = progress ? progress.currentHours / Math.max(goal.targetHours, 0.01) : 0;
  const late = !done && daysBetween(new Date(), key) < 0;
  const toggle = async () => {
    try {
      await apiSend('PATCH', `/api/goals/${goal._id}/${done ? 'reopen' : 'complete'}`);
      await qc.invalidateQueries({ queryKey: ['goals'] });
      toast(done ? `Reopened “${goal.title}”` : `Completed “${goal.title}”`);
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };
  return (
    <Card as="li" className={`flex flex-wrap items-center gap-4 p-5 ${done ? 'opacity-80' : ''}`}>
      <Ring value={ratio} size={64} stroke={8} tone={done || ratio >= 1 ? 'good' : 'accent'} label={`${Math.round(Math.min(1, ratio) * 100)}% done`}>
        <span className="font-mono text-[12px]">{Math.round(Math.min(1, ratio) * 100)}%</span>
      </Ring>
      <div className="min-w-[200px] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-ink">{goal.title}</h3>
          {done && <Pill tone="good">completed</Pill>}
          {late && <Pill tone="bad">overdue</Pill>}
        </div>
        {goal.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{goal.description}</p>}
        <p className="mt-1.5 font-mono text-[12px] text-muted">
          {progress ? `${hoursHm(progress.currentHours)} of ${goal.targetHours}h` : '…'} · due {dayLabel(key)} ({relativeDay(key)})
          {goal.techStack ? ` · counts: ${goal.techStack}` : ''}
        </p>
        {progress && !progress.matched && <p className="mt-1 text-xs text-warn-ink">No language or project set, so no hours are counted for this goal.</p>}
      </div>
      <Button size="sm" variant={done ? 'ghost' : 'secondary'} onClick={toggle}>
        {done ? 'Reopen' : 'Mark complete'}
      </Button>
    </Card>
  );
}

function MonthCalendar({ goals, onPick }: { goals: Goal[]; onPick: (key: string) => void }) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const todayKey = localDateKey(new Date());
  const dueOn = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of goals) if (g.status !== 'completed') m.set(deadlineKey(g.deadline), (m.get(deadlineKey(g.deadline)) ?? 0) + 1);
    return m;
  }, [goals]);
  const lead = (month.getDay() + 6) % 7; // Monday-first grid
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array.from({ length: lead }, () => null), ...Array.from({ length: daysInMonth }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <Button size="sm" variant="ghost" aria-label="Previous month" onClick={() => shift(-1)} icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />} />
        <h2 className="display text-balance text-[26px]" aria-live="polite">
          {monthShort(month.getMonth())} {month.getFullYear()}
        </h2>
        <Button size="sm" variant="ghost" aria-label="Next month" onClick={() => shift(1)} icon={<ChevronRight className="h-4 w-4" aria-hidden="true" />} />
      </div>
      <div className="grid grid-cols-7 gap-1.5 text-center">
        {WEEKDAYS.map((d) => (
          <span key={d} aria-hidden="true" className="pb-1 font-mono text-[11px] text-faint">
            {d.slice(0, 2)}
          </span>
        ))}
        {cells.map((date, i) => {
          if (!date) return <span key={`blank-${i}`} />;
          const key = localDateKey(date);
          const past = key < todayKey;
          const due = dueOn.get(key);
          return (
            <button
              key={key}
              type="button"
              disabled={past}
              onClick={() => onPick(key)}
              aria-label={`${dayLabel(key)}${due ? `, ${due} goal${due > 1 ? 's' : ''} due` : ''}${past ? '' : '. Set a goal due this day'}`}
              className={`relative min-h-[40px] rounded-lg text-sm font-semibold transition disabled:cursor-default disabled:opacity-35 ${
                key === todayKey ? 'bg-accent text-white' : due ? 'bg-accent-soft text-ink' : 'text-ink hover:bg-surface-2'
              }`}
            >
              {date.getDate()}
              {due && key !== todayKey && <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />}
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-sm text-muted">Pick a day to set a goal due then.</p>
    </Card>
  );
}

export default function Goals() {
  const goals = useGoals();
  // A new [] on every render would re-run the sort below each time while loading.
  const all = useMemo(() => goals.data ?? [], [goals.data]);
  const sorted = useMemo(
    () => [...all].sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed') || a.deadline.localeCompare(b.deadline)),
    [all],
  );
  const progress = useGoalProgress(sorted);
  const [dialog, setDialog] = useState<{ open: boolean; deadline: string }>({ open: false, deadline: '' });
  const openNew = (deadline?: string) => {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + 7);
    setDialog({ open: true, deadline: deadline ?? localDateKey(fallback) });
  };
  const openCount = sorted.filter((g) => g.status !== 'completed').length;

  return (
    <>
      <PageHeader
        eyebrow={openCount ? `${openCount} open` : 'Aim for something'}
        title="Goals"
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => openNew()}>
            New goal
          </Button>
        }
      >
        A number of hours on a language or project, by a date. You get a reminder before it is due.
      </PageHeader>

      <div className="flex flex-wrap items-start gap-6">
        <section aria-label="Your goals" className="min-w-0 flex-[2_1_480px]">
          {goals.isPending ? (
            <Skeleton className="h-64" />
          ) : goals.isError ? (
            <ErrorBox message={errorText(goals.error)} onRetry={() => goals.refetch()} />
          ) : sorted.length === 0 ? (
            <Card>
              <EmptyState icon={<Target className="h-10 w-10" />} title="No goals yet" action={<Button variant="primary" onClick={() => openNew()}>Set your first goal</Button>}>
                For example: 20 hours of python before the end of the month.
              </EmptyState>
            </Card>
          ) : (
            <ul className="flex flex-col gap-3">
              {sorted.map((g, i) => (
                <GoalItem key={g._id} goal={g} progress={progress[i]?.data} />
              ))}
            </ul>
          )}
        </section>
        <aside className="min-w-0 flex-[1_1_300px]">
          <MonthCalendar goals={all} onPick={openNew} />
          <Card className="mt-4 p-5">
            <CardTitle>How progress is counted</CardTitle>
            <p className="text-sm text-muted">
              Hours count from when you create a goal until its deadline, whenever the language or the project name matches what you typed. Marking a goal complete also teaches
              Insights how well you estimate.
            </p>
          </Card>
        </aside>
      </div>

      <NewGoalDialog open={dialog.open} deadline={dialog.deadline} onClose={() => setDialog({ ...dialog, open: false })} />
    </>
  );
}
