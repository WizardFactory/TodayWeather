# server2 design verification — 2026-10-06

Scope: documentation-only proposal for [#2614](https://github.com/WizardFactory/TodayWeather/issues/2614),
against source baseline `182f4fd745fdfebe95092d186cead8f8a17242ab`.
No Rust server, provider call, deployment, golden parity, shadow replay or
measured S3 latency is claimed. The maintained design is
[server2.md](../../../architecture/server2.md); its future checks are in
[the plan](../../../../plans/issue-2614.md).

## Content checks

- Parsed the design's method/path/count table and compared all entries with
  [the accepted historical CSV](../../aws/api-traffic-2026-09-22-routes.csv):
  exactly 19 groups and 220,583 requests. Low-volume and failed-only groups are
  included. `/ww` remains outside that report's scope.
- Recalculated the initial cold-latency scenarios from waves, bandwidth and CPU
  allowances. The old 19-wave case is 2.34–4.24s; direct catalogs use 11 waves
  and yield 1.54–2.64s; prepared-pack examples yield 0.84–1.44s. These are
  arithmetic scenarios from server2 receipt to assembly, excluding transit,
  queues, repairs and provider/geocoder acquisition, not measured percentiles.
- Independent Claude review selected R1–R7 for correction: dominant coordinate
  geocoder cold cost/burst, fetch-group visibility, failed-only fixtures, world
  grid privacy, catalog-version growth, prior-wave breakdown and attempt budgets.
  The amended design adds four illustrative geocoder-inclusive ranges
  (1.74–3.64, 2.14–5.04, 1.04–2.24 and 1.44–3.64s), a 195,350-request/88.56%
  coordinate-weather share, a 162,206 non-Hit workload proxy, and explicit
  average-vs-peak quota limits. The example five-minute average is about 19
  requests, not a measured replacement burst. Catalog-version sizing and the
  three/five/nine-second timeout chain are independently recalculated too.
- Inspected raw/catalog publication, revision folding, cancellation, privacy,
  warning expiry, summary completeness and Spot replacement boundaries against
  the linked issue amendments and current source. Remaining runtime decisions
  and unexecuted tests are explicitly retained in the design.
- Whitespace checks passed for maintained Markdown/JSON. The full staged diff
  reports whitespace-only lines emitted by the Archify HTML renderer; the
  generated HTML is preserved as delivered and checked by Archify rather than
  hand-edited. Staged and outgoing artifact-policy checks verify maintained
  links and retention before publication.

## Diagram checks

The [JSON](../../../architecture/diagrams/server2.json) and
[HTML](../../../architecture/diagrams/server2.html) represent the **proposed**
system. They do not assert that new server2 components exist in the baseline.

Initial diagram at `e72f01ad` (before review corrections):

| Artifact | SHA-256 |
| --- | --- |
| Source JSON | `d80858cb5bf951da651ead19ec243aaebcac6df89e91677fff6da8427ea6f3c2` |
| Delivered HTML | `b6d3f0e602b361663a00a81b5037fd0e8b53aaf0a74c60d06c5312e2b1c685fe` |

Executed using the installed Archify CLI:

```sh
archify finalize architecture docs/architecture/diagrams/server2.json docs/architecture/diagrams/server2.html --quality showcase --out-dir .archify/architecture-server2-20261006/check-2 --json
archify browser-check docs/architecture/diagrams/server2.html --out-dir .archify/architecture-server2-20261006/browser-retry --json
archify visual-check docs/architecture/diagrams/server2.html --out-dir .archify/architecture-server2-20261006/visual-1 --summary --require-provenance
```

Deterministic validation, delivery and strict artifact checks passed. The first
candidate's inappropriate baseline-evidence annotation was removed because the
proposal document is not present in the old commit. The corrected finalize
run then encountered a sandbox Chrome pipe failure; browser-only retry on the
same HTML in the browser-capable context passed, with current provenance.
This recovery is distinct from a passing initial finalize run.

Automated browser checks passed at 1440×900, 1600×1000, 1920×1080 and 2048×1320.
Actual light/dark screenshots at both endpoint sizes were inspected: readable
labels, separated nodes/edges, no clipping or viewer-control collisions. No
geometry correction was needed after inspection. Browser checks and perceptual
review are separate evidence, neither proves runtime behavior.

Review-corrected diagram (source and HTML regenerated, not patched):

| Artifact | SHA-256 |
| --- | --- |
| Source JSON | `0ce7b6159a4dbca4f98ec6b4da831f99b75bb65bc2d32d24a80e48be95d31150` |
| Delivered HTML | `75883ee3b639e52805c9cdfa23f82093f206b96a1fef12a1aede88149c058c9c` |

The same finalize command with output directory
`.archify/architecture-server2-20261006/review-correction` passed all four gates
(validation, delivery, strict artifact and browser). Visual-check in `visual-2`
captured the corrected artifact at the same four light/dark endpoint states;
actual screenshots were inspected and remained readable with no collisions.
Prior failures remain historical evidence and are not relabeled as passing.

## Retention and handoff

This selected verification summary, design, editable diagram and delivered HTML
are repository evidence retained with the PR. Disposable execution logs,
full local receipts, screenshots and the adjacent delivery sidecar remain local
under `reports/` and `.archify/` or as recovery metadata. The PR review record
retains reviewer configuration, exact reviewed revision and findings in GitHub.
Maintained links do not depend on those local files or expiring CI artifacts.
Independent review and remote checks are reported on the PR, not pre-claimed
by this pre-commit summary.

## Placement and subtask follow-up (2026-10-06)

AK broadened placement from Rust source to every new server-equivalent asset
under `server2/` and authorized publishing the 21 required tasks plus one
conditional raw-pack task. Root agent instructions, architecture, intent/spec
and plan now define per-task paths, bounded outside exceptions and the common
completion check. S04 must implement the local/CI placement gate before later
implementation tasks; this documentation amendment introduces no checker or
runtime code. Manual path/dependency review applies before that gate.

The runtime topology, data flow, latency arithmetic, route inventory and diagram
JSON/HTML are unchanged; existing diagram evidence is reused only for those exact
artifacts. New instructions require a fresh independent review; earlier PASS and
CI refer to their previous heads. The linked task index in the maintained plan
is the tracker map. S01 reconciles pending choices; issue creation does not
authorize production changes or imply that pending decisions are accepted.

## S01 decision handoff (2026-10-06)

AK approved demand-limited hourly and 2-minute rainfall capture, immutable raw
gzip with versioned identity-catalog CAS, raw/group publication before new
success and valid memory or existing error/fallback during S3 outages. Optional
packs need measured benefit; no lifecycle deletions are selected now. The
[actual decision record](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6009156640)
reconciles O-1…O-13 and preserves S18 state, privacy activation, provisioning,
measurement and cutover prerequisites. Exact remote comment readback passed.

The diagram topology is unchanged. Its decision cards were updated and HTML
was regenerated through Archify. Validation, delivery and strict artifact
checks passed; the initial browser check hit a sandbox Chrome pipe failure.
A browser-only recovery on the same HTML passed. Visual-check captured four
light/dark endpoint screenshots; the author inspected them for readable labels,
separation and clipping. This is document evidence, not runtime verification.

| Current artifact | SHA-256 |
| --- | --- |
| server2.json | `9f5ed6b6487d8390ce97d7582a50539f2a0e0a9f8c110dd39ed070ac74effbaf` |
| server2.html | `793a72a3e7246d61b63220c41f5f9a1a708a02992d535ab91e2c781197b8ab91` |

Executed commands used the installed Archify CLI with distinct output folders:

```sh
archify finalize architecture docs/architecture/diagrams/server2.json docs/architecture/diagrams/server2.html --quality showcase --out-dir .archify/architecture-server2-20261006/s01-decision --json
archify browser-check docs/architecture/diagrams/server2.html --out-dir .archify/architecture-server2-20261006/s01-browser-recovery --json
archify visual-check docs/architecture/diagrams/server2.html --out-dir .archify/architecture-server2-20261006/s01-visual --summary --require-provenance
```

The new foundation has a separate task/branch/PR; no Rust code, live capture or
production switch is included in this documentation PR.

## Cold-cell and demand-state correction (R16/R18)

The [parent clarification](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6009294236)
and actual S14/S20/S21 issue bodies preserve legacy fallback for never-requested,
resumed-after-more-than-8-days and partial S3 histories. Retirement is blocked
until equivalent history is available; keeping legacy collectors retains their
quota and operational cost. Demand identity is grid/time/expiry only under
state/demand/grid/, without precise coordinates or personal/request identifiers.
All four remote bodies were read back exactly. S01 is now completed as a
decision task; PR review, S04 runtime and cutover are separate gates.

The diagram's cold-cell/privacy cards were regenerated; topology is unchanged.
The complete finalize run in cold-cell-fix passed validation, delivery, strict
artifact and real browser gates. Four fresh light/dark captures in cold-visual
were inspected. No runtime or provider test is claimed by this correction.

| Corrected artifact | SHA-256 |
| --- | --- |
| server2.json | `6de43f7645ada89872a3a1d6e39a4543a9f66903c7ea1df38060e8dd33ffe72a` |
| server2.html | `ecb6cdb8950bcc993230d14a526461b62e146fe89c8f170ae72ecfbe0f0400a6` |
