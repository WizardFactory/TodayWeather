# Independent verification — forecast and air correction

Verdict: **PASS**. HOTL: **PROCEED**. Assignment `forecast-qa-1`, verifier `/root/forecast_qa`, builder `/root`.

Candidate `sha256:d6c491b860eb783fcb366fc7c5092de8e5a4980156d3a0041f9ddbdd4884435a`, base `84bb1af88eefa5e152da61142d9999443c0d1bfe`. All 11 frozen source/document/test hashes matched before and after verification. Source files were not changed. Full consumed input hashes and executed checks are in [qa.json](qa.json).

## Findings and acceptance

No mandatory defect found. AC1–AC5 are supported for this local correction; publication is owned by main and is not asserted here.

- **AC1:** Examined merge precedence and independently checked a year-end midnight collision with missing temperature/wind/icon/text, valid zero probability/snowfall, three-hour rain fallback and one-hour snow override. Accumulation amounts/durations stayed paired. Shortest-only data remains visible; malformed dates are omitted, minute values sorted, and reordered distinct timestamps produce identical normalized output. Existing DSF coverage remains green.
- **AC2:** Summary is string-only and bounded. Browser checks confirm provider markup renders as inert text, no synthetic station/grade is introduced, and the observation-time caveat appears in both affected views. Numeric observations remain primary. A subsequent response without a summary removes the old summary. A 390px mobile screenshot was inspected: wrapping and caveat are readable, with no horizontal overflow.
- **AC3:** Independent snapshot matrix accepted legacy records and exactly 500 characters; rejected null/object/array/boolean/number/blank/overlength values and expired records. The affected browser scenario verified offline summary persistence and notices.
- **AC4:** Source/document changes agree: mixed KMA periods, timestamp union, text-only fallback and optional snapshot shape. Diagram source changes only the explanatory browser-normalization card; generated HTML hash matches the frozen manifest. Main's diagram artifact/browser/visual evidence is reused; QA did not regenerate the artifact.
- **AC5:** Independently reran typecheck and all 55 unit/API tests, both changed static-browser scenarios, plus independent domain and mobile browser probes. Main's full 16-scenario smoke is supplemental evidence, not reported as independently rerun.

## Evidence

- [55 unit/API tests](qa-tests.txt), [typecheck](qa-typecheck.txt), [two static browser scenarios](qa-browser.txt).
- [Independent domain results](qa-domain-probe.json) and [reproducible probe](qa-domain-probe.mts).
- [Independent mobile results](qa-browser-probe.json), [probe](qa-browser-probe.mjs) and [mobile fallback screenshot](qa-air-fallback-mobile.png).

No rebuild, live upstream fetch, AWS action, native build, Git mutation or deployment was performed. Test fixtures deliberately cover stale/unverified wording and do not establish provider freshness. This report is independent local QA, not cross-provider PR approval or authorization to merge/deploy.
