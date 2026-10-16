# S20a execution plan
Owner: S20a builder 3f7316e0; named notebook .planning/issue-2705-s20a; local artifact index reports/sdlc/issue-2705-s20a. Inputs: [intent](../intent/issue-2705-s20a.md), [spec](../specs/issue-2705-s20a.md). PRE-MERGE only.

Exact paths and outside reasons: [S20a.json](../server2/config/tasks/S20a.json). Root approved gateway/backend.rs Option<legacy> and source/mod.rs shared WarningStore additions before dependent edits. No other author tree/state writes or dev agents. Root coordinates reviewer slot. No new dependencies or legacy assets.

1. Retain actual Red of current native-only constructor/lifetime and disconnected API behavior.
2. Build handle bundle and optional legacy dispatcher; one S3/WarningStore/feed; inject feed before Arc.
3. Add typed NativeFetch and public route composition; use same constructor from main/process and loopback harness.
4. Green/post-refactor focused runtime suites, existing gateway/state/notices/warnings/delivery regressions; separate actual HTTP smoke. All compilation uses shared lease, target /private/tmp/tw-s15b4c-target, jobs2/debug0/incremental0, 3GiB cutoff.
5. Update operations/architecture and Archify source/generated HTML; actual usage capture and rendered inspected PDF. Reconcile retained evidence then fmt/all-target Clippy/S04 placement/S02 goldens/artifact staged and outgoing checks.
6. Commit/push, own task PR, current CI and independently eligible review. Normal merge notice-main when root provides base; never merge task PR or deploy.

## User scenarios
- HTTP1 (AC1/AC4): operator injects owned S3 peer and synthetic keys, selects push/notice, starts same production constructor; PUT registration then restart and POST list sees durable state. Notice GET empty yields null, active publication respects lang and headers, unreadable cold store yields503. Failure: success before durability, missing headers, translation/provider call or lost registration.
- NATIVE1 (AC2/AC4): push preparation uses logical internal origin; KMA address/DSF coordinates/geocode dispatch to shared native handlers. Assert version/query/language and timeout; foreign origin, traversal, unsupported version or absent handler fails with zero legacy calls.
- FEED1 (AC3/AC4): request-driven warning gather durably publishes zone then shared feed; failed publication does not create success event, feed failure remains retryable, restart reads durable feed. Constructor alone does not collect or send.
- CONFIG1 (AC1/AC4): native-only selection starts without legacy, preserves12s; empty selection without legacy stays foundation; explicit legacy URL keeps unselected gateway behavior.

Riskiest boundary: public family selection versus internal push dependency construction. Reject self-HTTP and fake legacy origin. Reuse existing module parity/failure tests; add actual production-factory HTTP coverage. Preserve selected sanitized evidence under docs/evidence/tasks/issue-2705-s20a independent of expiring CI artifacts. S20b owns full drain and delivery supervision.
