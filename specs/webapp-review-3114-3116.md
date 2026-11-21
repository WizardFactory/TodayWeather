# Specification: Webapp Chart, Navigation, and UI Fixes (#3114, #3115, #3116)

- **Intent**: [intent/webapp-review-3114-3116.md](../intent/webapp-review-3114-3116.md)
- **Plan Review Disposition**: `reports/sdlc/webapp-review-3114-3116/plan-review-disposition.md`

## Baseline Deltas (Explicit Updates to Existing Specs/Docs)
The following two documented behaviors are deliberately amended by this work and updated in their canonical documents in the same PR:
1. **PR 1 (#3114) — Bounded hourly segment spacing**: Amends `specs/design-system.md` §5.1 ("Hour-by-hour rows … keep time-proportional x") and `docs/architecture/web-client.md:77` so mixed 1h/3h and off-hour observations use bounded chronological segment spacing (`hourlyXPositions`) with line breaks on gaps `> 3h`, preventing 10,000+ px width blowup on mobile while preserving chronological order and ≥ column separation. **Unchanged Cordova rules preserved**: hourly column 0 omits icon/precipitation (`specs/design-system.md:294`); daily hides `0%`/past probability (`specs/design-system.md:361`).
2. **PR 2 (#3115) — Hourly entry keeps Hero visible**: Amends `docs/architecture/web-client.md:89`, `specs/design-system.md:384`, and `docs/webapp/user-manual.json:29` so default `/weather/:id/hourly` entry starts at top with Hero visible (focusing `#main-content` on route change / Retry recovery with `preventScroll`), while `/weather/:id/daily` continues scrolling to and focusing the daily chart.

---

## 1. Issue #3114 — Hourly & Daily Charts

### 1.1 Chart CSS Scoping (`web/src/style.css`)
- Remove legacy `.chart-scroll svg { display: block; width: 100%; max-height: 245px; }` (lines 646-650) and `.chart-scroll { overflow: auto; margin: 0 -6px; }` (lines 642-645).
- Keep `.chart-timeline > svg { display: block; max-width: none; overflow: visible; }` with no `max-height: 245px` cap.
- Define `.chart-hit { fill: transparent; cursor: pointer; }`.
- Define `.hourly-chart .now { fill: none; stroke: var(--tw-chart-now); stroke-width: 2.5; }` (outer ring around `.today-point`), and under `@media (forced-colors: active)` set `.hourly-chart .now { fill: none; stroke: CanvasText; }` while keeping `.daily-chart .now` filled `CanvasText`.
- All styles remain compliant with `web/test/design-source.test.ts`.

### 1.2 Core Chart Model (`packages/weather-core/src/charts.ts`)
- **`hourlyChart` current-observation merge whitelist**:
  - When `inRange && finite(weather.current.temperature)`:
    - If `existing = timeline.get(now)` exists: merge starting from `existing`, always applying `temperature: weather.current.temperature`, applying scalar fields (`humidity`, `wind`, `windDirection`, `windDegrees`, `pressure`, `visibility`, `feelsLike`, `description`, `sunrise`, `sunset`, `uv`, `discomfort`) only when non-null and non-empty, applying `icon` when `weather.current.icon` is non-empty, applying `rainProbability` only when `weather.current.rainProbability !== null` (preserving `existing.rainProbability`), and applying precipitation/snowfall groups atomically only when `weather.current.precipitation !== null` / `weather.current.snowfall !== null`.
    - If `existing` does not exist (off-hour `current.at` inserted between forecast rows): if `weather.current.rainProbability === null`, borrow `rainProbability` from the nearest enclosing supplied slot within 3 hours (preferring the slot at or immediately before `now`, else immediately after `now`).
- **`hourlyXPositions(times, column, pad, viewport)` (exported pure function)**:
  - `HOUR = 3_600_000`.
  - For consecutive timestamps `dt = times[i] - times[i - 1]`:
    - `dt <= HOUR`: `column`
    - `dt <= 3 * HOUR`: `column * (1 + 0.35 * ((dt - HOUR) / (2 * HOUR)))` (1.0× at 1h → 1.35× at 3h)
    - `dt > 3 * HOUR`: `column * 1.5`
  - `xs[0] = pad`, `xs[i] = xs[i - 1] + segmentWidth(dt, column)`.
  - `width = Math.max(viewport, (xs[n - 1] ?? pad) + pad)`.
  - Returns `{ xs, width, gapBefore }`.
- **`linePath(values, x, y, breakBefore?)`**:
  - Optional 4th parameter `breakBefore?: (index: number) => boolean` starts a new subpath (`M`) whenever `breakBefore(i)` is true (used in `HourlyChart` when `rows[i].time - rows[i - 1].time > 3 * HOUR`). Backward-compatible with existing 3-argument callers.

### 1.3 Hourly Chart Rendering (`web/src/Charts.tsx`)
- **`useMetrics(ref, active)`**: Includes `active` (`Boolean(n)`) in `useLayoutEffect` deps and returns `{ rem, width, measured }`.
- **Expanded column width**: When `display.chartExpanded` is true, measure `windText(r.point.windDirection)` plus `rem * 1.5` (for `<ArrowUp size="1em" />` + gap) so `.chart-wind-direction` never overlaps across columns at 100% or 130% scale.
- **Pinned Y-axis overlay**: Wrap `.chart-scroll` in `.chart-plot-wrap` (`position: relative`). Render `.chart-y-axis` (`aria-hidden="true"`, `pointer-events: none`, `position: absolute; left: 0;`) outside `.chart-scroll` aligned to the SVG plot top offset (`hourly-columns` height) and exact `y(v)` coordinates, with translucent `--panel` pill background. Include Y-axis clearance (`yAxisPad = rem * 2.75`) in `pad`, initial scroll offset, and `useCursor` left bound.
- **Current marker & yesterday values**: Render current temperature inside the blue `.today-point` circle (`today-value` white text, WCAG AA, `fill: Canvas` under `forced-colors: active`), ringed by `<circle className="now" r={dotRadius + 3} />` (`fill: none`). Show yesterday dot + value whenever vertical clearance `Math.abs(y(yest) - y(today)) >= dotRadius * 2 + rem * 0.35` (else small dot `r={rem * 0.25}` with no overlapping text).
- **Column 0 preserved**: Keep `i > 0` for icon/probability/amount per `specs/design-system.md:294` and `pwa-design.spec.ts:487`.
- **Hit rects & interaction**: Each hourly `<g>` begins with `<rect className="chart-hit" x={left} y={0} width={right - left} height={height} />` (midpoint-to-midpoint) followed by `<title>`, with `onClick={() => setCursor(i)}` and `onPointerEnter={(e) => { if (e.pointerType === "mouse") setCursor(i); }}`.
- **Scroll preservation**: Track `anchorTimeRef` on `onScroll` (timestamp of column nearest viewport left + `yAxisPad`). Reset `anchorTimeRef.current = null` only when `(w.location.id, lang, unitKey)` changes (NOT on `w.observedAt` refetch). In `useLayoutEffect`, once `measured` is true: if `anchorTimeRef.current === null`, scroll to `Math.max(0, x(model.startIndex) - yAxisPad - column * 0.55)` and store its anchor time; otherwise re-apply scroll to keep `anchorTimeRef.current` at the same offset when `column`/`rem`/`viewport` change.

### 1.4 Daily Chart Rendering (`web/src/Charts.tsx`)
- **Compact 2-line header**:
  - Line 1 (`.chart-day-primary`): `relativeDay(at, current.at)` when non-empty AND concise (for `ko`, all 7 words; for non-`ko`, `Math.abs(days) <= 1` so multi-word `"depois de amanhã"` / `"pasado mañana"` doesn't bloat columns), else short weekday (`Intl.DateTimeFormat(lang, { weekday: "short", timeZone: "UTC" })`).
  - Line 2 (`.chart-day-date`): `dateText(at, false)` when weekday is already on line 1, or `dateText(at, true)` when line 1 is a relative word (`오늘` + `11. 22. (일)`).
  - Measure `column` as the maximum of: line 1 widths, line 2 widths, AM/PM pair width (measured width of `t("display.am")` + `t("display.pm")` + `rem * 2.5` for icon/gap/padding), and floor `rem * 4.5`.
- **Guaranteed Today-visible initial scroll**:
  - When `width > viewport + 1`: `desired = model.startIndex * cell`, `minForToday = Math.max(0, (model.todayIndex + 1) * cell - viewport)`, `maxForToday = Math.max(0, model.todayIndex * cell)`, `initialScroll = Math.min(maxForToday, Math.max(desired, minForToday))`.
  - Use the same `measured` + `anchorDateRef` pattern so resize does not jump away from the user's scrolled position (resetting to `0` if `width <= viewport + 1`).
- **Hit rects & interaction**: Each daily `<g>` starts with `<rect className="chart-hit" x={i * cell} y={0} width={cell} height={height} />` followed by `<title>`, with `onClick={() => setCursor(i)}` and `onPointerEnter={(e) => { if (e.pointerType === "mouse") setCursor(i); }}`.
- **Cordova probability rule preserved**: Keep `!r.past && r.point.rainProbability ? percent(...) : "—"` per `specs/design-system.md:361`.
- **AM/PM period row**: Render `.chart-period` only when `model.rows.some((r) => !r.mergedIcons)`.

---

## 2. Issue #3115 — Weather Page Scroll, Focus, Tabs & Precipitation

### 2.1 Scroll & Focus Decision Table (`web/src/App.tsx`, `web/src/Weather.tsx`)

| Entry / Event | Route / View | Scroll Target | Focus Target | Owner |
| --- | --- | --- | --- | --- |
| Direct load / reload | `/weather/:id/hourly` or `/overview` | Top (`scrollY = 0`, Hero visible) | Browser default (no hijack) | `App.tsx` (`firstRoute`) |
| Direct load / reload | `/weather/:id/daily` | `[data-weather-section="daily"]` (`instant`) | `.daily-chart` (or section if empty) | `Weather.tsx` |
| City select (`/` or `/locations` or sidebar) | `/weather/:id/hourly` or `/overview` | Top (`window.scrollTo(0, 0)`) | `#main-content` (`preventScroll`) | `App.tsx` |
| Mobile menu → "날씨" | `/weather/:id/hourly` | Top (`window.scrollTo(0, 0)`) | `#main-content` after `!menuOpen` (`inert` cleared) | `App.tsx` |
| Tab click (`keepFocus: true`) → `시간별` / `한눈에` | `/hourly` or `/overview` | Top (`window.scrollTo(0, 0)`) | Keep focus on pressed tab | `App.tsx` |
| Tab click → `일별` | `/daily` | `[data-weather-section="daily"]` | `.daily-chart` (or section if empty) | `Weather.tsx` |
| History Back/Forward (`POP`) → `/hourly` or `/overview` | `/hourly` or `/overview` | Top (`window.scrollTo(0, 0)`) | `#main-content` (`preventScroll`) | `App.tsx` |
| History Back/Forward (`POP`) → `/daily` | `/daily` | `[data-weather-section="daily"]` | `.daily-chart` (or section if empty) | `Weather.tsx` |
| Loading / Error state | `/hourly` or `/daily` | Top | `#main-content` (`preventScroll`, after `!contentInert`) | `App.tsx` / `Weather.tsx` |
| Error → Retry succeeds | `/hourly` or `/overview` | Top (preserve Hero visible) | `#main-content` (`preventScroll`, prevents focus falling to `body`) | `Weather.tsx` |
| Error → Retry succeeds | `/daily` | `[data-weather-section="daily"]` | `.daily-chart` (or section if empty) | `Weather.tsx` |
| `/loc` preview view change (`?view=hourly` ↔ `?view=daily`) | `/loc` | `hourly`: Top (`window.scrollTo(0, 0)`); `daily`: `[data-weather-section="daily"]` | `hourly`: keep tab focus on click / `#main-content` on POP; `daily`: `.daily-chart` | `Weather.tsx` |

Implementation rules:
- Narrow `App.tsx:262` regex from `/^\/weather\/[^/]+\/(hourly|daily)$/` to `/^\/weather\/[^/]+\/daily$/`.
- In `Weather.tsx`, `pendingContentFocus` tracks `daily` chart focus; additionally track a `wasErrorOrPending` ref for `hourly`/`overview` so when `ErrorState` unmounts after Retry success, `#main-content` receives `focus({ preventScroll: true })` (if focus fell to `body` or was inside the unmounted error alert) without scrolling Hero out of view.
- For `/loc` preview (`preview` prop set), when `view` switches from `daily` to `hourly`, call `window.scrollTo(0, 0)`.

### 2.2 Upcoming Precipitation Helper (`web/src/format.ts`, `web/src/Weather.tsx`)
- Add `upcomingPrecipitation(weather: Pick<Weather, "current" | "hourly" | "daily">, view: string): Point[]` in `web/src/format.ts`:
  - `view === "daily"`: compare dates via `wallTime(p.at.slice(0, 10) + "T00:00") >= wallTime(weather.current.at.slice(0, 10) + "T00:00")`; fallback `weather.daily.slice(-8)`; return `.slice(0, 8)`.
  - Otherwise: compare via `wallTime(p.at) >= wallTime(weather.current.at)` (keeping in-progress `precipitationBasis === "partial"` rows whose timestamp is `>= current.at` or ending after `current.at`); fallback `weather.hourly.slice(-8)`; return `.slice(0, 8)`.

### 2.3 Tab Semantics
- `시간별` (`/hourly`) and `한눈에` (`/overview`) intentionally render the same top-aligned combined overview (Hero → Hourly → Daily → Air → Details, per `specs/pwa-design-adoption.md` AC16) with hourly upcoming precipitation so existing `startup: "overview"` users remain compatible without unexpected layout removal; `일별` (`/daily`) jumps to Daily chart and switches precipitation to daily; `미세먼지` (`/air/:id`) opens the dedicated Air details view.

---

## 3. Issue #3116 — UI/CSS Cleanup & Minor Display Fixes

### 3.1 Negative Zero Formatting (`packages/weather-core/src/index.ts`)
- In `formatValue(v, digits = 0)`: normalize near-zero negative values that round to zero (`const factor = 10 ** digits; const rounded = Math.round(v * factor) / factor; const safe = Object.is(rounded, -0) || rounded === 0 ? 0 : v;`) before calling `Intl.NumberFormat(numberLocale, { maximumFractionDigits: digits }).format(safe)`.

### 3.2 Sidebar Single Active State (`web/src/App.tsx`)
- `날씨`: render as `NavLink` or `Link` with `active` class and `aria-current="page"` whenever `location.pathname.startsWith("/weather/")` OR (`!selected && (location.pathname === "/" || location.pathname === "/start")`).
- `미세먼지`: when `selected` is set, keep `<NavLink to={"/air/" + selected.id} className="nav-item">`; when `!selected`, render `<Link to="/start" className="nav-item">` so it never receives `active` or `aria-current="page"` on `/start`.

### 3.3 Card Layouts, `.live-dot`, Air Bars (`web/src/Weather.tsx`, `web/src/style.css`)
- Remove `<span className="live-dot" />` from `Weather.tsx` and `.live-dot` from `style.css`.
- Restrict CSS edits in PR 3 strictly to AC-6 selectors (`.detail-grid`, `.precip-grid`, `.air-summary`, `.live-dot`, `.bar-chart`); do not modify PR 1's chart selectors.
- Keep `.detail-grid` class on `.details-panel` (`web/e2e/review.spec.ts:73`), styling each tile with `background: var(--soft); border-radius: var(--tw-radius-md); padding: var(--tw-space-3);` and clean spacing. Add `.precip-grid` on the "강수·눈 예보" grid so date/time sits on line 1 and rain/snow text sits cleanly below.
- On desktop (`@media (min-width: 768px)`), style `.air-summary` with a balanced horizontal content grid (`.air-summary-body` or CSS grid placing orb + small values/stamp beside AQI forecast and credit) so it fills the full-width card cleanly; preserve existing mobile grid layout.
- On `.bar-chart`, keep all 24 slots and `title` attributes (`docs-gap.spec.ts:98-102`), add `white-space: nowrap` and `min-width: 3.5rem` on `.bar-chart > div`, and set initial `scrollLeft` in a `useLayoutEffect` so the observed bar (index 12, or first non-null bar) is centered/visible on narrow viewports.
