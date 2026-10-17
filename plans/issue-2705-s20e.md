# S20e execution plan

Issue2809; base9333d196; endpoint reviewed main integration. Root owns this branch,
state and the pinned notebook at `.planning/2026-10-13-server2-next-sequence-after-s10/`
in the coordinating workspace. [Intent](../intent/issue-2705-s20e.md) and
[specification](../specs/issue-2705-s20e.md) are the maintained contracts.

## Order and paths

The exact path list is `server2/config/tasks/S20e.json`, declared before code.
No deletion, legacy edit or production operation is planned.

1. Capture frozen legacy object/alias/error behavior using a named test-only
   recorder under server2. Run an intended failing assertion of the absent
   native behavior before implementation. Preserve the Red output.
2. Add strict parsing/mapping and first-write S06 single-record publication;
   test competing writers, ambiguity, corruption and bounded discovery. Keep
   ordinary catalog union unchanged.
3. Add per-API funded background acquisition and bounded S3-only reads/cache.
   Wire runtime construction and process-owned delayed/cancelled lifecycle.
4. Decorate domestic/national JSON and cap both response writers before
   HEAD/conditional handling. Strip nested city narratives. Preserve existing
   route/unit/golden behavior and all warning/push state.
5. Run green, post-refactor and an additional release smoke against owned peers;
   restart with providers disabled for S3-only recovery. Record each actual
   layer and limitation, exact source/binary hashes and no live-send claim.
6. Update inventory, architecture, editable manual/PDF and actual captures;
   check placement, artifact retention, formatting/lint and affected regressions.
   Independent eligible review and fresh CI precede expected-head main merge.

## Risk, alternatives and rollback

This can affect public JSON cache validators, optional latency, process shutdown
and shared S3 admission. The riskiest part is first-committed identity across
competing publishers, followed by expiry on HEAD/304. Separate tests cover both.
Request-triggered provider work, warning-state reuse and normalized S3 views are
rejected as described in the spec. Schema-compatible immutable raw/index entries
are retained on code rollback; never rewind claims/state or replay sends. An
eligible complete production rollback bundle is a later task and is not proven
by this increment.

## Gates and evidence

Scenario IDs in the SDLC `user-scenarios.json` map five outcome criteria to
contract, acquisition, recovery, failure and integration checks. A failed build
or missing environment is not a test Red. Preserve input revisions and source
digests, original failures, chosen captures and complete required review records.
Manual source and PDF must describe actual local behavior and separate all
production/shadow/quota/host/device limits. S01 accepted per-API quotas and
raw/index storage decisions, S02 oracle and S04 placement remain in force.
No new operational authority is assumed. Continue later widget, complete-bundle
rollback and environment work only within their existing boundaries.

## Verification repair during build (plan iteration 3)

Two whole-suite runs retained local loopback failures; the serial run includes
macOS TCP `AddrNotAvailable`/code49. Declare the four domestic test paths in
S20e before changing high-read call sites to the existing `Peer::persistent()`.
Keep default peer/framing tests, admission/socket limits, test assertions and
production transport unchanged. This is a verification dependency repair,
not a global network setting or a looser weather deadline.

An additional owned-peer fault exposed acceptance of success JSON with HTTP201.
PR2805's strict requester requires200. Preserve that Red, reject non-200 in the
narrative source and retain the actual provider content type in S06 metadata.
Renew funded-source/real-smoke checks and the final candidate identity. Earlier
partial tests and whole failures remain separate records, not relabelled PASS.
