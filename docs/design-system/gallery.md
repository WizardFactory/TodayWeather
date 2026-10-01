# Chart and component reference gallery

Status: implemented standalone reference, 2026-10-01. Owner: TodayWeather design/frontend owner. Related: #2651 shared creation; #2649 production integration. Run `npm ci --ignore-scripts` then `npm run gallery` and open the printed loopback URL. The [reference entry](references/gallery.html) requires this server because it consumes generated modules. The server serves only design-reference assets and generated tokens, rejects resolved-path traversal and never starts weather collectors. `DESIGN_GALLERY_PORT` selects a local port (default4175).

## Chart contract

The [model](references/chart-model.js) consumes normalized data described in [fixtures](references/fixtures.js), not raw API responses. Explicit-offset ISO timestamps, finite numbers or null; daily ISO dates, low≤high when both exist. Invalid times/numbers, duplicate columns and inverted ranges reject. Korea example comparison offset is24h; DST/other-local-midnight/provider sentinel conversion belongs in a production adapter. Sorted hourly rows align yesterday by timestamp, not array position. Null temperatures break paths. The in-range current observation joins today's line and both shared domains; out-of-range hourly observations are omitted. Daily current temperature is shown only when today's date exists. Missing ranges show a dash and no invented bar.

Hourly order: date/time → icon/condition → probability including0 → amount including0 → today/yesterday lines with values → wind/direction/humidity expander. Near yesterday circles are suppressed while separated circles remain; today's values are never suppressed. The current point uses its exact timestamp/temperature. Daily order: past/today/weekday/date → AM/PM icons (merged when identical/missingPM) → probability only for nonpast truthy values → amount → vertical ranges and extrema on one domain. D8 cool minimum at bottom, warm maximum at top; prior dates have reduced fill opacity plus “past” text. Meaningful bar edges retain3:1 contrast. The current observation participates in the scale even outside today's forecast range.

Each chart scrolls internally. Hourly x positions are time-proportional; daily columns stretch when they fit. Initial daily overflow puts today third; hourly starts before the current timestamp. The group receives keyboard focus: Left/Right move one forecast column, Home/End first/last. The live readout announces timestamp, conditions and measurements. Fine-pointer hover/click selects the same cursor. Tables are derived from the same model, with headers and observation caption; no separate hard-coded table values. Forecast rows and current observation are distinguished.

State control demonstrates ready/loading/empty/error/stale. Reference loading and errors are manually selected examples, not network state machines. AM/PM, amounts and negative/missing values are fixed stress data. Production data conversion/storage/refresh/error retries are not implemented here.

## Components and interaction

Gallery includes primary/secondary/ghost/danger/disabled/busy buttons; search input with labelled help and validation error; arrow-key tabs; data/grade cards; session-only theme/language/text settings; native modal dialog with initial focus, Escape and restoration; loading, empty, error and stale cards. No metric switching. Native controls maintain names/roles, keyboard operation, focus rings, coarse44px targets and fine36px controls. Reduced motion removes animation; forced colors preserves chart boundaries and text. ko/de controls demonstrate wrapping, not complete product localization. Full Pretendard is local and licensed.

```sh
npm run test:design
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/todayweather-design-browsers npx playwright install chromium webkit
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/todayweather-design-browsers node scripts/verification/design-gallery-check.mjs
```

The independent integrated browser check serves actual generated output, blocks external requests, exercises controls/chart-table equality/keyboard/modal/settings/states, checks dimensions/font/tier, and runs pinned axe. Core402×874/820×1180/1440×900 plus320px, ko/de, light/dark,100/130% and16/32px root. Each engine also checks system appearance under OS dark at all four viewports and 48 generated-CSS contexts (OS light/dark × unset/system/explicit light/explicit dark × six profiles). Compact coarse+hover uses explicitly synthesized CSSOM input-capability media features; viewport dimensions and computed cascade remain real. The earlier typography checker additionally covers90/115% and tier boundaries. Results stay under reports; selected dated captures and essential results are retained before push. Root doubling simulates text preferences, not physical-device zoom. D3 real iOS/Android comparison, iPad trackpad behavior, actual production API fixtures and full seven-language integration remain deferred.

[Selected creation evidence and source identities](../evidence/2026-10-01-design-system/README.md) retain the measured outcomes; fresh independent/PR execution is tied to the later exact PR head.
