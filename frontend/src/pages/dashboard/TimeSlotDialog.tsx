import { useTimeSlot } from '../../hooks/queries';
import { Bars, RankedBars } from '../../components/charts/Bars';
import { ErrorBox, Modal, Skeleton } from '../../components/ui';
import { errorText } from '../../api';
import { hm, int } from '../../lib/format';
import { hourLabel } from '../../lib/calendar';

/** Drill into a two-hour window of today (the old "time slot" view, kept). */
export function TimeSlotDialog({ userId, slot, onClose }: { userId: string; slot: { start: number; end: number } | null; onClose: () => void }) {
  const q = useTimeSlot(userId, slot);
  const d = q.data;
  return (
    <Modal open={slot !== null} onClose={onClose} wide title={slot ? `Today, ${hourLabel(slot.start)}–${hourLabel(slot.end)}` : ''} description="What you did in this two-hour window.">
      {q.isPending && <Skeleton className="h-64" />}
      {q.isError && <ErrorBox message={errorText(q.error)} onRetry={() => q.refetch()} />}
      {d && (
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Active time', hm(d.totalMinutes * 60)],
              ['Lines changed', int(d.totalLines)],
              ['Files', int(d.fileCount)],
              ['Commands failed', `${int(d.terminalSummary?.failedCommands ?? 0)} of ${int(d.terminalSummary?.totalCommands ?? 0)}`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-surface-2 p-3">
                <dt className="eyebrow">{k}</dt>
                <dd className="display text-balance mt-1 text-[30px]">{v}</dd>
              </div>
            ))}
          </dl>
          {d.activityCount === 0 ? (
            <p className="text-muted">No coding was recorded in this window.</p>
          ) : (
            <>
              <div>
                <h3 className="mb-3 font-semibold">Lines changed, every ten minutes</h3>
                <Bars
                  label="Lines changed every ten minutes"
                  height={120}
                  items={d.tenMinuteSlots.map((s) => ({ key: s.label, label: s.label.slice(0, 5), value: s.lines, display: s.lines ? String(s.lines) : '', title: `${s.label}: ${s.lines} lines` }))}
                />
              </div>
              <div>
                <h3 className="mb-3 font-semibold">Languages</h3>
                <RankedBars items={d.languages.map((l) => ({ label: l._id, value: l.minutes, display: hm(l.minutes * 60) }))} />
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
