# Server documentation and diagram verification

Source baseline: `ff7acf3996ccb66c912d2ed4710cf300197d6966`, inspected 2026-09-23. Authored using the installed Archify skill. Production application and native source files were not changed by this lane.

## Verification claims

- **Artifact:** both final HTML files passed all 9 showcase checks with 0 composition errors and 0 warnings. SHA-256 values below bind final specification and generated HTML bytes.
- **Browser:** both final `visual-check` commands exited 0. Chrome measured containment, readability and viewer controls at 1440×900, 1600×1000, 1920×1080 and 2048×1320; each page fit its viewport without horizontal or vertical overflow.
- **Perceptual review:** an image-capable reviewer inspected all eight final screenshots (two diagrams × light/dark × 1440×900/2048×1320). READ/Still view labels, arrows, numbered domestic order, parallel-branch annotation, legend and card text were visible with no clipping or crossing through unrelated nodes.
- **Not established:** live weather correctness, server/database/provider behavior, present deployment, viewer search/focus/export interactions or mobile diagram usability. Static screenshots do not prove those interactions.

## Artifact receipts

### Domestic — workflow

- HTML: [server-domestic-assembly.html](../../docs/rewrite/diagrams/server-domestic-assembly.html)
- JSON: [server-domestic-assembly.json](../../docs/rewrite/diagrams/server-domestic-assembly.json)
- Specification SHA-256: `aa98d4bbaf8e456033e1433612aa8c5c11523fbea123b08acb20ea07aaaa8b39` (4464 bytes)
- Artifact SHA-256: `b0600e11618c2697c62728bec95a876dc237cfdd52fff5a8a3d417b8c92f9d84` (710733 bytes)
- Validation: [receipt](server-domestic-validation.json); final atomic [delivery receipt](server-domestic-delivery.json)
- `browser_evidence: passed` — [receipt](server-domestic-visual-check.json)
- `visual_review: passed` — [local light/dark capture inventory](server-diagram-captures.md#server-domestic-assembly)
- `correction_rounds: 2` (candidate validation and visual refinements; final source is frozen)

### World — sequence

- HTML: [server-world-cache-sequence.html](../../docs/rewrite/diagrams/server-world-cache-sequence.html)
- JSON: [server-world-cache-sequence.json](../../docs/rewrite/diagrams/server-world-cache-sequence.json)
- Specification SHA-256: `c4bc6b53b3a62f2adbfe57ae36770cb92715f7d14ec8d28becf9664e35eeb20b` (2973 bytes)
- Artifact SHA-256: `4ea74da819ed4bbd5eb65ad45fdab15eef96d17e7091c018a1b6ccc4c3e5fc67` (710788 bytes)
- Validation: [receipt](server-world-validation.json); final atomic [delivery receipt](server-world-delivery.json)
- `browser_evidence: passed` — [receipt](server-world-visual-check.json)
- `visual_review: passed` — [local light/dark capture inventory](server-diagram-captures.md#server-world-cache-sequence)
- `correction_rounds: 2` (candidate validation and visual refinements; final source is frozen)

## Capture portability

Diagram verification PNGs are intentionally excluded from Git at the user's request, including the eight renamed report copies. The [local capture inventory](server-diagram-captures.md) and [SHA-256 manifest](server-diagram-capture-manifest.json) preserve provenance only; they do not promise downloadable PNGs in a fresh checkout. Generated `.visual-check.html` contact sheets and their PNGs are local-only and excluded from Git. Open the main standalone diagram HTML for inline SVG. Neither delivered diagram HTML was edited.

## Source checks and reproducibility

The KMA middleware appendix was extracted from `route.kma.v000903.js`; the DSF appendix from the v000902 handler mounted by v000903. Function-level claims were traced through both `controllerTown.js` and its `ControllerTown24h` overrides, then world DSF/AQI cache code. Relative documentation/source links were checked on disk.

Domestic JSON deliberately aggregates 37 middleware entries into ten numbered nodes; one extra coordinate-to-address step is route-specific. It does not depict all storage reads as parallel. World JSON contains six participants and twelve messages; DSF/AQI branch concurrency is explicit. Provider replies, per-history retries and error branches are compressed in the visual and specified in the text.

Rerun with the actual installed skill path:

```sh
node /Users/ak/.codex/skills/archify/bin/archify.mjs validate workflow docs/rewrite/diagrams/server-domestic-assembly.json --quality showcase --json
node /Users/ak/.codex/skills/archify/bin/archify.mjs deliver workflow docs/rewrite/diagrams/server-domestic-assembly.json docs/rewrite/diagrams/server-domestic-assembly.html --quality showcase --json
node /Users/ak/.codex/skills/archify/bin/archify.mjs visual-check docs/rewrite/diagrams/server-domestic-assembly.html --json
node /Users/ak/.codex/skills/archify/bin/archify.mjs validate sequence docs/rewrite/diagrams/server-world-cache-sequence.json --quality showcase --json
node /Users/ak/.codex/skills/archify/bin/archify.mjs deliver sequence docs/rewrite/diagrams/server-world-cache-sequence.json docs/rewrite/diagrams/server-world-cache-sequence.html --quality showcase --json
node /Users/ak/.codex/skills/archify/bin/archify.mjs visual-check docs/rewrite/diagrams/server-world-cache-sequence.html --json
```

Initial sandboxed Chrome capture ended with SIGABRT. Repeating the supported packaged command outside the sandbox succeeded; no transport/renderer source was modified. Early authoring diagnostics rejected a backward workflow main path and an oversized sequence. Ordered columns, neutral row labels, a semantically named legend and compacted timeline fixed the corresponding diagnosed issues. Current receipts refer only to the final delivered artifacts.

## Owned changed files

- `docs/rewrite/server-response-assembly.md`: route boundary, source precedence, joins, conditional envelopes and exact middleware appendix.
- `docs/rewrite/server-data-lifecycle.md`: producers/models, modes/schedules, storage formats, freshness/failure matrix and rewrite dependencies.
- `docs/rewrite/diagrams/server-domestic-assembly*`: canonical JSON, generated main HTML and browser JSON receipt (contact sheets and PNGs are local-only).
- `docs/rewrite/diagrams/server-world-cache-sequence*`: canonical JSON, generated main HTML and browser JSON receipt (contact sheets and PNGs are local-only).
- `reports/rewrite-verification/server-*`: artifact/browser receipts, documentation link/source check, this evidence report, a local screenshot inventory/manifest; PNG files are excluded.

Assumptions: source-level TodayWeather/TodayAir shared server behavior; direct Express routes are distinguished from public gateway paths. Remaining risks: historical provider contracts, live DB content, deployment differences, partial-success semantics and source quirks need isolated runtime characterization before implementation decisions.
