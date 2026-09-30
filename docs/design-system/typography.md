# Responsive typography reference

Status: implemented isolated reference for [#2651](https://github.com/WizardFactory/TodayWeather/issues/2651), reviewed 2026-10-01 at current base `6ec6c68c` after master pull. Maintainer role: design/frontend owner. Normative roles and values: [spec §3](../../specs/design-system.md#3-typography-ac2-first-priority). Production adoption remains [#2649](https://github.com/WizardFactory/TodayWeather/issues/2649).

## What to inspect

Open the [interactive reference](references/typography.html). It contains a current-weather hero, hourly today/yesterday plot, shared-axis daily bars, wind/humidity expander, tables, and examples of every type role. Controls choose ko/de, light/dark, 90/100/115/130% and a 16/32px browser root. Weather values are fixed typography stress data, including negative temperatures; they are not a real location/provider response. The hour/day chronology and current marker are illustrative, not a production data adapter.

- **Reading hierarchy:** current temperature → place/condition → hourly/daily headings → time/day labels → temperatures → precipitation/units. The charts remain primary content after the hero.
- **Tier baselines:** body 17/18/16, chart axis 16/17/15, chart value 15/16/15px (mobile/tablet/desktop). The full role, weight and line-height table remains in the spec; verifier reads it directly.
- **Tier precedence:** width <768 → mobile; otherwise coarse pointer with height <540 → mobile; otherwise coarse/no-hover → tablet; otherwise desktop. A 753px tablet is mobile type, and an 800×465 fine-pointer window is desktop type. Trackpad/iPad physical behavior is not established by emulation.
- **Scaling:** type uses rem and `max(role floor, baseline × setting)`. At 90%, information text keeps a 13px-equivalent floor and `micro` keeps 12px-equivalent. At a 32px browser root these floors double. The hero's resolved viewport baseline is converted to rem before scaling; setting changes scale its preferred size, not only clamp bounds.
- **Chart geometry:** columns and plots grow with type. Dots expand to fit negative values; nearby yesterday labels shrink/omit while today's value stays. Legend text stays in the card header. Chart scrolling is internal, not page overflow. Daily gradient runs from cool minimum at bottom to warm maximum at top; independent min/max labels carry the information.
- **Compact wrapping:** automatic hyphenation is disabled below 481px for the German reference after a 320px WebKit/200% text overflow finding. Words wrap anywhere without reducing the selected role size.

## Local reproduction

Prerequisites: Node per root package engines, lockfile dependencies, Playwright Chromium/WebKit. The full font is reference-only (2,057,688 bytes); production dynamic subsets, precaching and S3/CloudFront deployment are deferred. Font source: [official Pretendard v1.3.9](https://github.com/orioncactus/pretendard/tree/v1.3.9/packages/pretendard/dist/web/variable), with [local OFL license](references/fonts/OFL.txt).

```sh
npm ci --ignore-scripts
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/todayweather-design-browsers npx playwright install chromium webkit
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/todayweather-design-browsers node scripts/verification/design-typography-check.mjs
```

The checker serves only local design reference files on a temporary loopback port, blocks nonlocal browser requests, closes the server, and writes JSON/captures under ignored `reports/sdlc/issue-2651-docs-type/browser/`. It does not start the application backend or weather collection. Hosts may require approval for loopback/browser execution. `--quick --engines chromium` runs a smaller inspection matrix; `--out` must remain under reports. Unavailable engines cause a nonzero result rather than a silent skip.

Chromium capture can temporarily change emulated touch media. The verifier freezes only reference re-rendering during capture, restores input emulation, then asserts the measured tier/body are unchanged. This guard is reference tooling, not a production behavior rule. Raw runs remain ignored; selected evidence and intended staged files follow the repository artifact policy/checker.

For manual inspection, open the HTML file in a browser or serve the reference directory through a loopback-only static server. Resize the window and change controls. The root control emulates a browser text preference; do not copy this root-font override into production CSS.

## Verification coverage

Full matrix: 14 viewport/input cases × 2 languages × 2 appearances × 6 setting/root combinations × 2 engines = 672 renders. Core sizes: 402×874 touch, 820×1180 touch, 1440×900 fine. Additional cases cover 320px, 753/767/768px widths, 539/540px coarse-pointer heights, 1180×629 tablet landscape, 874×402 phone landscape, 800×465 fine-pointer desktop, 1600px wide desktop and 720×450 fine-pointer reflow.

Setting/root pairs: 90/100/115/130% at 16px; 100% and 130% at 32px. Assertions independently compute role sizes from the spec, weights/line heights, font load, tier selection, text bounds, page overflow, chart label intersections, text within dots, retained today labels, legend position, and actual scrollability. Control changes and live resize are checked separately. Selected screenshots support manual visual assessment; they do not replace assertions.

200% **text** is simulated with a doubled root. A half-width desktop viewport checks **reflow equivalent** to zoom. This does not claim that an actual browser zoom gesture, iOS Dynamic Type or Android system font setting was exercised.

## Remaining gates

- D3: physical iOS/Android comparisons with Cordova at system scale 1.0/1.3, plus iPad trackpad tier detection. Not run; system integration remains unenabled by this step.
- Product PWA seven-language layout, actual hourly/daily data handling, current-marker time alignment, missing/stale states, cursor announcements, persisted settings, and complete accessibility scans remain adoption work.
- AK's physical reading-comfort judgement is not replaced by automated geometry checks. Reference sizes are retained until this review supplies a reason to change them.
- See [dated outcomes and selected captures](../evidence/2026-10-01-design-typography/README.md) for source identities, browser results and independent verification status.
