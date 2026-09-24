# Completion: issue #2554

Endpoint: local implementation and verification complete. Source remains uncommitted on juicy-goose; no remote publication, PR, merge, production restart/deployment or DB write.

Fixed both confirmed RSS defects: collector wdEn assignment and service ws/wd mapping with tested numeric-sector-to-degree conversion. Selected RSS sources cannot erase usable base fields when missing/sentinel/nonfinite. Newer/equal/older policy retained. Covered first future slot and correct maximum-temperature source validation in the same block.

AC1–AC6 passed for the scoped local repair. Evidence: [self-verification](self-verification.md), [independent verification](independent-verification.md), [retention mapping](retained-evidence.md), [candidate identity](candidate.json), [test results](test-results.json), and [artifact index](artifacts.json). Regression 43/43; separate real XML-to-KMA-router-to-JSON smoke 36/36 on two DB formats, three synthetic grids, three publication policies and two unit combinations. Independent agent reran checks with no mandatory findings. Diagram artifact checks 9/9, real-browser containment four sizes and light/dark visual inspection passed separately.

The full response smoke is in-process with synthetic external/model boundaries, not live HTTP/Mongo/provider/CDN/mobile verification. Full legacy npm/e2e integration suites were not run. Existing records are not migrated/backfilled. Historical Jeju HTTP failure is outside this fix.

Follow-up: unchanged collector calculateTime is only validated in UTC; baseline and candidate both shift forecast slots on non-UTC hosts. See [reproduction evidence](collector-timezone-limitation.json). Before separately approved deployment, verify gather process TZ=UTC or repair that separate issue. Then compare origin/CDN and several grids, distinguishing RSS/current/shortest freshness. No production-host timezone claim is made here.
