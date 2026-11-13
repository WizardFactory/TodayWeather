# Bounded seven-day verification supervisor

Task: issue-2614-shadow-supervisor. Parent PLAN_ID: 2026-11-07-issue-2614-kma-client-validation. Owner: Codex /root. Endpoint: pre-merge. Initial dependency: PR #2947 at bb75a6d65817ac4d75034c0849febde6563b3d44 (independent review PASS; CI pending at intake).

AK approved HOTL qualification, 168 hours, at most 6,000 production GET/HEAD attempts, one temporary host, USD35 AWS and USD5 paid APIs before tax. AK subsequently explicitly waived shared-key headroom/instrumentation proof and asked moderate existing-key use. No new key/account, production deployment, device sends, unbounded retries, second host, or deferred CI improvement.

Provide a reviewable operator that runs the existing paired reader on one owned temporary server, preserves source evidence and finishes independent cleanup even when collection fails. Its default mode is offline planning. Historical benchmark approval/state is immutable and cannot authorize this run.

- BIND: Before collection and after a planned restart, verify the exact candidate/configuration and that the owned loopback listener belongs to that process; native read modes and disabled device delivery are explicit.
- LIFETIME: One durable run identity and deadline survive interruption. Reserve mutation intent before AWS actions and reconcile an uncertain launch by its existing client token. No replacement host. Host-local expiry works without the coordinator; collection plus cleanup stays inside the accepted time envelope.
- BUDGET: Preserve all accepted traffic, paid spending and resource ceilings using observed counters or a documented conservative bound. Missing/stale required accounting stops collection. Keep provider quota protections and classify quota-limited coverage as incomplete; do not reintroduce waived shared-headroom proof.
- SOURCE: Retain the actual raw/catalog/product bytes and version identities needed to explain judged responses, with hashes and original timestamps; missing originals are not inferred from a later provider fetch. Bounded export is verified before deletion and any loss is explicit.
- CLEANUP: Stop acquisition, export evidence, remove only resources proven owned by this run and independently verify absence. AWS permission/transport/parsing errors cannot be interpreted as absence. Preserve cleanup eligibility after partial creation, expiry, cancellation or coordinator restart.
- PLACEMENT: New operational implementation/configuration/tests belong under declared server2 paths. No legacy runtime asset imports; only exact named documentation/intent/spec/plan paths outside server2. Shared build target and unrelated root changes remain untouched.

This task implements supervision and evidence handling, not a qualification PASS or production cutover. Any runtime instrumentation change discovered to be necessary requires explicit scope assessment, its own relevant tests and review before dependent launch; it must not be hidden in an operations-only claim.
