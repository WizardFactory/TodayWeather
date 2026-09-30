# Self-verification

Verdict: PASS for the local issue #2554 wind repair. Builder /root; exact production identity in candidate.json. No commit, push, PR publication, merge or production action.

| Check | Actual result | Retained evidence |
| --- | --- | --- |
| Pre-edit regressions | 42 cases: 38 intended failures, 4 passes; exit 1 | red.txt |
| Minimal-fix green | 42/42; exit 0 | green.txt |
| Final post-refactor regressions, TZ=UTC | 43/43; exit 0 | post-refactor.txt |
| Publication/service checks, TZ=America/Los_Angeles | 43/43; exit 0 | timezone.txt |
| Additional real response middleware smoke, TZ=UTC | 36/36; exit 0 | smoke.txt, smoke-evidence.json |
| Independent regressions and response smoke | 43/43 and 36/36; no mandatory findings | independent-verification.md, independent-smoke.json |
| Collection diagram | 9/9 artifact, browser four desktop sizes, inspected light/dark screenshots | diagram-validation.json, diagram-delivery.json, diagram-browser.json, design-validation.md |
| JavaScript syntax, diff whitespace, architecture links | passed | document-check.json |

Production source remained byte-identical after green. The final regression suite adds publication-boundary assertions; test snapshots are separately hashed in the build receipt. No fake breakage was introduced for red. Initial node --test subprocess output was unhelpful in this host; direct node execution of the built-in test runner produced the retained 42-case red. Temporary Node dependencies for smoke are async 2.5.0, express 4.13.4, sprintf 0.1.5 and xml2js 0.4.23; no repository dependency changes.

## Acceptance coverage

- AC1: all eight wdEn mappings, unknown/absent handling and independent wfEn preservation.
- AC2: all eight numeric wd sectors, north zero, rejected 8/fraction/nonfinite/null/string values, wind speed normalization and unit conversion.
- AC3: invalid sources preserve base values including absent wav/uuu/vvv; field-specific sentinels and real negative temperature.
- AC4: newer/equal/older, first/single future row, current/past preservation, midnight KST matching and response 24:00 presentation; actual tmn/tmx source guards.
- AC5: both actual DB projection functions and complete 38-step KMA middleware; three synthetic grids with asserted query coordinates; two unit combinations. Actual downstream shortest merge and separate current/shortest/RSS publication fields exercised.
- AC6: architecture source and delivered HTML updated; separate independent context verified the candidate; limits retained.

## Functional smoke boundary and limitations

The additional smoke executes real XML parsing, RSS collector, both storage read/projection paths, actual Express coordinate routing in process, all KMA middleware, unit conversion/descriptions and JSON serialization. It is materially separate from the regression suite. Storage/provider/config/clock boundaries use synthetic values. It does not test Mongo persistence, app.js startup/session middleware, live HTTP transport, providers, mobile, origin or CDN. The legacy npm test/e2e suites include external integrations and were not run.

The unchanged collector calculateTime shifts forecast dates on non-UTC hosts. Baseline and candidate function hashes and timezone reproductions match in collector-timezone-limitation.json. UTC is a prerequisite for the full collector smoke; alternate-TZ regression success applies to publication conversion/service matching, not collector date invariance. Verify the gather process timezone or repair this separately before claiming deployment-level pipeline correctness.

No historical DB rows were backfilled. wdEn=-1 historical rows persist until normal refreshed collection; service uses numeric wd independently. Jeju live HTTP 500 and nationwide/provider freshness remain unverified. After separately approved deployment, compare origin/CDN responses and publication fields across grids; no deployment was performed here.
