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
- Recalculated every cold-latency scenario from its waves, bandwidth and CPU
  allowances. The old 19-wave case is 2.34–4.24s; direct catalogs use 11 waves
  and yield 1.54–2.64s; prepared-pack examples yield 0.84–1.44s. These are
  arithmetic scenarios from server2 receipt to assembly, excluding transit,
  queues, repairs and provider/geocoder acquisition, not measured percentiles.
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

## Retention and handoff

This selected verification summary, design, editable diagram and delivered HTML
are repository evidence retained with the PR. Disposable execution logs,
full local receipts, screenshots and the adjacent delivery sidecar remain local
under `reports/` and `.archify/` or as recovery metadata. The PR review record
retains reviewer configuration, exact reviewed revision and findings in GitHub.
Maintained links do not depend on those local files or expiring CI artifacts.
Independent review and remote checks are reported on the PR, not pre-claimed
by this pre-commit summary.
