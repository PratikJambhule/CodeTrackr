import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';

const SRC = '/demo/codetrackr-1min.mp4';
const POSTER = '/demo/demo-poster.webp';

/**
 * The one-minute demo on the landing page. Nothing is downloaded until someone
 * presses play (many visitors are on mobile data): the still frame loads lazily
 * and the <video> element only exists after the click. The video has captions
 * burned in and no sound.
 */
export function DemoVideo() {
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (playing) ref.current?.play()?.catch(() => {});
  }, [playing]);

  return (
    <div className="card relative aspect-video overflow-hidden" style={{ background: '#12101C' }}>
      {playing ? (
        <video
          ref={ref}
          src={SRC}
          controls
          playsInline
          preload="auto"
          aria-label="CodeTrackr in one minute: install the extension, sign in from VS Code, then the dashboard, a group race, goals and the leaderboard"
          className="h-full w-full bg-bg"
        />
      ) : (
        <button type="button" onClick={() => setPlaying(true)} aria-label="Play the one-minute demo video" className="group relative block h-full w-full">
          <img src={POSTER} alt="" loading="lazy" decoding="async" width={1280} height={720} className="h-full w-full object-cover opacity-75 transition-opacity group-hover:opacity-90" />
          {/* The video is always dark, so its frame stays dark in the light theme too. */}
          <span aria-hidden="true" className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(18,16,28,.85) 0%, transparent 55%)' }} />
          <span
            aria-hidden="true"
            className="brand-gradient absolute left-1/2 top-1/2 flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full shadow-card transition-transform group-hover:scale-105 sm:h-24 sm:w-24"
          >
            <Play className="ml-1 h-9 w-9 fill-white text-white sm:h-10 sm:w-10" />
          </span>
          <span
            aria-hidden="true"
            className="absolute bottom-3 left-3 rounded-lg px-2.5 py-1 font-mono text-[12px] sm:bottom-6 sm:left-6 sm:px-3 sm:py-1.5 sm:text-[13px]"
            style={{ background: 'rgba(18,16,28,.85)', color: '#F2F0FA', border: '1px solid rgba(255,255,255,.14)' }}
          >
            0:59<span className="hidden sm:inline"> · captions, no sound needed</span>
          </span>
        </button>
      )}
    </div>
  );
}
