# Changed files

Scope: working-tree changes of the 2026-09-24 gap review, its 2026-09-25 final round and the 2026-09-25 re-baseline on branch `rewrite-docs-gap-review`, relative to `HEAD` `bd6640f2` (master after PR #2562; the merged package of PR #2553 is in its history). Regenerated from `git status --porcelain -uall` (tracked modified plus untracked, non-ignored files) on 2026-09-25 after the re-baseline integration. A = added (untracked), M = modified. Git-ignored local artifacts (Archify visual-check outputs, planning records) are not listed. The inventory of the original package (PR #2553) is in Git history. Production paths `client/`, `server/`, `tw.ios/`, `ta.ios/`, `applewatch/`, `web/` and `packages/` are unchanged.

Totals: 101 added and 40 modified files (141).

## Architecture corrections (5)

Gap-review corrections kept on top of the upstream versions of these pages: error-sink consequence of `NODE_ENV`, the Android widget plugin lead, the push alert row and single-record token updates, API and provider catalog links, and the process-time-zone line.

- `M — docs/architecture/ec2-internals.md`
- `M — docs/architecture/evidence.md`
- `M — docs/architecture/push-notifications.md`
- `M — docs/architecture/service-overview.md`
- `M — docs/architecture/weather-collection.md`

## Reference index and shared guidance (4)

Package index with the `bd6640f2` re-baseline summary, verification matrix (V01–V42 and re-baseline evidence), decision register (A01–A52, D01–D51, resolved-upstream markers and table) and playbook.

- `M — docs/rewrite/README.md`
- `M — docs/rewrite/decisions-and-open-questions.md`
- `M — docs/rewrite/rewrite-playbook.md`
- `M — docs/rewrite/verification-matrix.md`

## Screen definitions (3)

Screen corrections, variants and device classes; overlay/dialog catalog O01–O19; per-element binding tables. Re-baselined to `bd6640f2` (client source identical); daily date-gap and recovered-rain notes added.

- `A — docs/rewrite/screen-element-bindings.md`
- `A — docs/rewrite/screen-overlays.md`
- `M — docs/rewrite/screen-specifications.md`

## Screenshots (32)

27 captures from 2026-09-24, two iPad captures from 2026-09-25 and the regenerated manifest, gallery and README (50 entries). Captures keep their `ff7acf39` commit and dates; the README states the re-baseline.

- `M — docs/rewrite/screenshots/README.md`
- `M — docs/rewrite/screenshots/index.html`
- `M — docs/rewrite/screenshots/manifest.json`
- `A — docs/rewrite/screenshots/ta-favorites.png`
- `A — docs/rewrite/screenshots/ta-theme-dark-air.png`
- `A — docs/rewrite/screenshots/tw-android-mode-hourly.png`
- `A — docs/rewrite/screenshots/tw-android-mode-menu.png`
- `A — docs/rewrite/screenshots/tw-favorites-editing.png`
- `A — docs/rewrite/screenshots/tw-favorites-search.png`
- `A — docs/rewrite/screenshots/tw-ipad-daily.png`
- `A — docs/rewrite/screenshots/tw-ipad-hourly.png`
- `A — docs/rewrite/screenshots/tw-loading-header-spinner-dark.png`
- `A — docs/rewrite/screenshots/tw-loading-header-spinner-light.png`
- `A — docs/rewrite/screenshots/tw-loading-overlay-search.png`
- `A — docs/rewrite/screenshots/tw-menu-en-us.png`
- `A — docs/rewrite/screenshots/tw-nation-rain.png`
- `A — docs/rewrite/screenshots/tw-nation-wind.png`
- `A — docs/rewrite/screenshots/tw-overlay-about.png`
- `A — docs/rewrite/screenshots/tw-overlay-access-explanation.png`
- `A — docs/rewrite/screenshots/tw-overlay-air-source-info.png`
- `A — docs/rewrite/screenshots/tw-overlay-alert-intro.png`
- `A — docs/rewrite/screenshots/tw-overlay-foreground-notification.png`
- `A — docs/rewrite/screenshots/tw-overlay-push-save-confirm.png`
- `A — docs/rewrite/screenshots/tw-overlay-retry-weather.png`
- `A — docs/rewrite/screenshots/tw-overlay-start-error-alert.png`
- `A — docs/rewrite/screenshots/tw-overlay-start-popup.png`
- `A — docs/rewrite/screenshots/tw-overlay-update-info.png`
- `A — docs/rewrite/screenshots/tw-start-en-us.png`
- `A — docs/rewrite/screenshots/tw-theme-dark-hourly.png`
- `A — docs/rewrite/screenshots/tw-theme-old-hourly.png`
- `A — docs/rewrite/screenshots/tw-theme-photo-hourly.png`
- `A — docs/rewrite/screenshots/tw-units-en-us.png`

## Client contracts and state (2)

Language negotiation, geography precedence, photo feed, notification and entry-link contracts, and the `bd6640f2` domestic response additions; storage shapes, migrations and analytics.

- `M — docs/rewrite/client-data-contracts.md`
- `M — docs/rewrite/client-state-and-behavior.md`

## Examples (10)

Regenerated parser examples plus new geocode, notification, photo-feed and storage fixtures, and their boundaries; the README notes the re-baseline.

- `M — docs/rewrite/examples/README.md`
- `A — docs/rewrite/examples/client-geocode-coord-response.json`
- `M — docs/rewrite/examples/client-kma-normalized.json`
- `M — docs/rewrite/examples/client-kma-response.json`
- `M — docs/rewrite/examples/client-world-normalized.json`
- `M — docs/rewrite/examples/client-world-response.json`
- `A — docs/rewrite/examples/push-notification-open.json`
- `A — docs/rewrite/examples/storage-current.json`
- `A — docs/rewrite/examples/storage-legacy.json`
- `A — docs/rewrite/examples/weather-photos-feed.json`

## Server assembly, lifecycle, push and purchase (3)

Location resolution, station selection and merge, error sink, version variants, warnings, nation routing; push text and purchase validation. Re-baselined to `bd6640f2`: daily validity, mid RSS retirement, ASOS history, FCM-only push.

- `M — docs/rewrite/server-data-lifecycle.md`
- `A — docs/rewrite/server-push-and-purchase.md`
- `M — docs/rewrite/server-response-assembly.md`

## Server diagrams (8)

Corrected domestic/world diagrams and new nation fan-out and version-routing diagrams (JSON and generated HTML); the domestic pair regenerated at the re-baseline.

- `M — docs/rewrite/diagrams/server-domestic-assembly.html`
- `M — docs/rewrite/diagrams/server-domestic-assembly.json`
- `A — docs/rewrite/diagrams/server-nation-fanout.html`
- `A — docs/rewrite/diagrams/server-nation-fanout.json`
- `A — docs/rewrite/diagrams/server-version-routing.html`
- `A — docs/rewrite/diagrams/server-version-routing.json`
- `M — docs/rewrite/diagrams/server-world-cache-sequence.html`
- `M — docs/rewrite/diagrams/server-world-cache-sequence.json`

## Reference inventories (8)

API endpoints, native consumers and plugins (including the Web PWA), data models and time (including the ASOS collections), providers (including ASOS and the image-derived KAQ forecast), configuration, glossary (including unit conversion and daily-validity rules), localization, security and privacy; all re-baselined to `bd6640f2`.

- `A — docs/rewrite/api-endpoint-catalog.md`
- `A — docs/rewrite/configuration-inventory.md`
- `A — docs/rewrite/data-model-reference.md`
- `A — docs/rewrite/domain-glossary.md`
- `A — docs/rewrite/external-providers.md`
- `A — docs/rewrite/localization-inventory.md`
- `A — docs/rewrite/native-consumers-and-plugins.md`
- `A — docs/rewrite/security-and-privacy-inventory.md`

## Verification record and reports (7)

Verification record (including the 2026-09-25 re-baseline), gap review table (FIN-1 to FIN-4 and a re-baseline note), changed-file inventory, diagram verification, local capture inventory and validator result.

- `M — reports/rewrite-verification/README.md`
- `M — reports/rewrite-verification/changed-files.md`
- `A — reports/rewrite-verification/gap-review-2026-09-24.md`
- `M — reports/rewrite-verification/package-validation.json`
- `M — reports/rewrite-verification/server-diagram-capture-manifest.json`
- `M — reports/rewrite-verification/server-diagram-captures.md`
- `M — reports/rewrite-verification/server-diagram-verification.md`

## Diagram receipts (8)

Archify validation and delivery receipts for the four diagrams; the domestic delivery receipt rewritten at the re-baseline.

- `M — reports/rewrite-verification/server-domestic-delivery.json`
- `M — reports/rewrite-verification/server-domestic-validation.json`
- `A — reports/rewrite-verification/server-nation-delivery.json`
- `A — reports/rewrite-verification/server-nation-validation.json`
- `A — reports/rewrite-verification/server-version-delivery.json`
- `A — reports/rewrite-verification/server-version-validation.json`
- `M — reports/rewrite-verification/server-world-delivery.json`
- `M — reports/rewrite-verification/server-world-validation.json`

## Capture tooling and validator (5)

`--locale`/`--photo-feed` staging, locale override, gallery generator, capture recipes and manifest/gallery consistency checks.

- `M — reports/rewrite-verification/capture/README.md`
- `A — reports/rewrite-verification/capture/build-gallery.py`
- `M — reports/rewrite-verification/capture/prepare.py`
- `M — reports/rewrite-verification/capture/render-harness.js`
- `M — reports/rewrite-verification/validate-package.py`

## Re-baseline tooling (2)

The anchor tool that moved the 334 text-identical `#Lnnn` anchors to `bd6640f2`, and its list of the 55 flagged anchors.

- `A — reports/rewrite-verification/rebaseline-anchors.py`
- `A — reports/rewrite-verification/rebaseline-flagged.json`

## Probes (15)

Six Node probe scripts with their records (storage migration, push and entry links, push text and purchase expiry, `kmaTimeLib` time zones, unit conversion, AirKorea station merge), re-run and re-recorded at `bd6640f2`, plus the start-popup and photo-selection harness records (2026-09-24, `ff7acf39`).

- `A — reports/rewrite-verification/probes/client-push-branch-entry.js`
- `A — reports/rewrite-verification/probes/client-push-branch-entry.json`
- `A — reports/rewrite-verification/probes/client-storage-migration.js`
- `A — reports/rewrite-verification/probes/client-storage-migration.json`
- `A — reports/rewrite-verification/probes/server-airkorea-station-merge.js`
- `A — reports/rewrite-verification/probes/server-airkorea-station-merge.json`
- `A — reports/rewrite-verification/probes/server-kmatimelib-timezones.js`
- `A — reports/rewrite-verification/probes/server-kmatimelib-timezones.json`
- `A — reports/rewrite-verification/probes/server-push-text-purchase-expiry.js`
- `A — reports/rewrite-verification/probes/server-push-text-purchase-expiry.json`
- `A — reports/rewrite-verification/probes/server-unit-conversion.js`
- `A — reports/rewrite-verification/probes/server-unit-conversion.json`
- `A — reports/rewrite-verification/probes/start-popup-choice.js`
- `A — reports/rewrite-verification/probes/start-popup-choice.json`
- `A — reports/rewrite-verification/probes/weather-photo-selection.json`

## Capture diagnostics (29)

Page diagnostics for each 2026-09-24 and 2026-09-25 capture.

- `A — reports/rewrite-verification/ta-favorites.json`
- `A — reports/rewrite-verification/ta-theme-dark-air.json`
- `A — reports/rewrite-verification/tw-android-mode-hourly.json`
- `A — reports/rewrite-verification/tw-android-mode-menu.json`
- `A — reports/rewrite-verification/tw-favorites-editing.json`
- `A — reports/rewrite-verification/tw-favorites-search.json`
- `A — reports/rewrite-verification/tw-ipad-daily.json`
- `A — reports/rewrite-verification/tw-ipad-hourly.json`
- `A — reports/rewrite-verification/tw-loading-header-spinner-dark.json`
- `A — reports/rewrite-verification/tw-loading-header-spinner-light.json`
- `A — reports/rewrite-verification/tw-loading-overlay-search.json`
- `A — reports/rewrite-verification/tw-menu-en-us.json`
- `A — reports/rewrite-verification/tw-nation-rain.json`
- `A — reports/rewrite-verification/tw-nation-wind.json`
- `A — reports/rewrite-verification/tw-overlay-about.json`
- `A — reports/rewrite-verification/tw-overlay-access-explanation.json`
- `A — reports/rewrite-verification/tw-overlay-air-source-info.json`
- `A — reports/rewrite-verification/tw-overlay-alert-intro.json`
- `A — reports/rewrite-verification/tw-overlay-foreground-notification.json`
- `A — reports/rewrite-verification/tw-overlay-push-save-confirm.json`
- `A — reports/rewrite-verification/tw-overlay-retry-weather.json`
- `A — reports/rewrite-verification/tw-overlay-start-error-alert.json`
- `A — reports/rewrite-verification/tw-overlay-start-popup.json`
- `A — reports/rewrite-verification/tw-overlay-update-info.json`
- `A — reports/rewrite-verification/tw-start-en-us.json`
- `A — reports/rewrite-verification/tw-theme-dark-hourly.json`
- `A — reports/rewrite-verification/tw-theme-old-hourly.json`
- `A — reports/rewrite-verification/tw-theme-photo-hourly.json`
- `A — reports/rewrite-verification/tw-units-en-us.json`
