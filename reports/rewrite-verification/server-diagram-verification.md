# Server documentation and diagram verification

Source baseline: `bd6640f2` (re-baselined 2026-09-25 from `ff7acf3996ccb66c912d2ed4710cf300197d6966`). At the re-baseline only the domestic diagram changed: its owner updated two node tags and two card items for the upstream daily-validity, mid RSS and ASOS changes and regenerated it on 2026-09-25; the integrator checked the world, nation and version-routing labels against `bd6640f2` (`server/routes/`, `server/controllers/worldWeather/` and `kecoController.js` are identical at both commits, and no label names New Relic, APNs, mid RSS or the history fields) and left the world and nation diagrams unchanged; the version-routing diagram was then regenerated for its baseline label and the Web PWA caller (see below). The domestic and world diagrams were first delivered on 2026-09-23. The 2026-09-24 gap review corrected both (gap SRV-8, plus a version annotation for SRV-1) and added the nation fan-out (SRV-9) and version-routing (SRV-1) diagrams; a QA pass regenerated the domestic and world artifacts on 2026-09-25. All four were authored with the installed Archify skill. Production application and native source files were not changed.

## Verification claims

- **Artifact:** all four final HTML files pass all 9 showcase checks with 0 composition errors and 0 warnings, per their delivery receipts. The SHA-256 values below bind the final specification and generated HTML bytes. On 2026-09-25 the integrator recomputed SHA-256 and byte counts for all eight on-disk files, again in the final round after the fixer lanes finished, and again after the re-baseline; every value matches its delivery receipt. No diagram changed in the final round; the domestic pair changed at the re-baseline.
- **Browser:** the final `visual-check` run for each diagram exited 0. Chrome measured containment, readability and viewer controls at 1440×900, 1600×1000, 1920×1080 and 2048×1320; every page fit its viewport without horizontal or vertical overflow, and the smallest projected node text was at least 6 px. The integrator read the four local receipts on 2026-09-25: `status: pass`, `diagnostics: []`, and an artifact SHA-256 equal to the delivery receipt. The receipts record `visualReview: pending` because perceptual review is a separate step, recorded per diagram below.
- **Perceptual review:** image-capable agent reviewers inspected at least one light and one dark capture of each final artifact, covering 1440×900 and 2048×1320 between them, and all four captures for version routing (details per diagram). This is agent review, not human sign-off.
- **Not established:** live weather correctness, server/database/provider behavior, present deployment, viewer search/focus/export interactions or mobile diagram usability. Static screenshots do not prove those interactions. Diagram labels that depend on runtime behavior (for example "string err → TypeError throw" or "HTML 500") are source or library readings, not reproductions.

## Artifact receipts

### Domestic — workflow

