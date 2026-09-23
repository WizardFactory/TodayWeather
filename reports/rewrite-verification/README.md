# Rewrite reference verification

Source baseline: `ff7acf3996ccb66c912d2ed4710cf300197d6966`. Date: 2026-09-23. User scope: persisted main-screen screenshots and screen definitions, client input/processing contracts, ordered server assembly diagrams, and supporting rewrite references.

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

The user-reported blank pages were `.visual-check.html` screenshot contact sheets whose PNGs were excluded by Git. These temporary HTML pages are now excluded too, along with renamed diagram PNG copies. Main diagram HTML embeds SVG and remains versioned; source JSON and machine-readable verification receipts remain versioned. App screen captures remain versioned. The package validator checks HTML assets against the deliverable Git file set so ordinary published pages cannot silently depend on ignored local files.

## Evidence boundaries and remaining risk

Screens use Korean/light theme/portrait and synthetic world-shaped weather. Seoul is a rendering label; these captures do not prove domestic KMA response correctness. No live provider health, production gateway configuration, data freshness, original Cordova build, native permissions, purchases, push delivery, widgets/watch, keyboard, touch gestures, accessibility sizes or landscape has been established. Native status bar is hidden in the test shell. The explicit unsafe-area screenshot shows why actual release host configuration needs separate verification.

Server findings are static at the pinned revision; prior AWS/host facts remain dated observations. Source anomalies are preserved as decision/test candidates, not silently patched or asserted to be confirmed production incidents. Proposed SLAs, framework choices and rollout thresholds remain undecided.

## File scope and follow-up

Production paths `client/`, `server/`, `tw.ios/`, `ta.ios/` and `applewatch/` were preserved. Changes are `README.md` navigation, `docs/rewrite/`, `reports/rewrite-verification/`, and ignored planning records. The [changed-file inventory](changed-files.md) lists the delivered repository files. [Capture tooling](capture/README.md) explains reproducible staging and its limitations. The temporary loopback server and dedicated simulator used in this run are stopped after capture; retained harness/device artifacts can be reused deliberately.
