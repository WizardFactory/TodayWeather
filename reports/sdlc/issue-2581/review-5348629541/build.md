# Review 5348629541 correction

Recommendation1 is addressed: `_parseDateTime` is shared by freshness, hourly slot generation and24:00 normalization. Charts use25fixed hourly steps and KST formatting, independent of host DST. Both detail paths retain a fresh02:00KST value on an LA spring-forward date; autumn, leap-day and year-end regressions preserve slot count and dates.

Recommendation2 requires no change here: master remains d4858b59 and this PR is mergeable. Existing offline workflow/runner tests remain intact; a later conflicting PR must rebase and retain both test sets.

The new test failed against85b5da31 specifically because the LA chart ended at06:00 instead of05:00. After correction the focused test passed. Full offline runner passed onNode16.20.2 and22.22.2. A distinct real Express loopback smoke passed on both runtimes underUTC,Asia/Seoul,America/Los_Angeles, retaining both fresh graph values in both detail methods. Existing stale omission and asynchronous error behavior passed. Archify artifact/browser checks passed and main inspected the generated light screenshot.

No changes to provider policy, collection or deployment. Recovery remains#2636. Rollback is reverting this correction; no storage migration. Independent verification and final PR review are recorded separately after candidate testing/commit.

Candidate: `sha256:4727d660921f6f4f3ae351cf01444ee784dd92ecfadb6acd6e5da779fa090269`.
