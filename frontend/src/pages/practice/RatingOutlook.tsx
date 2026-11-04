import { Link } from 'react-router-dom';
import { Card, CardTitle, Pill } from '../../components/ui';
import { pct, plural } from '../../lib/format';
import { outlookScale } from '../../lib/linked';
import type { RatingOutlook as Outlook } from '../../types';

const CF = 'var(--accent)';
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`;

/** The range on a scale: shaded 10–90% band, the middle as a bold tick, today's rating as a dot. */
function RangeScale({ o }: { o: Required<Pick<Outlook, 'range' | 'rating'>> }) {
  const s = outlookScale(o.rating, o.range);
  return (
    <figure className="m-0" aria-label={`Range ${o.range.low} to ${o.range.high}, most likely ${o.range.mid}, now ${o.rating}`}>
      {/* Above the band: the range's three numbers. On the band: the range and its middle.
          Below: where you are today, so the two never sit on top of each other. */}
      <div className="relative h-[92px]">
        <span className="absolute top-0 -translate-x-1/2 font-mono text-[12px] text-muted" style={{ left: `${s.low}%` }}>{o.range.low}</span>
        <span className="absolute top-0 -translate-x-1/2 font-mono text-[13px] font-semibold text-ink" style={{ left: `${s.mid}%` }}>{o.range.mid}</span>
        <span className="absolute top-0 -translate-x-1/2 font-mono text-[12px] text-muted" style={{ left: `${s.high}%` }}>{o.range.high}</span>
        <div className="absolute inset-x-0 top-[32px] h-1.5 rounded-full bg-line" />
        <div className="absolute top-[24px] h-[22px] rounded-md" style={{ left: `${s.low}%`, width: `${s.high - s.low}%`, background: CF, opacity: 0.3 }} />
        <div className="absolute top-[20px] h-[30px] w-[3px] rounded bg-ink" style={{ left: `calc(${s.mid}% - 1.5px)` }} />
        <div
          className="absolute top-[54px] h-0 w-0 -translate-x-1/2 border-x-[7px] border-b-[9px] border-x-transparent"
          style={{ left: `${s.now}%`, borderBottomColor: 'var(--warn)' }}
          aria-hidden="true"
        />
        <span className="absolute top-[66px] -translate-x-1/2 whitespace-nowrap font-mono text-[12px] text-warn-ink" style={{ left: `${s.now}%` }}>now {o.rating}</span>
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-muted">
        <span><span className="mr-1 inline-block h-2.5 w-5 rounded align-middle" style={{ background: CF, opacity: 0.4 }} />likely range (8 in 10)</span>
        <span><span className="mr-1 inline-block h-3 w-[3px] rounded bg-ink align-middle" />most likely</span>
        <span><span className="mr-1 inline-block h-0 w-0 border-x-[5px] border-b-[7px] border-x-transparent align-middle" style={{ borderBottomColor: 'var(--warn)' }} />your rating now</span>
      </figcaption>
    </figure>
  );
}

/**
 * Rating outlook (D-63): the ML part of the Practice page. A 10–90% range for the Codeforces rating
 * in 12 weeks, from three gradient-boosting models trained on ~37k Codeforces users, plus one
 * what-if, and an open explanation of how it was built and tested.
 */
export function RatingOutlook({ o, linked }: { o: Outlook | null; linked: boolean }) {
  const weeks = Math.round((o?.horizonDays ?? 84) / 7);
  return (
    <Card className="p-6">
      <CardTitle aside={<span className="flex items-center gap-2"><Pill tone="accent">ML</Pill><Pill>experimental</Pill></span>}>Rating outlook</CardTitle>

      {!linked ? (
        <p className="text-sm text-muted"><Link to="/profile">Link your Codeforces handle</Link> to get a forecast of where your rating is heading.</p>
      ) : !o || !o.eligible || !o.range || o.rating == null ? (
        <p className="text-sm text-muted">
          No outlook yet: {o?.reason ?? 'it is computed at the next nightly refresh'}. The model learned from people with at least 6 rated contests and a recent one, so it
          would only be guessing before that.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <div className="min-w-0">
            <p className="text-lg leading-snug">
              In {weeks} weeks your Codeforces rating is likely between <strong>{o.range.low}</strong> and <strong>{o.range.high}</strong>.
            </p>
            <p className="mt-1 text-sm text-muted">
              Most likely about <strong className="text-ink">{o.range.mid}</strong> ({signed(o.change!.mid)} from {o.rating} now).
            </p>
            <div className="mt-5">
              <RangeScale o={{ range: o.range, rating: o.rating }} />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <div className="rounded-xl border border-line p-4">
              <div className="text-sm font-medium">What could move it</div>
              {o.whatIfHarder != null && o.whatIfHarder >= 3 ? (
                <p className="mt-1 text-sm">
                  If a quarter more of your solved problems were <strong>above your rating</strong>, the model's middle estimate moves to{' '}
                  <strong>{o.range.mid + o.whatIfHarder}</strong> ({signed(o.whatIfHarder)}).
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted">For your current practice, solving harder problems barely changes the model's estimate.</p>
              )}
              <p className="mt-2 text-xs text-muted">The model's estimate with that one habit changed: a pattern from other people, not a promise.</p>
            </div>
            {o.inputs && (
              <div className="rounded-xl border border-line p-4 text-sm">
                <div className="font-medium">What it looked at (last 4 weeks)</div>
                <ul className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[12px] text-muted">
                  <li>{plural(o.inputs.solved28d, 'problem')} solved</li>
                  <li>{plural(o.inputs.activeDays28d, 'active day')}</li>
                  <li>{pct(o.inputs.hardShare)} above your rating</li>
                  <li>{plural(o.inputs.contests60d, 'contest')} in 60 days</li>
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      <details className="group mt-6 border-t border-line pt-4">
        <summary className="cursor-pointer list-none text-sm font-semibold [&::-webkit-details-marker]:hidden">
          <span className="mr-1 inline-block transition group-open:rotate-90">›</span> How this forecast works
        </summary>
        <div className="mt-3 grid gap-4 text-sm text-muted md:grid-cols-3">
          <div>
            <div className="font-medium text-ink">The data</div>
            <p>About 37,000 Codeforces users and 1 million moments in their history (Kaggle "Codeforces User Practice and Rating History", public domain): each one's practice in the 4 weeks before a contest, and how their rating moved over the next 12 weeks.</p>
          </div>
          <div>
            <div className="font-medium text-ink">The model</div>
            <p>Three gradient-boosting models learn the low end (10th percentile), the middle and the high end (90th) of the rating change from 14 numbers: your rating, recent contests and your last 4 weeks of practice. It runs on CodeTrackr's server, refreshed nightly.</p>
          </div>
          <div>
            <div className="font-medium text-ink">How it was checked</div>
            <p>
              On {o?.heldOutPeople ? o.heldOutPeople.toLocaleString('en-IN') : 'about 7,500'} people it never saw, {o?.coverage != null ? pct(o.coverage, 1) : 'about 80%'} of real outcomes fell inside the range, and the middle beat both
              "no change" and "rating alone". Why a range: contest-day luck is large, so a single number would usually be wrong.
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">
          One finding we deliberately do not show: in this data, more active days went with slightly smaller gains, most likely because of something the data cannot see (for
          example, many easy problems). Codeforces only; LeetCode does not share a rating history to learn from.
        </p>
      </details>
    </Card>
  );
}
