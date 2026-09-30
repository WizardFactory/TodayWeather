# TodayWeather design system specification
Shared creation: [#2651](https://github.com/WizardFactory/TodayWeather/issues/2651). Production PWA adoption: [#2649](https://github.com/WizardFactory/TodayWeather/issues/2649). Life-index data: [#2650](https://github.com/WizardFactory/TodayWeather/issues/2650).

Inputs:
- [intent](../intent/design-system.md), with two amendments: typography first, and the Cordova charts as core content
- the investigation report (PWA, Cordova, native and reference apps)
- independent-verification-1 findings
- base 481aa49d

Status (2026-10-01): approved design input, with isolated documentation/typography references authorized by AK's steps 1–2 request. The production PWA still uses its original styles. Token-package creation and production adoption are later work. See [documentation guide](../docs/design-system/documentation-guide.md) for authoritative-source and status rules.

Current working base after AK-authorized master pull: `6ec6c68c`. The source investigation and original diagram remain pinned to `481aa49d`; their historical claims were not re-certified by the pull. Artifact storage and submission now follow [repository retention](../docs/development/artifact-retention.md).

**Consumers.**
- Primary: the React PWA in `web/`.
- Later: authorized TodayWeather native surfaces through generated tokens. TodayAir is retired; its retained source is a historical reference, not an active consumer.
- The Cordova app is the reference for brand continuity and **the model for the two core charts**.

## 1. Principles
1. **The charts are the product.** The Cordova hourly chart and daily chart are the primary content. The Cordova hourly chart shows today's temperature against yesterday's. The Cordova daily chart shows min–max bars on a shared scale, including past days. Every tier gives them the most prominent space after the hero, and no other pattern replaces them (§5).
2. **Glance first.** The current temperature, the yesterday comparison and the next notable change are readable at arm's length in under two seconds (Cordova hero, `client/www/js/controller.tabctrl.js:1278-1280`).
3. **Readable before dense.**
   - No information-bearing text below 13 px, and no text below 12 px.
   - Every text/background pair meets WCAG 2.2 AA on every surface it can appear on.
4. **One meaning, one color.** A hue denotes a single meaning and is always paired with text or shape. Colors come only from tokens.
5. **Calm sky, sharp data.** The condition-driven background belongs in the hero. Chart and data surfaces stay neutral. Motion is optional and turned off under reduced-motion.
6. **Platform-respectful, not platform-copying.** Patterns reported for iOS 27 and Samsung Weather may enrich the product (§11). No Apple or Samsung assets, typefaces or animations are copied.

## 2. Token architecture
**Format.** W3C DTCG JSON in a new workspace package, `packages/design-tokens/`. Tokens come in three tiers:

| Tier | What it holds | Examples |
| --- | --- | --- |
| `primitive` | Raw values. Components never reference these directly. | `blue.600`, `size.17` |
| `semantic` | Meaning, with modes. Color has `light`/`dark` modes; type and layout have `mobile`/`tablet`/`desktop` modes. | `text.secondary`, `type.body`, `air.kr.3.fill`, `chart.today` |
| `component` | Only a named deviation. | `hero.temp.size`, `chart.hourly.column` |

**Naming.** A dot path becomes a kebab-case CSS custom property with the `--tw-` prefix. For example, `chart.today` becomes `--tw-chart-today`.

**Web output.** The generator writes three files to ignored `web/src/generated/`:
- `tokens.css`, containing:
  - `:root`, which holds the light values and the mobile tier
  - dark overrides under `[data-appearance="dark"]`, and under `[data-appearance="system"]` inside `@media (prefers-color-scheme: dark)`
  - the tier media queries from §3.2
- `tokens.ts`, holding values and tier query strings for chart geometry and the `matchMedia` mirrors
- `contrast-report.json`

**When generation runs.**
- As npm pre-scripts: root `predev`, `pretypecheck`, `pretest` and `prebuild`, plus `web` `predev`/`prebuild`.
- So `npm run dev`, `npm run typecheck`, `npm test`, `npm run build` and `scripts/web-dev.mjs` all work on a clean checkout without committed output.

**Native output.** Deferred. JSON is the interchange format, and widget constants are produced only when that work is authorized (plan phase 7).

**Units.**
- rem: type, component spacing and chart geometry. These scale with the user's text size.
- px: borders, hairlines, breakpoints and shadows.
- `html` never sets `font-size`.

## 3. Typography (AC2, first priority)

### 3.1 Reasoning
- **CSS px do not guarantee equal perceived size across devices.** Actual display scaling, viewing distance, font metrics and user settings vary. The following values are product baselines to validate in browser references and later on physical devices, not a proof of physical equivalence:
  - **Touch tablets** are used for a glance at arm's length or propped on a stand. They get the largest reading sizes. The Cordova hero reached its 142 px cap on the iPad.
  - **Fine-pointer screens** (desktop or laptop, at any window width of 768 px or more) get the web-standard 16 px body. Density comes from a multi-column layout, not from smaller text.
  - **Phones** get a 17 px body, matching the Cordova card base and the iOS default body text.
- **Korean text looks denser than Latin text at the same size**, so:
  - body line height is 1.5–1.6
  - there is no negative letter-spacing on Hangul
  - `word-break: keep-all` applies under `:lang(ko)`

### 3.2 Tier assignment
The type tier is chosen independently of layout breakpoints.

| Type tier | Condition | Reference sizes it covers (`docs/webapp/specification.md` reference table) |
| --- | --- | --- |
| `mobile` | width < 768; **or** `(pointer: coarse)` with height < 540 (compact height) | All phones from 320 to 440 px wide. Landscape phones: 874×402, 932×430, 956×440. |
| `tablet` | width ≥ 768, `(pointer: coarse) and (hover: none)`, height ≥ 540 | Portrait: 768×1024, 810×1080, 820×1180, 800×1280. Landscape: 1180×688, 1180×629, 1205×753, 1280×800, 1334×800. A 753×1205 tablet viewport uses mobile type because width wins over device naming. |
| `desktop` | width ≥ 768 with a fine or hovering pointer | 1024×768 through 3440×1440, including 800×600 (about an 800×465 viewport) and narrow desktop windows of 768–1023 px. |

The `wide` modifier applies to the desktop tier at width ≥ 1600. It raises the hero and `title-1` to their tablet values. Content stays capped at 1440 px, and very large screens rely on browser zoom.

**Layout breakpoints are width-only.** They are separate from type:

| Breakpoint | Width |
| --- | --- |
| `bp.md` | 768 |
| `bp.lg` | 1024 |
| `bp.xl` | 1440 |
| `bp.2xl` | 1600 |

They replace the current 680/900/1190/1600 values and match the specification's IA ranges. Navigation by width:

| Width | Navigation |
| --- | --- |
| < 768 | bottom nav |
| 768–1023 | 80 px rail |
| ≥ 1024 | 240 px sidebar |

**Pointer detection risk.** An iPad with a trackpad may report a fine pointer. If it does, it gets desktop type, which is still readable. The plan requires a device check.

Precedence is explicit: width below 768 → mobile; otherwise coarse pointer with height below 540 → mobile; otherwise coarse/no-hover → tablet; otherwise → desktop (including pointer-none fallback). Do not classify a device by user-agent name. Re-evaluate on viewport/input changes.

### 3.3 Type roles
Sizes are in CSS px at the default 16 px root; tokens store them in rem.

| Role | Use | Mobile | Tablet | Desktop | Weight | Line height | Numerals |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `hero-temp` | current temperature | clamp(4.5rem, min(20vw, 12svh), 6rem) | clamp(4.5rem, 14svh, 7rem) | clamp(4.5rem, 14svh, 6rem); `wide` 7rem | 300 | 1.0 | tabular |
| `data-xl` | air orb value | 48 | 56 | 48 | 600 | 1.05 | tabular |
| `display` | place name / page title | 24 | 28 | 28 | 700 | 1.25 | — |
| `title-1` | section heading | 20 | 22 | 20 (`wide` 22) | 650 | 1.3 | — |
| `title-2` | card title, list primary line | 17 | 18 | 17 | 600 | 1.35 | — |
| `body` | highlights, summary sentence, prose | 17 | 18 | 16 | 400 | 1.55 | — |
| `data` | hi/lo, detail tile value | 17 | 18 | 16 | 600 | 1.2 | tabular |
| `chart-axis` | hour label (`21시`), weekday, day of month | 16 | 17 | 15 | 500 | 1.2 | tabular |
| `chart-value` | temperatures inside chart dots, daily max/min | 15 | 16 | 15 | 600 | 1.0 | tabular |
| `body-sm` | descriptions, row meta, notices | 15 | 16 | 14 | 400 | 1.5 | — |
| `label` | buttons, tabs, chips, nav, segmented control | 15 | 16 | 14 | 600 | 1.25 | — |
| `caption` | timestamps, sources, units, chart day title, precipitation `%`/`mm` | 13 | 14 | 13 | 500 | 1.35 | tabular |
| `micro` | legend swatch text and axis suffix only; never the only carrier of information | 12 | 12 | 12 | 500 | 1.3 | tabular |

**Hero temperature.**
- The mobile hero reproduces the Cordova rule `min(0.2 × width, height cap)`:

  | Viewport | Hero size |
  | --- | --- |
  | 402×874 | 80.4 |
  | 390×844 | 78 |
  | 375×667 | 75 |
  | 320–360 | 72 (floor; Cordova gave 64 at 320) |

- The `svh` term caps the hero on short viewports.
- The unit mark (°) is 0.45× the hero size and top-aligned.
- The condition icon is 0.9× the hero size, as in Cordova.

**Floors.**
- Information text is at least 13 px. Values, grades, times, warnings and units next to a value all use at least `caption`.
- `micro` (12 px) is limited to legend and axis suffixes.
- Form fields on touch are at least 16 px (already checked by `scripts/web-layout-check.mjs`).

**Numerals.** All data, chart and time text uses `font-variant-numeric: tabular-nums`.

**Line length.** Prose and highlights are capped at 38em.

**Languages.**

| Selector | Rule |
| --- | --- |
| `:lang(ko)` | `word-break: keep-all` with an `overflow-wrap: anywhere` fallback |
| `:lang(ja)` | `line-break: strict`, and the font stack puts Japanese fonts first so Han characters use Japanese glyph forms |
| `:lang(de\|fr\|es\|pt)` | `hyphens: auto` |

Controls wrap rather than truncate. Only place names may end in an ellipsis.

Compact text fallback: at viewport widths up to 480px, use `hyphens: manual` with `overflow-wrap: anywhere` for de/fr/es/pt. The WebKit reference at 320px with 200% text exposed automatic-hyphen glyphs escaping their boxes. Keep role sizes; change wrapping instead of reducing text or hiding overflow.

### 3.4 Font family
The `font.family.sans` stack, in order:
1. "Pretendard Variable"
2. Pretendard
3. -apple-system
4. BlinkMacSystemFont
5. system-ui
6. "Segoe UI"
7. Roboto
8. "Apple SD Gothic Neo"
9. "Noto Sans KR"
10. "Malgun Gothic"
11. sans-serif

Under `:lang(ja)`, "Hiragino Sans", "Noto Sans JP" and "Yu Gothic" come first.

**Decision D1 (AK, 2026-10-01): self-host Pretendard Variable (SIL OFL) on the existing S3 + CloudFront static hosting.**
- **Why:** metrics differ between Apple SD Gothic Neo, Noto Sans KR and Malgun Gothic.
- **Format:** dynamic-subset woff2 with `font-display: swap` and `unicode-range`.
- **Placement:** the files are imported from CSS so that Vite emits them under hashed `assets/`. The existing uploader (`scripts/deploy-web-static.mjs:104-106`) then serves them with `public,max-age=31536000,immutable` and `font/woff2`.
- **Same origin:** the stack CSP's `font-src 'self'` (`infra/web/static/stack.json:132`) already allows this, so there is no CORS or new bucket.
- **Offline:** precache only the Latin and common-Hangul subsets.
- **License:** include the OFL license file.

### 3.5 User text scaling
- **Browser settings.** All type is in rem, so the browser's text size and zoom apply.
- **Required checks.** The layout holds at 200% text (WCAG 1.4.4) and at 320 px width (1.4.10). Charts respond by widening columns and scrolling.
- **Decision D2 (AK, 2026-10-01):** an in-app text size of 90 / 100 / 115 / 130%, applied through `--tw-text-scale`.
  - It is a new optional preference key. When the key is missing, the size is 100%.
  - An older build ignores the key.
  - Apply `max(role floor, role size × setting)` in rem: 13px-equivalent floor for information roles and 12px-equivalent for `micro`, relative to the user's browser root. Thus 90% does not reduce a 13px caption below 13px. Enlarge the root with browser preferences without resetting it in production CSS.
  - Resolve the hero's baseline clamp at the 16px reference root, then express that result in rem and apply the setting. Merely changing clamp bounds does not scale vw/svh preferred values. Charts enlarge columns, dots and plot height with text, while only their internal viewport scrolls.
- **Decision D3 (AK, 2026-10-01): review against the Cordova app, then adjust.**
  - Cordova on Android pins the web view to 100% text zoom (`usePreferredTextZoom(false)`). At a system font scale of 1.3, removing that pin made the chart legend and tab labels overlap (`docs/rewrite/screen-specifications.md:223`). The iOS build does not call the plugin.
  - Before enabling `font: -apple-system-body` (iOS Dynamic Type) or honoring Android font scale, compare the PWA with the Cordova captures at scale 1.0 and 1.3 on iOS and Android.
  - Adopt only if the charts show no overlap. Until then, rely on the browser text size and the D2 setting.

## 4. Color
Contrast figures are WCAG 2.x ratios. The main session computed them, and independent-verification-1 recomputed them. Each role is checked against every surface it may sit on: `bg.canvas`, `bg.surface`, `bg.surface-raised` and `bg.surface-sunken`.

### 4.1 Primitives
| Family | Steps |
| --- | --- |
| **neutral** | 0 `#ffffff`, 50 `#f4f6fa`, 100 `#eef2f7`, 150 `#e3e8ef`, 200 `#c9d2de`, 350 `#94a3b8`, 400 `#808ea3`, 450 `#77859a`, 500 `#637088`, 600 `#56647a`, 800 `#1e2a3d`, 850 `#1a2536`, 875 `#243248`, 900 `#0f1724`, 925 `#131d2c` |
| **blue** | 50 `#eaf1fd`, 300 `#7fb0ff`, 500 `#3981ea` (fills and illustration only), 600 `#2f6fd6`, 700 `#1f5cc2` |
| **brand.sky** | `#03a9f4`, from Cordova TodayWeather. Icon and marketing only; white text on it is 2.63. |
| **brand.air.ink** | `#1e201f`, from TodayAir |

### 4.2 Semantic roles
| Token | Light | Dark | Contrast |
| --- | --- | --- | --- |
| `bg.canvas` / `bg.surface` / `bg.surface-raised` / `bg.surface-sunken` | `#f4f6fa` / `#ffffff` / `#ffffff` + elevation 1 / `#eef2f7` | `#0f1724` / `#1a2536` / `#243248` / `#131d2c` | — |
| `border.subtle` / `border.strong` | `#e3e8ef` / `#c9d2de` | `#2a3a51` / `#3a4b66` | decorative / component boundary |
| `text.primary` | `#1e2a3d` | `#e6edf6` | 14.45 on white / 15.24 canvas, 13.08 surface, 10.96 raised |
| `text.secondary` | `#56647a` | `#a3b1c6` | 6.00 white, 5.55 canvas, 5.34 sunken / 7.09 surface, 5.95 raised |
| `text.tertiary` | `#637088` | `#94a3b8` | 5.00 white, 4.62 canvas; **not on light sunken** (4.44) / 7.01 canvas, 6.01 surface, 5.04 raised, 6.61 sunken |
| `accent.default` (primary button fill, selected indicator) | `#2f6fd6` | `#7fb0ff` | white on it 4.81 / `#0f1724` on it 8.18 |
| `accent.text` (links, selected labels) | `#1f5cc2` | `#7fb0ff` | 6.23 white, 5.76 canvas / 7.02 surface, 5.88 raised, 5.86 on `accent.subtle` |
| `accent.strong` (hover, pressed) | `#1f5cc2` | `#a3c7ff` | white on it 6.23 / 8.94 surface |
| `accent.subtle` | `#eaf1fd` | `#1d3252` | accent text on it 5.49 / 5.86 |
| `focus.ring` (3 px, 2 px offset) | `#2f6fd6` | `#7fb0ff` | 4.81 / 7.02 (non-text, needs ≥ 3) |
| `status.info` text / background | `#1f5cc2` / `#eaf1fd` | `#a3c7ff` / `#1d3252` | 5.49 / 7.47 |
| `status.success` | `#0f6b4a` / `#e6f5ee` | `#6fd3a8` / `#12352a` | 5.79 / 7.37 |
| `status.caution` (advisory, stale data) | `#8a5a00` / `#fff6e0` | `#f2c46b` / `#3a2d10` | 5.51 / 8.24 |
| `status.danger` (warning, destructive) | `#b3261e` / `#fdecea` | `#ff8a80` / `#3d1a1a` | 5.72 / 6.76 |

The generated contrast report must list every token × surface pair. The phase 0 test fails on any pair below its threshold that the token's allowed-surface list does not exclude.

`theme-color` metadata follows `bg.canvas`. The manifest `theme_color` becomes `#f4f6fa`.

### 4.3 Literal-to-token mapping (current PWA → tokens)
| Current literal or rule | Where | Token |
| --- | --- | --- |
| `--bg #f5f7fb`, `--soft #f5f8fc`, `:root background` | `style.css:13-28` | `bg.canvas` |
| `--panel #fff`, `--sidebar #fff` | same | `bg.surface` |
| `--text #28354b`, `:root color` | same | `text.primary` |
| `--muted #7b889e` (39 uses, 3.59:1) | same | `text.secondary` for descriptions, `text.tertiary` for stamps and meta |
| greys `#9aa5b6/#9aa6b7/#99a6b7/#93a0b1/#91a0b1/#8d9bb0/#a8b2bf/#748097` (labels, footers, version, eyebrow) | various | `text.tertiary` (or `text.secondary` for nav) |
| `--line #e9eef4`, `--map-fill #e9f0f6` | `style.css:16-28` | `border.subtle`, `map.fill` (= `bg.surface-sunken`) |
| `--accent #3981ea` and blue variants `#357ddd/#3f80d8/#397bcf/#438ce9/#4087ef/#4c8eff/#235bb0` | `style.css`, `components.tsx:294-350` | `accent.default`, `accent.text`, `accent.strong`, `chart.today` |
| pale blues `#eef4ff/#edf4ff/#f1f6ff/#f1f6fd/#eaf2ff/#eaf4ff/#eff3fb/#eef3fa` | various | `accent.subtle` |
| `--good/--moderate/--poor/--bad` | `style.css:25-28` (unused) | deleted |
| `.grade-4-*`, `.grade-6-*` | `style.css:2088-2121` | `air.<scale>.<n>.fill/text/tint` (§6.1) |
| `#aebdce` yesterday line | `components.tsx:330` | `chart.yesterday.line` |
| focus `#78aaff` | `style.css:76-83` | `focus.ring` |
| hero gradient `#438ce9 → #76b3f4` | `style.css:457` | `sky.<condition>` (§6.4) |
| dark `--bg #111c2b`, `--panel #1b293c`, `--sidebar #172335`, `--text #dce7f4`, `--muted #95a5bc`, `--line #2a3a51`, `--soft #223149` | `style.css:1396-1434` | dark `bg.canvas`, `bg.surface`, `bg.surface-sunken`, `text.primary`, `text.secondary`, `border.subtle`, `bg.surface-raised` |
| `THEME_COLORS` in `App.tsx:104-108` and `public/theme.js:3-8` | — | generated `bg.canvas` per appearance |
| font sizes 8/9/10 | 146 declarations with 23 distinct values | `micro` (axis/legend only), otherwise `caption` |
| font sizes 11/12 | same | `caption` |
| font sizes 13/14 | same | `body-sm` / `label` |
| font sizes 15–18 | same | `title-2` / `body` / `data` |
| font sizes 19–33 | same | `title-1` / `display` |
| font sizes 38–78 | same | `data-xl` / `hero-temp` |
| radii 3–18 | — | §7 radius scale |
| shadows `#4083d540`, `#1d2f4b22` | — | elevation 1–2 |
| z-index 25/30/100/200 | — | named layers (§7) |

### 4.4 Appearance, theme and rollback compatibility
**New preferences** (stored under a separate localStorage key, `tw.web.v1.display`, so the current `loadState` in older builds cannot erase them).
- `appearance`: `system` (the default for new users) | `light` | `dark`
- `heroStyle`: `sky` (default) | `plain` | `photo` | `classic`

**Legacy `settings.theme` → new values.**

| Legacy `theme` | `appearance` | `heroStyle` |
| --- | --- | --- |
| `light` | light | sky |
| `dark` | dark | sky |
| `photo` | light | photo |
| `classic` | light | classic |

**Dual-write for rollback.** Each save also writes the nearest legacy `theme`:
- `dark` appearance → `dark`
- light or system with `photo` → `photo`
- light or system with `classic` → `classic`
- otherwise → `light`

An older build that rebuilds `settings` (`web/src/state.ts:95-115`) still gets a valid theme. The separate display key survives the rollback and restores the new values on re-upgrade. A rollback test covers this.

**`theme.js`.** It gains the `system` path: resolve `prefers-color-scheme` before first paint.

**Classic hero.** Uses `#0277bd` with white text (4.80).

## 5. Core charts (AC3, AC4; the most important content)
Both charts keep the Cordova information model and reading order. The design system changes their typography, color, geometry and accessibility, not what they show.

### 5.1 Hourly chart
**Source model.** Cordova `ng-short-chart` (`client/www/js/app.js:446-942`, bindings in `docs/rewrite/screen-element-bindings.md:80-97`). The PWA `TemperatureChart` is `web/src/components.tsx:223-411`.

**Anatomy, top to bottom, sharing one column grid:**
1. **Day title.** For example `오늘 09.27` / `Today 09/27`. Role `caption`, weight 600. It appears at the first column of each date. A midnight guide line (`chart.grid.strong`) runs through the whole chart.
2. **Hour label.** For example `21시` / `9 PM`. Role `chart-axis`. It is formatted by the locale; the width estimate already exists in `components.tsx:220-221`.
3. **Sky icon.** Size 1.75em of `chart-axis` (28 px on mobile). The day or night variant comes from the data.
4. **Precipitation.** The probability is always printed, including `0%`, as in Cordova (`caption`, value plus `%`). At 30% or more it is colored `precip.text`, and at 60% or more the drop icon is filled. An amount (the first truthy of `rn1`/`s06`/`r06`, rounded when it is 10 or more) goes on a second `caption` line when present.

   Cordova column rules that are kept:
   - Column 0 draws no icon or precipitation.
   - A day title is not drawn in the last two columns.
   - Every column has a faint guide line (`chart.grid`), and midnight uses `chart.grid.strong`.
5. **Temperature plot.** One y scale shared by today, yesterday and the current temperature, padded to whole degrees (Cordova `.nice()`):

   | Element | Line | Dot / marker | Value text |
   | --- | --- | --- | --- |
   | Today | `chart.today` line, 2.5 px | Dots at least 1.6em of `chart-value` (24 px on mobile), filled `chart.today`; expand to fit negative/two-digit values with padding, enlarging columns if needed | `chart-value` in `chart.today.on` (white 4.81 / ink 8.18 dark) |
   | Yesterday | `chart.yesterday.line`, 1.5 px, dashed "4 4" | Dots filled `chart.yesterday.dot` (`#637088` / `#8391a8`) | White 5.00 / ink 5.63 |
   | Now | Between 3-hour columns, both lines are spliced through the current observation (today `t1h`, yesterday's value at the same time). When the current time falls on a 3-hour column, there is no splice. This follows Cordova's `sharp` rule (`client/www/js/app.js:547-551`, `706-721`, `748-871`) | `chart.now` point **on the today line at `t1h`** (`#e5484d` light 3.62 on canvas / `#ff6b70` dark 4.67 on raised). A `chart.yesterday.dot` point marks yesterday at the same time. Between columns: a 0.5em point placed half a column after `currentIndex`. On a 3-hour column: a full-size dot | On a 3-hour column: `chart-value` inside the dot. Otherwise the value appears in the column-cursor announcement and tooltip |

   **Overlap rule.** When today's and yesterday's dots in a column would overlap vertically (less than 1 dot apart), yesterday's value text is hidden and its dot shrinks to 8 px. Today's value always wins. This fixes the Cordova overlap visible in `docs/rewrite/screenshots/native-ios-hourly.png`.
6. **Details rows (expander).** Wind direction arrow rotated by `vec`, wind speed plus unit, and humidity %. All use `caption`. The expanded state persists in a new preference, mirroring Cordova's `expandShortChart`. This needs `vec` mapped into `packages/weather-core` (currently unmapped).

**Chart color tokens.** Line and fill colors are non-text and need at least 3:1. Dot text needs at least 4.5.

| Token | Light | Dark | Contrast |
| --- | --- | --- | --- |
| `chart.today` (line, dots) | `#2f6fd6` | `#7fb0ff` | 4.81 white / 7.02 surface, 5.88 raised |
| `chart.range.cool` → `chart.range.warm` (daily bars, D8) | `#9bcdf0` → `#f0c77f` + `chart.range.edge` | same | 1.70 / 1.59 white (values printed as text) / 9.09 / 9.68 surface |
| `chart.today.on` (dot text) | `#ffffff` | `#0f1724` | 4.81 / 8.18 |
| `chart.yesterday.line` | `#77859a` | `#8391a8` | 3.75 white, 3.46 canvas, 3.33 sunken / 4.83 surface, 4.05 raised |
| `chart.yesterday.dot` + text | `#637088` + white | `#8391a8` + `#0f1724` | dot 5.00 white; text 5.00 / text 5.63 |
| `chart.now` | `#e5484d` | `#ff6b70` | 3.91 white, 3.62 canvas / 5.57 surface, 4.67 raised |
| `chart.grid` / `chart.grid.strong` | `#e3e8ef` / `#c9d2de` | `#2a3a51` / `#3a4b66` | decorative; the meaning is carried by the day title |
| `precip.text` | `#1f5cc2` | `#7fb0ff` | 6.23 white / 7.02 surface |

**Legend.**
- Placement: in the card header, as swatch plus `micro`/`caption` text, never over the plot. The Cordova legend covered data points.
- Text: the existing keys `LOC_THIS_DAY_TEMP` / `LOC_PREVIOUS_DAY_TEMP` (당일 기온 / 전일 기온).
- If yesterday's series is missing, its legend entry and line are omitted.

**Geometry per tier.** Column widths are rem-based, so larger text widens columns.

| | Mobile | Tablet | Desktop |
| --- | --- | --- | --- |
| Column width | clamp(3.25rem, 100vw / 7, 4rem): 57 px at 402, continuing Cordova `min(width/7, 60)` | 4.5rem (72 px) | 4rem (64 px) |
| Plot height | 11rem | 14rem | 13rem |
| Visible columns | ≈7 | ≈10–16 | ≈14 in the main column |

**Scroll.**
- Horizontal scrolling happens inside the chart only.
- The initial position is the column before the current time, as in Cordova.
- The data span matches the service's 3-hour rows. The PWA's 16-point cap is lifted to the full series.
- Hour-by-hour rows, where present, keep time-proportional x as the PWA does now.

**Interaction and accessibility.**
- The chart is a focusable `role="group"` with a summary label.
- Arrow keys move a column cursor, which announces time, today's value, yesterday's value and precipitation. Hover shows the same values in a tooltip, on fine pointers only.
- A `<details>` table alternative stays, as in the current PWA.
- Under `forced-colors`, lines use `CanvasText` and dots get outlines.

**States.**
- Loading: a skeleton with the column grid.
- No data: EmptyState.
- A `null` value breaks the line (current PWA behavior).
- Stale data: a `status.caution` stamp next to the publication time.

### 5.2 Daily chart
**Source model.** Cordova `ng-mid-chart` (`app.js:1144-1550`, bindings `screen-element-bindings.md:160-175`).

**Default view.** The Cordova daily chart replaces the PWA's current horizontal-row list (`web/src/Weather.tsx:625-670`) as the default daily view on every tier. The list becomes the table alternative.

**Anatomy, one column per day, including past days the service returns:**
1. **Weekday.** `chart-axis`, weight 600. Today's column gets an `accent.subtle` background and a small `caption` "Today" tag **above** the weekday, without replacing it. This is a new addition. Cordova's `current-rect` is transparent (`client/scss/ionic.app.scss:524`), except in the old theme, which fills it (`:832`, `:937`).
2. **Day of month.** `chart-axis`.
3. **AM and PM sky icons.** Shown as one icon when they are equal or PM is missing. Size 1.75em of `chart-axis`.
4. **Precipitation.** Probability for today and later (Cordova rule: shown when `fromToday >= 0` and truthy), plus an amount when present. Uses `caption` and the same color rules as the hourly chart.
5. **Min–max bars on one y scale shared by all days.** This scale is what makes week-to-week change visible, and it is the Cordova signature.
   - **Bar (D8).** Width 0.375rem (6 px, rounded caps); Cordova used 2 px. The fill is the PWA daily list's temperature gradient (`web/src/style.css:1058`) turned vertical:
     - bottom (min) `chart.range.cool` `#9bcdf0`
     - top (max) `chart.range.warm` `#f0c77f`
     - The same gradient is used in dark mode, where it reaches 7.62–9.68 on surface and raised.
     - In light mode the stops are 1.70 and 1.59 on white. The printed min/max values carry the information, and a 1 px inset outline `chart.range.edge` (`rgb(30 42 61 / 22%)`) keeps the bar shape visible.
   - **Values.** The maximum sits above the bar and the minimum below it, each as `N°` in `chart-value`.
   - **Current temperature.** A `chart.now` dot on today's bar.
   - **Past days** (new addition; Cordova does not distinguish them). Bars keep the D8 gradient at 55% opacity, and labels use `text.secondary`, which is the non-color cue.
   - **Y domain** (deviation from Cordova, which uses only `tmn`/`tmx`, `app.js:1197-1204`). The domain includes the current temperature, so today's dot can never fall off the scale.

**Geometry.**
- Column width is the same as the hourly chart. The chart fills the card width when the days fit.
- Initial scroll:
  - When the days do not fit, today is the third column (Cordova rule below 640 px).
  - When they fit (tablet and desktop in most cases), there is no scroll and the chart starts at the first day (Cordova behavior at 640 px and wider).

**Interaction, accessibility and states.** Same as the hourly chart. The announcement is "Sat 26: AM cloudy, PM sunny, 30%, low 18°, high 27°".

### 5.3 Placement per tier
| Tier | Placement |
| --- | --- |
| Mobile | Hero → hourly chart card → daily chart card → air summary → details. This is the Cordova order with daily visible without a tab switch. The bottom nav Hourly/Daily items scroll to and focus the chart. |
| Tablet | Hero with highlights beside it, then full-width hourly and daily charts, then an air and details grid. |
| Desktop | Main column: hero, hourly chart, daily chart. Right column: air, warnings and details. The charts always get the widest column. |

### 5.4 Optional reference-inspired additions (never replacing the charts)
- **MetricSwitcher: not adopted (D7, AK 2026-10-01).** This is the iOS 27-style Conditions / Precipitation / Wind switch. The Cordova chart and its wind/humidity expander stay as they are.
- **Highlights** (§8) sit above the charts, not inside them.

## 6. Other weather visualization (AC3)
Every colored encoding carries a label, a value or a distinct shape. `fill` values are non-text colors and must reach 3:1 when they are the only boundary. Text uses the `text.*` variants.

### 6.1 Air quality grades
The hues continue `aqiStandard` (`client/www/js/service.weatherutil.js:1017-1110`, `web/src/air.ts`). Each grade has these tokens:
- `fill`: the orb ring, bars and map stroke
- `text.light`: at least 4.5 on white and canvas
- `text.dark`: at least 4.5 on dark surface and raised
- `tint`: a 12% mix
- `edge`: a 1 px outline for bars, map regions and the orb ring, equal to `text.light` (light mode) or `text.dark` (dark mode)

Several hues are below 3:1 as fills: on white `#d2d211` 1.62, `#fd9b5a` 2.10, `#00c73c` 2.27; on dark surface `#b4004b` 2.23 and `#940021` 1.68. A fill is therefore **never** the only boundary. It always has its `edge` outline (at least 4.5), plus the value or grade text or the table alternative.

**KR 4-grade** (`airkorea`, `airkorea_who`):

| Grade | fill | text.light | text.dark |
| --- | --- | --- | --- |
| 1 좋음 | `#32a1ff` | `#0a6fc2` (5.17 white, 4.77 canvas) | `#32a1ff` (5.64 surface, 4.73 raised) |
| 2 보통 | `#00c73c` | `#0a7f2e` (5.14, 4.75) | `#00c73c` (6.78, 5.68) |
| 3 나쁨 | `#fd9b5a` | `#b4531a` (5.01, 4.63) | `#fd9b5a` (7.35, 6.16) |
| 4 매우나쁨 | `#ff5959` | `#c62c33` (5.51) | `#ff7a7a` (6.11, 5.12) |

**6-grade** (`airnow`, `aqicn`):

| Grade | fill | text.light | text.dark |
| --- | --- | --- | --- |
| 1 | `#00c73c` | `#007a29` (5.50, 5.09) | `#00c73c` (6.78, 5.68) |
| 2 | `#d2d211` | `#6b6b00` (5.63, 5.21) | `#d2d211` (9.52, 7.98) |
| 3 | `#ff6f00` | `#b34d00` (5.28) | `#ff6f00` (5.53, 4.63) |
| 4 | `#ff0000` | `#cc0000` (5.89) | `#ff7a7a` (6.11, 5.12) |
| 5 | `#b4004b` | `#b4004b` (6.90) | `#f28bb8` (6.73, 5.64) |
| 6 | `#940021` | `#940021` (9.21) | `#f58da0` (6.76, 5.66) |

- **Decision D4 (AK, 2026-10-01):** keep the legacy 6-grade hues, which are not the official US EPA purple/maroon, until the widgets are updated.
- **Faces.** Cordova's sentiment faces become outline icons next to the grade label.
- **Grade ruler.** Thresholds are printed on each segment.
- **Widgets.** iOS widget colors diverge (`tw.ios/widget/TodayWeatherShowMore.m:398-437`) and are aligned only in plan phase 7.

### 6.2 Precipitation, wind, UV and warnings
**Precipitation amount** follows the KMA intensity bands, in mm/h. These are non-text bars, and the value is always printed.

| Band | mm/h | Color |
| --- | --- | --- |
| weak | < 3 | `#9cc9f5` |
| moderate | 3–15 | `#4f9be8` |
| strong | 15–30 | `#2566c8` |
| very strong | ≥ 30 | `#5b3cc4` |

`precip.text` is `#1f5cc2` (6.23 on white).

**Wind** uses the KMA description bands, in m/s. Direction is shown as an arrow rotated by `vec`, with a compass label.

| Band | m/s | Color |
| --- | --- | --- |
| calm | < 4 | neutral |
| somewhat strong | 4–9 | `status.info` |
| strong | 9–14 | `status.caution` |
| very strong | ≥ 14 | `status.danger` |

**UV** uses the WHO categories. The label and index are always shown as text.

| Category | Index | Color |
| --- | --- | --- |
| low | 0–2 | `#3ca55c` |
| moderate | 3–5 | `#e8b21a` |
| high | 6–7 | `#f07b1a` |
| very high | 8–10 | `#d93a3a` |
| extreme | ≥ 11 | `#8e44ad` |

**Warnings (KMA 특보).** Each warning shows its level word, issue time and source.

| Level | Style |
| --- | --- |
| preliminary | neutral outline |
| 주의보 | `status.caution` with a 3 px leading border |
| 경보 | `status.danger` with a 3 px leading border and an icon |

**Temperature numbers.** Highs and lows are always text. The daily bars use the D8 gradient (§5.2).

### 6.3 Condition signal
`iconKind` (`web/src/format.ts:76-96`) gains two kinds:
- `fog`: when the API icon name contains `fog`, matching the Cordova `_fog` assets.
- `dust`: when the current PM10 grade is 3 or higher on the KR scale, or the service's yellow-dust field is set.

Until then, both fall back to `cloudy`.

### 6.4 Sky surfaces (hero background)
The hero background is chosen by condition and day/night. Text contrast is at least 4.5 at both gradient stops.

| Sky | Top → bottom | Text | Worst stop |
| --- | --- | --- | --- |
| clear/partly, day | `#2b5ea8` → `#3a74bf` | white | 4.74 |
| clear/partly, night | `#1d2b4a` → `#2c3d63` | white | 10.74 |
| cloudy | `#55657a` → `#647488` | white | 4.78 |
| rain | `#4b5d73` → `#5d6f86` | white | 5.14 |
| snow | `#cfdcec` → `#e8eef6` | `#1e2a3d` | 10.39 |
| thunder | `#3a4252` → `#4b5468` | white | 7.59 |
| fog, dust | `#d9d4c7` → `#ebe7dc` | `#1e2a3d` | 9.76 |

**Layout.**
- Mobile: the hero fades into `bg.canvas` over 48 px.
- Tablet and desktop: the hero is a card. An optional 10–14% edge tint follows the soft edge gradients reported for One UI 8.5.

**Photo mode.** A scrim of at least 40% black, plus a rendered-text contrast check.

**Ambient motion.** Opt-in and CSS-only. It pauses when hidden and is removed under reduced motion.

## 7. Space, shape, elevation, motion, layers
**Space** is in rem on a 4 px grid:

| Token | 0 | 0.5 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| px | 0 | 2 | 4 | 8 | 12 | 16 | 20 | 24 | 32 | 40 | 48 | 64 |

**Layout spacing per tier:**

| | Mobile | Tablet | Desktop |
| --- | --- | --- | --- |
| Page margin | 16 | 24 | 32 |
| Card padding | 16 | 20 | 24 |
| Card gap | 12 | 16 | 20 |

**Grid.** 4 columns on mobile, 8 on tablet, 12 on desktop, with a 1440 px maximum.

**Radius.**

| Token | px | Used for |
| --- | --- | --- |
| `sm` | 8 | chip |
| `md` | 12 | button, input, tile |
| `lg` | 16 | card |
| `xl` | 24 | hero, sheet |
| `full` | — | pill, orb |

**Elevation in light mode.**

| Level | Used for | Shadow |
| --- | --- | --- |
| 0 | flat surfaces, with a border | none |
| 1 | cards | `0 1px 2px rgb(16 24 40/6%), 0 1px 3px rgb(16 24 40/8%)` |
| 2 | popovers, toasts | `0 8px 24px rgb(16 24 40/14%)` |
| 3 | sheets | `0 16px 40px rgb(16 24 40/18%)` |

Dark mode uses surface steps instead of shadows.

**Motion.**
- Durations: `fast` 120 ms, `base` 200 ms, `slow` 320 ms.
- Easing: `standard` cubic-bezier(.2,0,0,1), `exit` cubic-bezier(.3,0,1,1).
- Reduced motion keeps opacity changes of 120 ms or less.

**Layers** (z-index): `nav` 30, `scrim` 40, `sheet` 50, `toast` 60, `skip-link` 70.

## 8. Components (AC4)
All components cover these states: default, hover (fine pointer only), pressed, focus-visible, selected, disabled, loading, error and stale. They use only semantic or component tokens.

| Component | Anatomy and behavior | Reference / continuity |
| --- | --- | --- |
| **HourlyChart** | §5.1 | Cordova `ng-short-chart` |
| **DailyChart** | §5.2 | Cordova `ng-mid-chart` |
| AppShell / Navigation | Bottom nav (Hourly, Daily, Air, Locations, More), rail or sidebar by width. The active item uses `accent.subtle` plus weight. | Specification IA; Cordova tab bar |
| TopBar | Place name (`display`), search, refresh, share, publication stamp (`caption`) | Cordova header |
| HeroNow | `hero-temp`, condition icon, condition word, "어제보다 ±n°" (`body`, delta in weight 600), hi/lo (`data`), air chip | Cordova hero |
| HighlightsCard | 1–3 sentences from existing `summaryWeather`/`summaryAir`, plus derived facts (rain start hour, the largest difference from yesterday, air grade change). No new API. | iOS 27 Highlights (§11) |
| AirSummary | AirOrb (`data-xl` + grade label + face), pollutant grid, grade ruler, hourly bars **with a table alternative** (currently missing) | Cordova air tab |
| DetailTile | Title (`caption`), value (`data`), a plain-language line (`body-sm`) for UV, feels-like, humidity, wind, sunrise/sunset and discomfort (`dspls`) | Plain-language descriptions reported for Samsung Weather (§11) |
| LifeIndex (D5) | Activity chips derived only from available index data. Currently only UV (`LivingWthrIdxServiceV5`) is collected. The food-poisoning endpoint answered 503 on 2026-09-26, and no activity data exists. The missing data is tracked in #2650, and nothing is shown until it exists. | Samsung life forecast (§11) |
| WarningBanner | Level word, title, time, source; expandable | KMA 특보 |
| Notice / Toast | Notices use status tokens with `role=status`. Toasts use elevation 2 and a polite live region. | existing |
| Skeleton | Matches the shapes of the hero and chart grid. Shimmer is off under reduced motion. | new |
| EmptyState / ErrorState | Icon, `title-2`, `body-sm`, Retry | existing |
| Button | primary / secondary / ghost / icon / danger. Height 44 on coarse pointers, 36 on fine pointers (hit area ≥ 24). | — |
| Chip / GradeChip | `label` role, radius full, a border under forced colors | three current chip styles merged |
| Tabs / SegmentedControl | `role="tablist"` when switching panels; otherwise a radio group | replaces `aria-pressed` tabs |
| ListRow | Leading icon, `title-2`, `body-sm`, trailing value; at least 48 px tall | — |
| Sheet / Dialog | Replaces `window.confirm` (`App.tsx:1316,1349`). Traps focus and restores it on close. | new |
| SearchField | Text at least 16 px on touch, a clear button, a results list | existing |
| NationMap | Grade fill plus labels, a list alternative, `role="img"` plus a summary | existing |

## 9. Accessibility and internationalization (AC5)
- **Contrast.** WCAG 2.2 AA: text ≥ 4.5 and non-text ≥ 3 on every allowed surface. Focus is visible and not obscured.
- **Targets.** 44×44 on coarse pointers and ≥ 24×24 elsewhere. This includes city chips, saved-city buttons, chart `summary` and text links.
- **Resize and reflow.** Nothing is lost at 200% text or at 320 px width. Horizontal scroll is allowed only inside the charts.
- **User preferences.** `forced-colors`, `prefers-reduced-motion` and `prefers-color-scheme` (when set to system) are honored.
- **Charts** follow §5.1: they are keyboard-navigable and have table alternatives.
- **Languages.** The seven languages follow the §3.3 language rules, with a +35% text-length budget for de/fr. The manifest either gets localized names at build time or keeps the Korean name plus an English `short_name`; the plan chooses.

## 10. Delivery and verification (AC6, AC7)
**Flow.** See `docs/design-system/diagrams/token-pipeline.html`:

DTCG JSON → zero-dependency generator (Vitest-tested) → CSS/TS/contrast report → PWA stylesheet and charts, with optional native constants later.

**Verification layers.**
1. **Token tests.**
   - Every token × allowed-surface pair meets its threshold in both appearances.
   - Every type role has all three tiers.
   - The 12 px and 13 px floors hold.
   - Output is deterministic.
   - The preference mapping and dual-write round-trip correctly.
2. **Lint test.** Fails on new hex literals or px `font-size`/`fontSize` in `web/src` outside generated files.
3. **Layout matrix.** `scripts/web-layout-check.mjs` is extended with:
   - `--text-scale 1,1.5,2` and `--appearance light,dark`
   - reduced-motion emulation
   - tier assertions: computed `body` of 17 px at 402×874, 18 px at 820×1180 (touch), 16 px at 1440×900 and at 800×465 (fine)
   - `mobile` values at 874×402 (touch)
   - chart assertions: no overlapping value labels, the legend outside the plot, the initial scroll position, and that the daily chart fills the card when days fit
4. **Visual regression.** Playwright `toHaveScreenshot` in Chromium:
   - Views: hero plus charts, air, settings.
   - Sizes: 402×874, 820×1180, 1440×900.
   - Languages ko and de; light and dark.
   - Baselines are captured on the current base first, so intended diffs are visible.
5. **axe-core** scans (`@axe-core/playwright`, a new pinned dev dependency).
6. **AK visual review** per phase, with priority on the two charts, compared side by side with the Cordova screenshots in `docs/rewrite/screenshots/`.

## 11. Reference patterns and sources
The reference apps are described only from public reporting. No device was inspected.

- **iOS 27 Weather.**
  - A Highlights summary at the top.
  - Conditions / Precipitation / Wind views that switch both the hourly and 10-day forecasts.
  - An extra-large widget and landscape layout.
  - Sources: [MacRumors](https://www.macrumors.com/guide/ios-27-weather/), [9to5Mac](https://9to5mac.com/2026/09/16/apple-weather-adds-two-convenient-new-features-in-ios-27/).
- **Samsung Weather (One UI 7–8.5).**
  - Readable descriptions for UV, humidity and wind, and an activity "life forecast". Source: [Android Police](https://www.androidpolice.com/one-ui-7-weather-update/).
  - Realistic animated backgrounds. Source: [SammyGuru](https://sammyguru.com/samsung-one-ui-8-weather-app-to-get-a-stunning-visual-makeover/).
  - Soft edge gradients, reported as a leak before release. Source: [Sammy Fans](https://www.sammyfans.com/2025/10/01/one-ui-8-5-to-refresh-samsung-weather-app-with-subtle-gradient-design/).
- **Samsung device (D6).** AK chose the Galaxy S26 with One UI 8.5 ([Wikipedia](https://en.wikipedia.org/wiki/Samsung_Galaxy_S26)).

## 12. Alternatives considered
- **Utility framework (Tailwind) rewrite.** Rejected. It produces no multi-platform tokens and rewrites 2239 lines of CSS.
- **Material Web / Ionic / Apple-like kits.** Rejected. They impose a foreign identity.
- **Style Dictionary now.** Deferred until native output is authorized. Tier and appearance selectors need custom formats either way.
- **Fluid type on every role.** Rejected. Sizes become unpredictable across 40 reference viewports. Only the hero is fluid.
- **Width-only type tiers.** Rejected after verification. A narrowing desktop window would get *larger* text, and landscape phones would get tablet text.
- **iOS-style horizontal daily range list as the default.** Rejected. It drops the shared vertical scale, past days, the current marker and the column reading order that AK named as core. It stays as the table/list alternative.
- **Blue Cordova bar or a per-degree temperature ramp.** Replaced by D8, the PWA's cool→warm gradient on the Cordova shared-scale bar.

## 13. Risks
| Risk | Mitigation |
| --- | --- |
| Visual regressions across all views | Phased PRs and baselines captured before each change |
| Larger type wrapping in de/fr | Text-scale matrix |
| Pointer misdetection | Device check; desktop type is still readable |
| Font download cost (D1) | Subsetting |
| Theme preference rollback | Dual-write plus test |
| Sky or photo contrast | Fixed tested stops plus a scrim |
| Chart re-implementation changing data semantics (today/yesterday alignment, current index, past-day handling) | Unit tests on the chart data derivation against the rewrite fixtures (`docs/rewrite/examples/`), plus the Cordova screenshots as the visual oracle |

## 14. Decisions (AK, 2026-10-01)
| ID | Decision |
| --- | --- |
| D1 | Self-host Pretendard Variable on the existing S3 + CloudFront, as hashed Vite assets |
| D2 | In-app text size 90/100/115/130% |
| D3 | Review Dynamic Type and Android font scale against the Cordova app at 1.0/1.3, then adjust |
| D4 | Keep the legacy 6-grade AQI hues |
| D5 | LifeIndex only from available data; missing life-index data tracked in #2650 |
| D6 | Samsung reference: Galaxy S26 (One UI 8.5) |
| D7 | No MetricSwitcher; keep the Cordova chart and expander |
| D8 | The daily chart bars use the PWA daily list gradient `#9bcdf0` → `#f0c77f` (min → max) |
