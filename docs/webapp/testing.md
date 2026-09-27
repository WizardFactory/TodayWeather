# Web app test guide

How to check the static web PWA (`web/`) before a pull request or a release. Run every command from the repository root after `npm ci`. Record which checks actually ran; a check that could not run (missing browser, credential or network) is "not run", not "passed".

## 1. Build, types and unit tests

```bash
npm run typecheck
npm test                 # Vitest: web/test, packages/weather-core
npm run build:web        # web/dist, including the service-worker precache list
```

`web/test/i18n.test.ts` fails when a catalog in `web/src/i18n/` misses a key, changes a `{placeholder}` or keeps Korean text; `web/test/locale.test.ts` pins the country unit table and the regional date/number rules.

## 2. Browser tests

```bash
npm run test:e2e         # Playwright on the static preview with the production CSP
```

- The suite runs Chromium with the browser language pinned to `ko-KR` (`playwright.config.ts`). Specs that test another language set their own `locale` (`web/e2e/i18n.spec.ts`).
- `web/e2e/global-setup.ts` stops the run when `web/dist` is older than its sources; rebuild first.
- Fixtures (`web/e2e/fixtures.ts`) answer the public API and abort anything unrouted; the response echoes the requested air standard.
- Phone-layout regressions live in `web/e2e/mobile.spec.ts` (320 px); long translations in `web/e2e/i18n.spec.ts`.

## 3. Layout check

Run it for any change that affects layout, CSS, text or translations:

```bash
npx playwright install chromium webkit msedge   # once; msedge installs Microsoft Edge
npm run build:web
npm run test:layout -- --json layout.json
```

| Class   | Sizes (CSS px)                                                                                                                             | Browsers                           |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Phone   | the top-10 iPhone and top-10 Android sizes in the [specification](specification.md#supported-languages-and-screen-sizes) (320–440 px wide) | Chrome (Chromium), Safari (WebKit) |
| Tablet  | the top-10 tablet sizes (753–1334 px wide)                                                                                                 | Chrome, Safari                     |
| Desktop | the top-10 desktop screens (800–3440 px wide; viewport about 135 px shorter than the screen)                                               | Chrome, Safari, Edge               |

Every size runs in all UI languages (`ko`, `en`, `es`, `ja`, `de`, `pt`, `fr`) on ten views (hourly, daily, air, overview, locations, nationwide weather and air, warnings, settings, help), in the light theme, and in the dark theme for the hourly, air, nationwide-air and settings views in Korean and German. The script fails on:

- horizontal page overflow;
- text wider or taller than its box (ellipsis is allowed only for place names: the address line, the weather heading and the station picker);
- weather actions wrapping to a second row;
- on phones and tablets, form text under 16 px (iOS zooms into it) and icon targets under 44 px.

Options: `--classes phone,tablet,desktop`, `--langs ko,de`, `--workers 8`, `--shots <dir>` (screenshots of the hourly, air and settings views), `--base <url>` (an already running site). It blocks service workers so the fixtures answer every request (Playwright WebKit bypasses page routes for pages a service worker controls) and pins the clock to the fixture date.

After an automated pass, review screenshots side by side (one image per view with all languages or sizes) for problems a measurement cannot see: overlapping chart labels, awkward line breaks, unreadable colours.

## 4. Live smoke

```bash
node scripts/web-live-smoke.mjs --json smoke.json
```

Checks the current build on a local preview against the real public API (read-only GETs) in `ko-KR`. Known upstream warnings are listed in the script; a new warning needs triage. Runbook: [static deployment](../../infra/web/static/README.md#live-smoke).

## 5. Not covered by automation

Real iPhones, Android phones and tablets, home-screen installs, notch safe areas, Firefox, native-speaker review of the translations ([open choices](implementation.md#translation-review)) and server-provided text in other languages (backend). Record them as not verified unless checked manually.
