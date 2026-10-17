# Execution plan (#2798)

Owner: Codex /root. Consumes intent and specification; target pre-merge.

1. Write credential-free expected-behavior regressions (AC1/AC2): valid date/text, duplicate/new publication, no-data/expiry/malformed, key rotation/exhaustion, log safety and optional reader behavior. Record intended Red.
2. Implement isolated narrative helper, requester safe strict mode, collector last-step wiring, type 5 and response handling under server/lib, server/models, server/controllers. Preserve legacy warnings and push.
3. Green, existing warning/key regressions, post-refactor rerun; separate loopback provider → actual Mongo/Mongoose → actual route HTTP smoke (AC3).
4. Update docs/architecture/weather-collection.md, kma-warnings Archify source/HTML, docs/operations narrative runbook and API usage manual with actual capture/PDF. Add offline runner and CI smoke invocation. No server2 or client edits.
5. Reconcile path/dependency scope; staged and outgoing artifact policy checks; commit/push PR, mandatory independent review with optional Grok/Gemini; fix selected findings and verify CI. Leave unmerged.

SC1: legacy user, seeded warning rows and new provider publication; run scheduled gather then GET special; expect [4,1,2,3,5], Korean narrative and true UTC announcement. Failure: invalid/old narrative omitted, warnings remain. Tests: regression + Mongo/HTTP smoke; AC1/AC2/AC3.
SC2: operator with dummy configured keys; first key rejected then valid key, repeat/new publication, all rejected; expect bounded calls, one row per publication, no secrets in errors. Tests: regression + HTTP smoke; AC1/AC3.
SC3: API consumer, clock crosses exact 24h boundary or optional DB query fails; GET endpoint; expect existing types intact and no fresh-looking narrative. Tests: regression + smoke; AC2/AC3.

Riskiest part: KST legacy storage and expiry. Could break: older type ordering/parser, offline VM tests and key rotation conventions. Reject HTML scraping and replacing getWthrInfo because official source is separate. No migration required. Live rollout and origin/public readback remain blocked on separate operator approval and do not close #2798.

Generated records: reports/sdlc/issue-2798 and .planning/issue-2798; maintained intent/spec/plan/docs/tests only in commits. Preserve verification inputs and Archify recovery. No Rust builds/cache cleanup.