- HTML: [server-domestic-assembly.html](../../docs/rewrite/diagrams/server-domestic-assembly.html)
- JSON: [server-domestic-assembly.json](../../docs/rewrite/diagrams/server-domestic-assembly.json)
- Specification SHA-256: `c72b9d494fb3b06d37c81e604375b502e27f9d082e00a6fd82a03e08e5e4d8a2` (8023 bytes; before the re-baseline `68f3595c…`, 7956 bytes)
- Artifact SHA-256: `50d7d557a83e8d83f3c43f0b4e4e4b5d29d147199375b76be70d63f87a0bdfd7` (722418 bytes; before the re-baseline `affb58ad…`, 722343 bytes)
- Validation: [receipt](server-domestic-validation.json); final atomic [delivery receipt](server-domestic-delivery.json) (9/9, showcase pass, 0 errors, 0 warnings)
- `browser_evidence: passed` — local receipt `server-domestic-assembly.visual-check.json` (excluded from Git), rerun at the re-baseline: `status: pass`, no diagnostics, containment passed at 1440×900, 1600×1000, 1920×1080 and 2048×1320, smallest projected node text 8 px, artifact SHA-256 equal to the delivery receipt
- `visual_review: passed` — at the re-baseline the diagram owner (image-capable agent) viewed 1440×900 light and 2048×1320 dark of the regenerated artifact, and the integrator viewed 1440×900 light: readable, no clipping or overlap, the updated card text inside its cards. Before that, the QA reviewer had viewed the same two captures of the `affb58ad` artifact. The [local capture inventory](server-diagram-captures.md#server-domestic-assembly) still lists the captures of the superseded `affb58ad` artifact; the regenerated local PNGs have new hashes
- Content: 14 nodes (ten numbered stages with middleware item ranges, a `/coord` `coord2addr` pre-node, and an exits lane for 400 text/html, the 302 redirect and Express's final handler), 14 edges and 3 cards
- Revision history: 2026-09-23, two correction rounds; 2026-09-24, SRV-8 regrouping, branches and exits; 2026-09-25, QA added the version annotation to a card item and regenerated; 2026-09-25 re-baseline to `bd6640f2`: tags "current, history, station, opt-in ASOS" and "mid + past + short · dailyStatus", card items for publication age limits, the mid RSS retirement and `midData.dailyStatus`, then validated, delivered and visual-checked again

### World — sequence

- HTML: [server-world-cache-sequence.html](../../docs/rewrite/diagrams/server-world-cache-sequence.html)
- JSON: [server-world-cache-sequence.json](../../docs/rewrite/diagrams/server-world-cache-sequence.json)
- Specification SHA-256: `1a90bd02abf8a95edfc7a5b86b52630b9282e3dd4423847096cc25d730e6c082` (4333 bytes)
- Artifact SHA-256: `51465d81dd3167c7cc23ddc97f1752e814caa500970b865b5ccbf04e6c3d027e` (715088 bytes)
- Validation: [receipt](server-world-validation.json); final atomic [delivery receipt](server-world-delivery.json) (9/9, showcase pass, 0 errors, 0 warnings)
- `browser_evidence: passed` — local receipt `server-world-cache-sequence.visual-check.json` (excluded from Git); smallest projected node text 7 px
- `visual_review: passed` — QA reviewer viewed 1440×900 light and 2048×1320 dark of the final artifact; the longer AQI label clears its arrows. The earlier 2026-09-24 artifact was also reviewed at both sizes and themes, including a zoomed legend crop. [Local capture inventory](server-diagram-captures.md#server-world-cache-sequence)
- Content: six participants and 17 message entries (counted in the JSON on 2026-09-25), including the split DSF fill (current, time-zone cache read, Google on a miss, at most three history fetches, today) and one dashed error return that distinguishes `Error → next(err) → HTML 500` from `string err → TypeError throw`. Not drawn: the two AQI failures that do propagate through `async.parallel` to `next(err)` (a Mongo error in the prune step and a missing geocode); the AQI return is labelled "air or tolerated absence". The QA diagram lane left this as a bounded simplification because §5 step 4 of the [assembly text](../../docs/rewrite/server-response-assembly.md#5-world-weather-request-time-cache-fill-then-merge) states it
- Revision history: 2026-09-23, two correction rounds; 2026-09-24, three rounds (participant icon overlap; a wider 1140 viewBox failed desktop readability at 5.71 px; final 1080×669); 2026-09-25, QA label correction and regeneration

### Nation fan-out — sequence

- HTML: [server-nation-fanout.html](../../docs/rewrite/diagrams/server-nation-fanout.html)
- JSON: [server-nation-fanout.json](../../docs/rewrite/diagrams/server-nation-fanout.json)
- Specification SHA-256: `23d328bbbc8cd4ac20d2576340a90821a68d2d10ddf9492b758d75df078971b7` (4773 bytes)
- Artifact SHA-256: `f770a9ce494825385641fb04f0b8b9336ff7ecac329c33ca457e95338e8fe30c` (714244 bytes)
- Validation: [receipt](server-nation-validation.json); final atomic [delivery receipt](server-nation-delivery.json) (9/9, showcase pass, 0 errors, 0 warnings)
- `browser_evidence: passed` — local receipt `server-nation-fanout.visual-check.json` (excluded from Git); smallest projected node text 6.57 px at 1440×900
- `visual_review: passed` — the authoring agent viewed 2048×1320 light and 1440×900 dark: no overlaps, legible labels, a clearly dashed error lane and cards inside the viewport. [Local capture inventory](server-diagram-captures.md#server-nation-fanout)
- Content: six participants (App, CloudFront edge, Nation router, MongoDB, KMA chain, Final handler), 12 messages and 3 cards; the dated-evidence card states the 2026-09-20 API_SERVER observation and the 30-day aggregate correlation (88 × 15 = 1,320), which is not per-request proof. The cause of the 12 × 502 edge responses is not established
- Revision history: delivered 2026-09-24; the QA pass found no inaccuracy and left it unchanged

### Version routing — architecture

- HTML: [server-version-routing.html](../../docs/rewrite/diagrams/server-version-routing.html)
- JSON: [server-version-routing.json](../../docs/rewrite/diagrams/server-version-routing.json)
- Specification SHA-256: `b6934ba23f9a90721562c4ec421123cc10fe15e92bde563c2d077c59ae0295ce` (6828 bytes; before the re-baseline `48bed8f0…`, 6862 bytes)
- Artifact SHA-256: `b112cfcca7a21b9b958e86b28ad10980c303f3ceca06bd161a3d6937c70485a7` (719508 bytes; before the re-baseline `91a57418…`, 719374 bytes)
- Re-baseline 2026-09-25 (main session): the evidence card now reads `bd6640f2 (routes unchanged since ff7acf39)` and the App caller is `App + Web PWA`, because the new `web/` PWA calls `/weather/v000903/coord` through the same public host ([native consumers §5](../../docs/rewrite/native-consumers-and-plugins.md#5-non-native-consumer-web-pwa-web)). The first candidate sublabel failed Archify desktop readability (5.9 px < 6 px) and was shortened; validate and deliver then passed 9/9 with 0 errors and 0 warnings, visual-check exited 0, and the 1440×900 light and 2048×1320 dark captures were viewed
- Validation: [receipt](server-version-validation.json); final atomic [delivery receipt](server-version-delivery.json) (9/9, showcase pass, 0 errors, 0 warnings)
- `browser_evidence: passed` — local receipt `server-version-routing.visual-check.json` (excluded from Git); smallest projected node text 6.96 px at 1440×900. The first visual-check failed with vertical overflow at 1440×900 and 1600×1000; the title and card wording were shortened without removing facts, then the diagram was re-validated, re-delivered and re-checked
- `visual_review: passed` — the authoring agent viewed all four captures: no edge crosses a node, the dashed 302 edge is distinct, and cards are fully visible; the App and Lambda sublabels are tight but contained. [Local capture inventory](server-diagram-captures.md#server-version-routing)
- Content: 13 components (callers, AWS edge, service origin and five mounted chains), 13 connections and 3 cards (envelope by version, caller dependencies, evidence levels). Gateway facts are 2026-09-20 deployment observations; the 302 target version and push-worker runtime are unverified
- Revision history: delivered 2026-09-24; the QA pass found no inaccuracy and left it unchanged

## Capture portability

All Archify visual-check outputs (PNG, contact-sheet HTML and browser-receipt JSON), including renamed copies, are excluded from Git at the user's request. This is repository policy, not a Git retention requirement imposed by the skill. The [local capture inventory](server-diagram-captures.md) and [SHA-256 manifest](server-diagram-capture-manifest.json) preserve provenance only; they do not promise downloadable PNGs in a fresh checkout. Generated `.visual-check.html` contact sheets and their PNGs are local-only and excluded from Git. Open the main standalone diagram HTML for inline SVG. No delivered diagram HTML was edited by hand.

## Source checks and reproducibility

The KMA middleware appendix was extracted from `route.kma.v000903.js`; the DSF appendix from the v000902 handler mounted by v000903. Function-level claims were traced through both `controllerTown.js` and its `ControllerTown24h` overrides, then world DSF/AQI cache code. In the 2026-09-24/25 pass, the diagram writers and the QA reviewer checked about 158 diagram claims against source, including the router arrays (KMA 36/36/37 items per version, plus `coord2addr` on `/coord`; DSF 13 and 14), the `next(err)` call sites, the three-parameter `app.js` handlers, the DSF and time-zone controllers, the nation router and sido air read, widget icon paths, push-worker URLs and the traffic CSV rows. Relative documentation/source links were checked on disk.

Domestic JSON deliberately aggregates 37 middleware entries into ten numbered nodes; the extra coordinate-to-address step is route-specific. It does not depict all storage reads as parallel. DSF/AQI branch concurrency is explicit in the world JSON; provider replies and per-history retries are compressed in the visual and specified in the [text](../../docs/rewrite/server-response-assembly.md#5-world-weather-request-time-cache-fill-then-merge).

Rerun with the installed skill path (this run: `~/.agents/skills/archify/bin/archify.mjs`; substitute each diagram name and its type `workflow`, `sequence` or `architecture`):

```sh
ARCHIFY=~/.agents/skills/archify/bin/archify.mjs
node $ARCHIFY validate workflow docs/rewrite/diagrams/server-domestic-assembly.json --quality showcase --json
node $ARCHIFY deliver workflow docs/rewrite/diagrams/server-domestic-assembly.json docs/rewrite/diagrams/server-domestic-assembly.html --quality showcase --json
node $ARCHIFY visual-check docs/rewrite/diagrams/server-domestic-assembly.html --json
node $ARCHIFY validate sequence docs/rewrite/diagrams/server-world-cache-sequence.json --quality showcase --json
node $ARCHIFY deliver sequence docs/rewrite/diagrams/server-world-cache-sequence.json docs/rewrite/diagrams/server-world-cache-sequence.html --quality showcase --json
node $ARCHIFY visual-check docs/rewrite/diagrams/server-world-cache-sequence.html --json
node $ARCHIFY validate sequence docs/rewrite/diagrams/server-nation-fanout.json --quality showcase --json
node $ARCHIFY deliver sequence docs/rewrite/diagrams/server-nation-fanout.json docs/rewrite/diagrams/server-nation-fanout.html --quality showcase --json
node $ARCHIFY visual-check docs/rewrite/diagrams/server-nation-fanout.html --json
node $ARCHIFY validate architecture docs/rewrite/diagrams/server-version-routing.json --quality showcase --json
node $ARCHIFY deliver architecture docs/rewrite/diagrams/server-version-routing.json docs/rewrite/diagrams/server-version-routing.html --quality showcase --json
node $ARCHIFY visual-check docs/rewrite/diagrams/server-version-routing.html --json
```

On 2026-09-23 an initial sandboxed Chrome capture ended with SIGABRT; repeating the supported packaged command outside the sandbox succeeded, and no transport/renderer source was modified. Early authoring diagnostics rejected a backward workflow main path and an oversized sequence; the correction rounds above fixed the diagnosed issues. Current receipts refer only to the final delivered artifacts.

## Changed diagram files

- `docs/rewrite/diagrams/server-domestic-assembly.{json,html}` and `server-world-cache-sequence.{json,html}`: corrected canonical JSON and regenerated main HTML; the domestic pair again at the `bd6640f2` re-baseline, with a new delivery receipt (the validation receipt's content did not change).
- `docs/rewrite/diagrams/server-nation-fanout.{json,html}` and `server-version-routing.{json,html}`: new canonical JSON and generated main HTML.
- `reports/rewrite-verification/server-{domestic,world,nation,version}-{validation,delivery}.json`: artifact validation and delivery receipts.
- This report, the [local capture inventory](server-diagram-captures.md) and its [manifest](server-diagram-capture-manifest.json); PNG files and visual-check receipts are excluded.

Assumptions: source-level TodayWeather/TodayAir shared server behavior; direct Express routes are distinguished from public gateway paths. Remaining risks: historical provider contracts, live DB content, deployment differences, partial-success semantics and source quirks need isolated runtime characterization before implementation decisions.
