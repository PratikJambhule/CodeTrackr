# Spec: frontend redesign — "the weekly race" (2026-10-04)

Status: approved by the user 2026-10-04 ("go with all recommended options"); **built and verified locally
2026-10-04, not deployed** (results in `docs/PROGRESS.md`). Design proposal (5 boards):
https://claude.ai/artifact/UV7w4e3rqTpAdGopAKmG7o

## 1. Why

The user dislikes the current site: flashy effects (3D background, glitch and typing text, custom
cursor, 28 themes), confusing layouts (Dashboard 1,150 lines, Groups 894), and a dated look. There is
no public page that explains what CodeTrackr is or how to start. The product exists for friendly
competition in a college friend group, but the site leads with solo charts.

## 2. Goals

1. One idea carries the design: **every week is a race between friends**. The signature is a
   standings tower (position, name, one cell per day, gap to the leader) borrowed from F1 timing.
2. Public pages: landing (`/`), guide (`/guide`), privacy (`/privacy`), plus group invite links
   (`/join/:groupId`).
3. Every existing feature keeps working with the same API, except the additions in §6.
4. Smaller and faster: remove three / ogl / postprocessing / gsap and the chart library; split
   pages so the landing page does not load the dashboard. Measured before and after.
5. Works at phone width, keyboard-usable, 4.5:1 text contrast, reduced motion respected.
6. Frontend tests (Vitest) — closes the "no frontend tests" gap.

Non-goals: new backend features beyond §6; removing the profile API key (parked separately); a
public, signed-out leaderboard; changing what the extension sends.

## 3. Decisions (detail in DECISIONS.md D-31..D-34)

| Decision | Choice | Rejected |
|---|---|---|
| Visual direction | dark-first + full light theme; tokens as CSS variables | keeping 28 themes (user approved dropping them) |
| Type | Big Shoulders Display (display), Instrument Sans (body), Martian Mono (data) via Google Fonts | Inter/system only (generic) |
| Charts | small hand-made SVG/HTML components | Chart.js (canvas: no CSS variables, untestable in jsdom, ~200 kB) |
| Motion | one orchestrated moment (tower rows slide via FLIP); `prefers-reduced-motion` disables it | effects everywhere |
| Tests | Vitest + Testing Library + jsdom | Jest (extra config with Vite) |

## 4. Design tokens

Dark: bg `#12101C`, surface `#1C1929`, surface-2 `#241F35`, line `#2E2A40`, ink `#F2F0FA`,
muted `#A9A3C2`, purple `#B26BFF` (best in group, focus, "you"), green `#35D07F` (personal best),
yellow `#F2C94C` (coded), red `#FF5C7A` (failures only), gold/silver/bronze for P1–P3, brand
gradient `#7C3AED → #DB2777` (logo and primary button only). Light theme: same roles, darker
accents for contrast (purple `#7C3AED`, green `#13804A`, red `#C8264B`, ink `#1A1630`).

Day cells: purple = best in group that day; green = your best day of the window so far; yellow =
coded; grey = day off; dim = not yet happened.

## 5. Information architecture

Public: `/` landing · `/guide` · `/privacy` · `/login` · `/join/:groupId` (signed out → login, then
back) · `/device` (same).
Signed in (sidebar on desktop, bottom tabs on phones): `/dashboard` · `/leaderboard` · `/groups` ·
`/groups/:groupId` (board, was a modal) · `/goals` · `/insights` · `/profile` · `/onboarding` ·
`/device`. Signed-in visitors to `/` see the landing page with an "Open dashboard" button.

## 6. API additions (backend, each with integration tests)

1. `GET /api/analytics/history/:userId?timezone=` → `{ days: [{date, seconds}] (last 365 local
   days, days with activity only), hourOfDay: [24 × seconds] (last 7 local days), projects:
   [{name, seconds}] (last 7 days, top 8), commits7d }`. Owner only.
2. `GET /api/groups/:groupId/details` gains `daily: { dates: [...], byUser: { id: [seconds…] } }`
   for the board window (or the last 7 local days when all-time), with `?timezone=`. Additive.
3. `GET /api/groups/:groupId/preview` → name, description, visibility, member count, whether the
   caller is a member. For invite links. Same exposure as Discover (no member list, no emails).

## 7. Testing and acceptance

- Unit (Vitest): formatting, standings ranking and day-cell rules, end-label layout, heatmap levels
  and streaks, local date keys (regression for the goal-date bug), peak hours window.
- Component: tower renders an ordered list with readable labels; heatmap cell count; landing links;
  routing (signed-out `/` shows landing, protected pages send to login).
- Backend: integration tests for §6. All existing suites stay green.
- Seen in the browser (local `dev-local` API + Vite) for every page, desktop and phone width, both
  themes.
- Bundle: record `npm run build` sizes before (baseline below) and after.

Baseline (2026-10-04, before any change): one JS chunk 712.08 kB (gzip 224.96 kB), CSS 35.91 kB
(gzip 7.23 kB).

## 8. Slices (each green before the next)

1. Backend additions + richer local seed data.
2. Foundation: tokens, theme, fonts, UI and chart components, app shell, Vitest; old effects and
   chart library removed.
3. Public pages: landing, guide, privacy, login, join.
4. Dashboard.
5. Leaderboard, groups list, group board.
6. Goals, insights, profile, onboarding, device, notifications.
7. Phone + accessibility pass, bundle measurement, docs, interview prep, resume.

## 9. Risks

- Google Fonts adds a third-party request; acceptable, and fonts fall back to system faces.
- Vercel serves `/api` and `/auth` from Render, so no frontend route may start with those.
- Teammates' `THEME_USER_GUIDE.md` describes the old theme system; it is left untouched (project
  rule) and the user is told it is obsolete.
