# Rewrite reference verification

Source baseline: `bd6640f2` since the [2026-09-25 re-baseline](#2026-09-25-re-baseline); earlier sections record work done at `ff7acf3996ccb66c912d2ed4710cf300197d6966`. Date: 2026-09-23, extended by the 2026-09-24 gap review, its 2026-09-25 final round and the 2026-09-25 re-baseline. User scope: persisted main-screen screenshots and screen definitions, client input/processing contracts, ordered server assembly diagrams, and supporting rewrite references.

## 2026-09-25 re-baseline

The user pulled master, so `HEAD` moved from `ff7acf39` to `bd6640f2` (the merge of PR #2562), and the package was re-baselined to it. This pass modified no file under `client/`, `server/`, `tw.ios/`, `ta.ios/`, `applewatch/` or `web/`, and made no server, simulator, provider, database, AWS or network call. Screenshots and the two WKWebView probe records keep their `ff7acf39` commit and original dates; they stay valid because the client source did not change. The [reference index](../../docs/rewrite/README.md#re-baselined-to-bd6640f2) summarizes the upstream changes and where each is documented.

### Upstream range

- 24 non-merge commits from 2026-09-23 to 2026-09-25 (`git log --no-merges ff7acf39..bd6640f2`). `client/`, `tw.ios/`, `ta.ios/` and `applewatch/` are identical at both commits.
- 49 server files changed, 30 of them outside `server/test/offline/` and `package-lock.json`: New Relic removed and Node 16 prepared (`c80ee014`), direct APNs removed (`45b2eb3f`), the KMA collectors moved to `apis.data.go.kr` (`5e653285`, `b4d063fd`), the short RSS merge repaired (`658605db`, `b13dc38a`), daily forecast validity added and mid RSS retired (`95fe711e`, `49afbbea`), and opt-in ASOS historical observations added (`2116c6bf`).
- A static web PWA (`web/`, `packages/weather-core/`) with upstream documentation in [web client](../../docs/architecture/web-client.md) and [webapp](../../docs/webapp/README.md); new upstream contracts in [gather source reconciliation](../../docs/architecture/gather-source-reconciliation.md), [mobile API](../../docs/architecture/mobile-api.md#daily-forecast-validity-issue-2560) and [weather collection](../../docs/architecture/weather-collection.md#historical-asos-recovery-2564). The package links them instead of repeating them.

### Process

1. **Anchor move.** An automatic tool, [rebaseline-anchors.py](rebaseline-anchors.py), compared each `#Lnnn` target at both commits. It moved 334 anchors to lines that are text-identical at `bd6640f2`, left 86 whose lines did not move, and flagged 55 that touch a changed hunk or the deleted `server/newrelic.js` ([flag list](rebaseline-flagged.json)). It rewrote hrefs only, so some visible labels still showed old line numbers; the owners corrected them.
2. **Owner re-verification.** Five lanes with disjoint file ownership re-verified every statement about changed server code in their files, fixed their flagged anchors (server assembly 1; data model, providers, glossary and localization 27; push, configuration and security 22; catalog and consumer documents 3), marked removed defects "resolved upstream in `<commit>`" without deleting them, and added the upstream content a rewriter needs: daily validity and `dailyStatus`, ASOS history and `historyStatus`, mid RSS retirement, FCM-only push with lazy Firebase, the Node 16 runtime and the Web PWA. The server assembly owner regenerated the domestic diagram; the probe owner re-ran the six Node probes and added one observation.
3. **Integration.** This pass fixed the two flagged anchors in the decision register and the matrix. It applied the owners' requests: V38–V42 added; V01, V02, V04, V05, V11, V15, V16, V25, V29 and V30 extended; A29 item 10 and the D20 APN finding marked resolved upstream; A33, A40, D03, D17, D20 and two missing-evidence rows updated; A50–A52 and D43–D51 added, plus a table of resolved defects that other documents described. It also updated the baseline statements of the index, playbook, examples README and the screen, overlay, binding, client-state and screenshot documents, and regenerated the [changed-file inventory](changed-files.md).

### Probe records at `bd6640f2`

The six Node probe records now carry `source_commit` `bd6640f2`, the date 2026-09-25 and a `rebaseline` field naming the previous commit. Inputs, outputs and checks equal the `ff7acf39` run (checks column in the [final-round table](#probe-records) unchanged); only blob hashes and extracted line ranges changed, and the 17 extracted server functions are text-identical at both commits. The [unit-conversion record](probes/server-unit-conversion.json) gained an `additional_observation`, not a check: on an ASOS-recovered row, `rn1` and `r06` sentinels in inches reach the wire as `0` (A50). A Node v16.20.2 cross-check (the version `server/.nvmrc` pins) gave identical results for five probes and 23/24 for the storage probe, whose malformed-JSON message is engine-specific.

### Checks executed in the re-baseline (2026-09-25)

| Check | Result and limit |
| --- | --- |
| Client and native identity | `git diff --quiet ff7acf39 bd6640f2 -- client tw.ios ta.ios applewatch` exits 0 |
| Probe re-runs | The integrator re-ran the six Node probes (Node v24.21.0) into a temporary directory; every output is byte-identical to its checked-in record (19/19, 24/24, 5/5, 12/12, 27/27, 13/13). The Node 16 cross-check is the probe owner's run |
| Parser examples | The checked-in reproduction command printed an exact normalized JSON match for KMA and world |
| Diagram receipts | SHA-256 and byte counts of the eight diagram files recomputed; all match their delivery receipts. The domestic pair was regenerated at `bd6640f2`; the other three pairs are unchanged ([diagram verification](server-diagram-verification.md)) |
| Domestic visual check | The local receipt reports `status: pass`, no diagnostics, the delivered artifact SHA-256 and a smallest projected node text of 8 px; the integrator also viewed the 1440×900 light capture |
| Anchors and labels | A script over the 30 tracked and untracked package Markdown files: 4,969 relative links, every target present, every `#heading` matching a slug and every `#Lnnn` range inside its file. A label scan found one stale line label outside the integrator's files (reported to its owner) |
| Package validator | `python3 reports/rewrite-verification/validate-package.py` passed with no errors (84 JSON files, 4895 local links, 2868 `#Lnnn` line anchors inside their files, 50 screenshots, 45 capture diagnostics, 7 Python files); [result](package-validation.json). Since the re-baseline the validator records the checked-out `HEAD` as `source_commit` and the documentation baseline separately, and fails on a line anchor past the end of its file |
| Secret values | A pattern scan of the integrator's files found no key, token or password value; the Firebase service-account files are referred to without filenames |
| Production paths | `git status` lists no change under `client/`, `server/`, `tw.ios/`, `ta.ios/`, `applewatch/` or `web/` |
| Final check and follow-up | A read-only check verified all 55 flagged anchors and about 150 further statements against `bd6640f2` and reported 11 low-severity issues; all were fixed afterwards in the main session (commit attributions b4d063fd/b13dc38a, the `historyObservation` array shape on `short`, a stale life-index label, the models claim in the security inventory, the D03 line-shift explanation, the history lease owners, the catalog's `app.js` wording and a push anchor). The version-routing diagram was regenerated for its baseline label and the Web PWA caller ([diagram verification](server-diagram-verification.md#version-routing--architecture)). The six Node probes were re-run once more: byte-identical |

### Limits of the re-baseline

- The upstream isolated suites (`npm run test:offline`, the RSS, daily and history tests, `test:runtime`) were not run. New server behavior is described from source reading, plus the one probe observation above.
- The Web PWA was read from source only: no web build, browser run or live request.
- No host was re-inspected. The inspected service host still ran a `5bca407` checkout on 2026-09-20, which predates both baselines.
- Several upstream architecture pages link to `reports/sdlc/…` records. That directory is Git-ignored, `7f18f89b` removed its tracked files, and `reports/sdlc/issue-2564/` is absent in this checkout. The package validator does not cover `docs/architecture`.

## 2026-09-25 final round

Same source baseline (`ff7acf39`); `client/`, `server/`, `tw.ios/`, `ta.ios/` and `applewatch/` were not modified. The integration pass started no server, simulator, provider, database, AWS or network call; the two iPad captures come from a separate capture run on 2026-09-25. FIN gaps, their addressing documents and the remaining cross-document items are in the [gap review table](gap-review-2026-09-24.md#final-round-fin-1-to-fin-4).

### Process

1. **Shared-file check.** A read-only check of the eight integrator-owned shared files checked 92 claims and found 11 issues: swapped A34 link labels, the V15 cleanup link, the V09/V14 statement, the verifier count, the update-popup recurrence wording, an unevidenced 2026-09-25 re-run claim, the SCR-5 statement, missing matrix cases behind D36, D37, A15 and A45, the perceptual-review summary, an incomplete list of unsaved harnesses and the decision-register header. This pass fixed all eleven.
2. **Completeness critic.** A critic re-read the package against the four requirements, confirmed that each gap ID is addressed where the table says, and filed FIN-1 (unit conversion and A04), FIN-2 (the KAQ image-derived hourly forecast), FIN-3 (domestic station selection and merge) and FIN-4 (iPad, landscape and size-dependent layout).
3. **Probes.** Six Node probe scripts were checked in under [probes](probes/) with their JSON records (table below). Each runs offline from the repository root with plain `node`, loads only pure library modules or source text extracted into VM contexts with stubbed dependencies, and never imports `server/app.js` or connects to a database.
4. **Fixers.** Four lanes with disjoint file ownership (client screens, server assembly, reference inventories, architecture pages) addressed FIN-1 to FIN-4, the cross-document items that the first integration could not apply, and six of the seven QA issues left open.
5. **Integration.** This pass fixed the shared-check findings, recorded FIN-1 to FIN-4, added matrix V37 and extended V01, V03, V05, V10–V13, V15, V17, V24, V29, V30 and V33, relabelled A04 and added A46–A49 and D39–D42, and updated the reference index, examples README, playbook, these reports and the [changed-file inventory](changed-files.md).

### Probe records

| Probe script and record | Checks | Supports |
| --- | --- | --- |
| [client-storage-migration.js](probes/client-storage-migration.js), [record](probes/client-storage-migration.json) | 24/24 | Storage fixtures' `expectedAfterStartup` and `variantRuns`, persisted shapes and legacy migrations; V11, A11, A22 |
| [client-push-branch-entry.js](probes/client-push-branch-entry.js), [record](probes/client-push-branch-entry.json) | 19/19 | Inbound-notification and entry-link rules, using the `push-notification-open.json` variants as inputs; V13, A20, A21 |
| [server-push-text-purchase-expiry.js](probes/server-push-text-purchase-expiry.js), [record](probes/server-push-text-purchase-expiry.json) | 27/27 | Push text §2.4 and §4.1–§4.3 and `calcExpirationDate` §5.4, identical under `Asia/Seoul`, `UTC` and `America/Los_Angeles`; V29, V30 |
| [server-kmatimelib-timezones.js](probes/server-kmatimelib-timezones.js), [record](probes/server-kmatimelib-timezones.json) | 12/12 | Time-representation table and retention span under three zones, plus the DST-edge `toTimeZone` reading; V33 |
| [server-unit-conversion.js](probes/server-unit-conversion.js), [record](probes/server-unit-conversion.json) | 13/13 | Factors and rounding, Beaufort bands, Fahrenheit floor versus world `temp_f`, A04 output-neutral, sentinel outcomes; V05, D42 (FIN-1) |
| [server-airkorea-station-merge.js](probes/server-airkorea-station-merge.js), [record](probes/server-airkorea-station-merge.json) | 5/5 | Cumulative freshness window, donor merge and a station name without a value; V01, A46 (FIN-3) |

The first four reproduce results that previously ran only from temporary directories; the last two are new. Every record is dated 2026-09-25 and names its command, Node version, `TZ`, the blob hashes of the executed source files, its inputs and its checks. The two WKWebView harness records from 2026-09-24 (start popup, photo selection) are unchanged.

### Other evidence and status

- **iPad captures.** [tw-ipad-hourly](../../docs/rewrite/screenshots/tw-ipad-hourly.png) and [tw-ipad-daily](../../docs/rewrite/screenshots/tw-ipad-daily.png): iPad Pro 11-inch (M5) / iOS 26.5, portrait, ko-KR, light theme, `screenshot-weather.json`, each with a diagnostics JSON ([hourly](tw-ipad-hourly.json), [daily](tw-ipad-daily.json)). The manifest now has 50 entries: 21 from 2026-09-23, 27 from 2026-09-24 and 2 from 2026-09-25. Landscape was not captured, because the harness Info.plist allows portrait only.
- **QA status.** The twelve QA lanes of the gap review verified 2,231 claims and fixed 148 of the 155 issues they found. The final round resolved six of the seven left open: the storage and push/Branch results now have probe records, push-notifications.md line 62 states the single-record disable, the `invalidateCloudFront` anchors end at L314, the W4/W5 time-offset fallback notes its `TypeError`, and `_getTimeValue` moved to the E1 producers. The seventh, the world diagram's undrawn AQI error path, is kept as a recorded simplification ([diagram verification](server-diagram-verification.md#world--sequence)).
- **Date basis.** Dates in these reports carry no time-zone label. For example, the version-routing diagram is recorded as delivered on 2026-09-24, which matches its delivery-receipt file time in UTC (16:15Z) but not in KST (2026-09-25 01:15).

### Checks executed in the final round (2026-09-25)

| Check | Result and limit |
| --- | --- |
| Package validator | `python3 reports/rewrite-verification/validate-package.py` passed with no errors (83 JSON files, 4,335 local links, 50 screenshots, 45 capture diagnostics, 6 Python files); [result](package-validation.json). It does not check `#heading` or `#Lnnn` anchors |
| Probe re-runs | The integrator re-ran all six Node probes offline (Node v24.21.0); each output was byte-identical to its checked-in record |
| Parser examples | The checked-in reproduction command printed an exact normalized JSON match for KMA and world |
| Diagram receipts | SHA-256 and byte counts of the eight diagram JSON/HTML files recomputed; all match their delivery receipts, so no diagram changed |
| Anchors in the owned files | A separate script over the nine integrator-owned files: 777 relative links, every target present, every `#heading` anchor matching a heading slug and every `#Lnnn` range inside its target file |
| QA totals | Recomputed from the orchestrator's QA result file: 12 lanes, 2,231 claims, 155 issues, 148 fixed |
| Secret values | A pattern scan of the nine owned files found no key, token, password or ad-unit value |
| Production paths | `git status` lists no change under `client/`, `server/`, `tw.ios/`, `ta.ios/` or `applewatch/` |

### Limits after the final round

- The KAQ decoder was not executed; V37 is a proposal, and the deployed calibration is unknown (A48, D40).
- Synthetic results that still have no checked-in harness are labelled in their documents: glossary icon, AQI-converter, derived-index and daily-regrading runs; localization `negotiateLocale` and push-list normalization; data-model collection-name derivation and the grid check; the client-contracts address and `town.js` evaluations; the S03/S04 size table from an extracted `initSize`. The KMA rain-consensus identity comparison (A47) rests on source reading plus JavaScript semantics.
- iPad evidence is portrait only for S03 and S04; landscape, rotation, other iPad screens, TodayAir on iPad and Android tablets are uncaptured.
- Open items in files outside the integrator's ownership are listed in the [gap review](gap-review-2026-09-24.md#cross-document-items-status-2026-09-25), including the inconsistent app-group identifier redaction.

## 2026-09-24 gap review

Dates: 2026-09-24 to 2026-09-25, same source baseline (`ff7acf39`); `client/`, `server/`, `tw.ios/`, `ta.ios/` and `applewatch/` were not modified. Every gap ID with its verdict, severity, addressing documents and deliberately unaddressed parts is in the tracked [gap review table](gap-review-2026-09-24.md). The sections after this one remain the record of the original 2026-09-23 delivery.

### Process

1. **Audit.** Four dimension auditors (screens, client data, server assembly, other rewrite references) compared the package with the four original requirements and with source, reporting 34 gaps (SCR-1–8, CLI-1–8, SRV-1–9, RR-01–09).
2. **Adversarial verification.** Five verifiers (two for server assembly) re-read the cited source and package lines, returned *confirmed* or *partially* verdicts with corrected facts, and added five gaps (SCR-M1, CLI-M1, SRV-M1, SRV-M2, RR-M1). Both server verifiers found the error-handler issue independently. A planned completeness-critic run did not finish in this round (session limits); a critic ran in the [final round](#2026-09-25-final-round).
3. **Implementation.** 17 writer lanes with disjoint file ownership: nine for criteria 1–3 (screen specifications, element bindings, overlays, client contracts, client state, server assembly, push text and purchase, diagram corrections, new diagrams) and eight for criterion 4 (API catalog, native perimeter, data models and time, providers, configuration, glossary, localization, security), plus small corrections in `docs/architecture`. Shared files were left to one integrator.
4. **QA.** Twelve check-and-fix lanes re-verified every new or changed document against source at the baseline and fixed inaccuracies in place. Together they checked 2,231 claims and fixed 148 of the 155 issues they found (counted from the orchestrator's QA result file); the seven left open are tracked in the [final round](#2026-09-25-final-round). The diagram lane regenerated the domestic and world artifacts.
5. **Integration.** This pass merged writer and QA requests into the [reference index](../../docs/rewrite/README.md), the [verification matrix](../../docs/rewrite/verification-matrix.md) (V01–V08, V10–V13, V15 and V16 extended, V07 corrected, V09 and V14 unchanged, V17–V36 added), the [decision register](../../docs/rewrite/decisions-and-open-questions.md) (A07–A45, D11–D38, corrected D03 and A06, new missing-evidence rows), the [examples README](../../docs/rewrite/examples/README.md), the [playbook](../../docs/rewrite/rewrite-playbook.md) and these reports. Requests that target files outside the integrator's ownership are listed in the gap review table, not applied.

### Captured and probed

- **27 new simulator captures** (iPhone 17 Pro / iOS 26.5, isolated native WKWebView, synthetic loopback data): 13 overlay and loading states (O01–O03, O05–O10, O12 and three O17 states), three S02 states including TodayAir, two national-map layers, four themes (dark, old and photo hourly; TodayAir dark air), three en-US screens and two Ionic Android mode screens. Ionic Android mode runs in an iOS WKWebView; it is not an Android device. Each 2026-09-24 [manifest](../../docs/rewrite/screenshots/manifest.json) entry records its trigger and notes, and each has a diagnostics JSON without window/resource errors, broken images or invalid SVG numbers. The manifest grew from 21 to 48 entries.
- **Probes** (synthetic execution in the harness): the [start-popup probe](probes/start-popup-choice.json) and its [script](probes/start-popup-choice.js) record that value `false` (the preselected "use current location" label) routes to `/tab/search` and value `true` enables the current position; the [photo selection probe](probes/weather-photo-selection.json) records index 0 in 200 of 200 draws from a two-photo bucket.
- **Observed in captures:** the update-information popup reappears on reload until a button is tapped with its box ticked; the push save dialog title is the hard-coded English "Save"; the start popup title is hidden; the light-theme header spinner is invisible; en-US region defaults to F/mph/inHg/miles/inches/AirNow and hides KR-only menu items and About.
- **Synthetic Node executions** by writers and QA, without a server, DB or provider: the KMA/world parser examples (checked-in [command](../../docs/rewrite/client-data-contracts.md#reproduce-the-saved-normalization-examples)); address worked examples and a `town.js` evaluation; storage startup and migration variants; push and Branch entry handling; push-text builders, alert decisions and `calcExpirationDate` (these three, like the `kmaTimeLib` run, were checked in as probes in the final round); icon, AQI, derived-index and `weatherType` functions; the vendored `negotiateLocale` and push-list normalization ([reproduction steps](../../docs/rewrite/localization-inventory.md#7-reproduce-the-counts)); `kmaTimeLib` under three time zones ([probe table](../../docs/rewrite/data-model-reference.md#44-synthetic-probe)); Mongoose collection-name derivation with the cached pluralize package.
- **Diagrams:** two corrected and two new, each passing Archify validation and delivery 9/9 and visual-check; see [diagram verification](server-diagram-verification.md).

### Harness and tooling changes

- [`capture/prepare.py`](capture/prepare.py): `--locale` sets `navigator.language` and `navigator.languages` (default `ko-KR`); `--photo-feed` serves the [synthetic feed](../../docs/rewrite/examples/weather-photos-feed.json) with two generated gradient PNGs and points the staged `weatherPhotosUrl` at loopback.
- [`capture/render-harness.js`](capture/render-harness.js): a `HARNESS_LOCALE` value that `prepare.py` replaces, and an added `navigator.languages` override (region derivation reads it).
- [`capture/build-gallery.py`](capture/build-gallery.py) (new): regenerates the [gallery](../../docs/rewrite/screenshots/index.html) and the [screenshots README](../../docs/rewrite/screenshots/README.md) table from the manifest.
- [`validate-package.py`](validate-package.py): also fails when a PNG is missing from the manifest or when the gallery or screenshots README omits a manifest entry.
- [`capture/README.md`](capture/README.md): 2026-09-24 overlay, state and variant recipes and probe instructions.

### Checks executed during the first integration (2026-09-25)

| Check | Result and limit |
| --- | --- |
| Package validator | `python3 reports/rewrite-verification/validate-package.py` passed with no errors (75 JSON files, 3,974 local links, 48 screenshots, 43 capture diagnostics, 6 Python files); [result](package-validation.json). It checks local link targets, Git inclusion, JSON/Python syntax, screenshot bytes, dimensions and diagnostics, and manifest/gallery/README consistency. It does not check `#heading` or `#Lnnn` anchors |
| Anchors in the integrated files | A separate script over the eleven shared files edited in this pass: every relative link resolves, every `#heading` anchor matches a heading slug and every `#Lnnn` range lies inside its target file |
| Parser examples | The checked-in reproduction command (Node v24.21.0) printed an exact normalized JSON match for KMA and world |
| Diagram receipts | SHA-256 and byte counts of the eight diagram JSON/HTML files recomputed; all match their delivery receipts. The four local visual-check receipts report `status: pass` and the delivered artifact SHA-256 |
| Local diagram captures | 16 local PNGs hashed into the [capture manifest](server-diagram-capture-manifest.json); PNGs stay untracked |
| Secret values | The integrated files contain configuration and secret names and `file#Lnnn` locations only; a pattern scan of those files found no key, token, password or ad-unit value |

Each writer and QA lane also reported running the package validator (passed), its own anchor check and a secret-pattern scan; those are agent reports, not re-executed here beyond the checks above.

### Limits of the gap review

- No server start, collector, DB, provider, AWS or network call was made, and the integration pass started no simulator; captures and probes come from the 2026-09-24 harness run.
- Android behavior is covered only by source reading and Ionic Android mode captures; no Android device, native plugin, permission, purchase, push delivery or widget run was performed. Eight overlays (O04, O11, O13–O16, O18, O19) remain uncaptured.
- At the first integration, several synthetic harnesses had run from temporary directories: the storage migration harness, the push/Branch runs, the push-text and purchase extraction harness and the `kmaTimeLib` time-zone probe. The [final round](#2026-09-25-final-round) checked all four in under [probes](probes/).
- Library behavior (Express `finalhandler`, i18n 0.8.x, async@2, Mongoose 5.1.2 `remove`/`update`, `jsonwebtoken` `decode`) is a reading of the pinned versions; `node_modules` is absent.
- AWS and traffic facts remain dated 2026-09-20 and 2026-09-22 observations. Review was performed by agents; it is not a human sign-off or a cross-provider review.

## Delivered scope

- [Reference index](../../docs/rewrite/README.md) connects screen, client, server, lifecycle, migration, tests and decision documents.
- [Screen definitions](../../docs/rewrite/screen-specifications.md) cover 16 documented screens/product variants. [Gallery](../../docs/rewrite/screenshots/index.html) and [manifest](../../docs/rewrite/screenshots/manifest.json) contain 21 PNGs: 16 captures from this documentation run, five reused same-day captures (menu, three compact views and unsafe-area baseline).
- [Client contracts](../../docs/rewrite/client-data-contracts.md) and [state behavior](../../docs/rewrite/client-state-and-behavior.md) explain wire/normalized/storage boundaries. Four parser examples are generated/verified against current WeatherUtil. Four screenshot fixtures support visual states separately.
- [Server assembly](../../docs/rewrite/server-response-assembly.md) and [lifecycle](../../docs/rewrite/server-data-lifecycle.md) describe data selection, ordered composition, sources/models, collectors, cache/fill, nationwide fan-out, modes and failure behavior.
- [Diagram verification](server-diagram-verification.md) records artifact, browser and perceptual checks independently.
- [Rewrite playbook](../../docs/rewrite/rewrite-playbook.md), [verification matrix](../../docs/rewrite/verification-matrix.md), and [decision ledger](../../docs/rewrite/decisions-and-open-questions.md) are proposals and unresolved requirements, not a new implementation.

## Checks actually executed

| Check | Result and limit |
| --- | --- |
| Source provenance | Separate byte comparison confirms application JS/templates/images/fonts/locales/data (401 files) and source SCSS are identical in staging; only harness/config/readiness additions differ. [Parity result](capture-source-parity.json) |
| Simulator rendering | iPhone 17 Pro/iOS 26.5 and prior same-day iPhone SE 3/iOS 18.6; actual native WKWebView executable installed/launched |
| Capture diagnostics | 16 new page diagnostic JSON files; no captured window/resource errors, broken HTML images or invalid SVG numbers on those page entries |
| Perceptual screenshots | All 21 saved images inspected; intentional horizontal forecast overflow, tall map scroll and unavailable purchase state documented |
| Parser examples | Current unmodified WeatherUtil executed in isolated Node VM; KMA/world outputs exactly match saved normalized examples; no network/database calls |
| Server order/source | KMA 37 and DSF 14 middleware order checked against actual router arrays; inherited/overridden methods followed; nationwide route composition added after review |
| Diagram artifacts | Two diagrams each pass 9/9 showcase checks, zero composition errors/warnings; hashes bind JSON and HTML |
| Diagram browser | Four desktop viewports per diagram; no horizontal/vertical overflow; visual evidence separate from generated artifact checks |
| Capture preparation | `prepare.py` executed into a new `/private/tmp` directory; current assets/fixtures staged without production edits |
| Package checks | JSON syntax, local document/HTML references, screenshot hash/dimensions and Python syntax checked by [validator](validate-package.py); [result](package-validation.json). Staged source parity was checked separately above. |

No `server/app.js` import, production server startup, collection endpoint, DB/provider query, deployment command, purchase/restore or push submission ran. Existing legacy integration tests were not blindly executed. Native-plugin warnings (Firebase/diagnostic/purchase) and first-empty-city diagnostic messages are expected in the harness; do not describe all console logs as error-free.

## Independent review and corrections

Separate client and server research lanes authored bounded files; a planning lane authored migration/verification decisions; a separate QA agent reviewed source claims and cross-document consistency. Specialized role models were unavailable, so default agents performed the explicitly assigned responsibilities. This is agent review, not a claimed cross-provider review or human sign-off.

The QA review checked route inventories, both middleware lists, converter branching/eight-sample alignment/mutation, overlapping HTTP attempts, immediate radio persistence, process modes and storage dispatch. It identified and resolved:

1. **Coordinate boundary ambiguity:** direct DSF emits `location.lon`, while the historically inspected public gateway replaces geo fields with `location.long`. Examples now label their boundary.
2. **AQI time wording:** the code's one-sided age comparison is stated exactly, not summarized as a symmetric six-hour tolerance.
3. **Missing nationwide assembly:** documented regional air lookup/regrading, 15 parallel configurable API-server child requests, query/language propagation and failure semantics.

Capture corrections were confined to the harness: a wrong test radio title was replaced with the real localization key; TodayAir product switching required a full document reload, not a hash-only navigation. Captures were replaced after checking actual product route registration. Historical fixture-icon/readiness investigation is summarized in the earlier planning evidence; final stored visual fixtures use existing icons and the readiness shim.

## Local diagram verification artifacts

The user-reported blank pages were `.visual-check.html` screenshot contact sheets whose PNGs were excluded by Git. All visual-check HTML, PNG and raw browser JSON receipts are now excluded, including renamed copies. Main diagram HTML embeds SVG and remains versioned; editable source JSON and artifact validation/delivery receipts remain versioned, while all raw visual-check browser receipts are local-only. App screen captures remain versioned. The package validator checks HTML assets against the deliverable Git file set so ordinary published pages cannot silently depend on ignored local files.

## Evidence boundaries and remaining risk

Screens use Korean/light theme/portrait and synthetic world-shaped weather. Seoul is a rendering label; these captures do not prove domestic KMA response correctness. No live provider health, production gateway configuration, data freshness, original Cordova build, native permissions, purchases, push delivery, widgets/watch, keyboard, touch gestures, accessibility sizes or landscape has been established. Native status bar is hidden in the test shell. The explicit unsafe-area screenshot shows why actual release host configuration needs separate verification.

Server findings are static at the pinned revision; prior AWS/host facts remain dated observations. Source anomalies are preserved as decision/test candidates, not silently patched or asserted to be confirmed production incidents. Proposed SLAs, framework choices and rollout thresholds remain undecided.

## File scope and follow-up

Production paths `client/`, `server/`, `tw.ios/`, `ta.ios/`, `applewatch/` and, since the re-baseline, `web/` were preserved. Changes are `README.md` navigation, `docs/rewrite/`, `reports/rewrite-verification/`, and ignored planning records; the 2026-09-24 gap review and its final round also made small corrections and cross-links in five `docs/architecture/` pages. The [changed-file inventory](changed-files.md) lists the delivered repository files, including the gap-review working-tree changes. [Capture tooling](capture/README.md) explains reproducible staging and its limitations. The temporary loopback server and dedicated simulator used in this run are stopped after capture; retained harness/device artifacts can be reused deliberately.
