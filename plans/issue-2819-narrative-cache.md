# Narrative cache fix plan

Owner OpenAI /root; base `d35ca94535078383bb03cb79eb818d44b1fd6362` (D1 parent, not integrated main). Canonical notebook remains `.planning/2026-10-13-server2-next-sequence-after-s10` in the root workspace. Exact paths declared in NarrativeCache2819.json before dependent edits. Endpoint pre-merge only, including authorized tests/commit/push/PR/native independent review/current CI; no merge or live operational action.

1. Trace cache Result flattening, Store deadline and public attach path; select existing-owner minimal error distinction and check the proposed cache flow.
2. Add public-service regression using failing/late index transport then success/absence; demonstrate immediate next request is wrongly cached on old code. Preserve negative cache for genuine absence, per-office isolation and fresh/expired semantics.
3. Preserve Result until after error handling before cache mutation; no new cache owner or retry mechanism.
4. Additional owned S3 scenario publishes a real narrative, injects one slow index read within a short request deadline, then reads immediately via the same public service. Disclose injected delay, actual S3 readback, synthetic source and owned-child cleanup. No provider or production proof.
5. Run targeted narrative, runtime/router and unaffected contract checks plus fmt/clippy, placement/artifact/links. Preserve known whole-domestic/D2 negatives without unrelated retests unless new concern.
6. Update docs/selected evidence/checked diagram, commit/push stacked PR, required independent review and exact CI. Reconcile any later base change. Keep #2819/#2704/#2705 open.

Risk: confusing storage error with confirmed absence, or accidentally removing legitimate negative caching. Test both opposing outcomes. Rejected: disabling all negative cache (unnecessary S3 load), new retry timer or stale-on-error (changes accepted behavior). Small existing-interface sketch; no independent design panel claim. Rollback restores code, never rewinds S3. User scenarios: caller retries immediately after a short failed read and gets recovered stored prose; caller reads a genuinely empty office twice and storage is scanned once. Failure remains optional per request with no cache poison.
