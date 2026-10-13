# S10b execution plan

Owner: S10b builder (Claude); base d15ea118; 2026-10-13.
Inputs: [intent](../intent/issue-2730.md), [spec](../specs/issue-2730.md). Exact paths and reasons: [S10b declaration](../server2/config/tasks/S10b.json).

Order: declaration -> Red (release-process refusal test in `tests/foundation.rs`; rehearsal expecting the default-configuration 501, run against the unchanged binary) -> Green (`Config` lifetime selection, `gateway::PUBLIC_DEADLINE`) -> unit tests of the selection table -> fmt/clippy/full test -> foundation smoke (gateway disabled) and `deploy/smoke.sh` on the release binary -> docs and regenerated PDFs from actual runs -> placement gate and artifact policy -> commit/push/PR/CI -> Codex review and corrections -> pre-merge readiness. No merge.

Rollback: revert the PR. Operators who need the old timing can set `SERVER2_CONNECTION_SECONDS` explicitly only with the gateway disabled.

## User scenarios

### LIFETIME-1 (AC1, AC4)
User: server2 operator. Goal: run the gateway with defaults and keep the legacy deadline contract. Prerequisites: release binary, loopback legacy origin. Steps: 1. start with `SERVER2_GATEWAY_LEGACY_URL` and no `SERVER2_CONNECTION_SECONDS`; 2. stall the backend; 3. request `/weather/v000903/coord/...`. Expected: 501 `Not Implemented`, `no-store`, at about 9 s. Failure: a closed connection or a non-legacy body fails the rehearsal.

### LIFETIME-2 (AC2)
User: server2 operator. Goal: learn about an unsafe lifetime at startup. Steps: start with the gateway enabled and `SERVER2_CONNECTION_SECONDS=9`. Expected: nonzero exit and a message that the lifetime must exceed the 9 s gateway deadline; no listener is bound. Failure: the process starts serving.

### LIFETIME-3 (AC3)
User: server2 operator without the gateway. Goal: keep the foundation service unchanged. Steps: run `tools/smoke.py` (2 s and 9 s lifetimes, gateway disabled). Expected: existing PASS lines. Failure: any foundation assertion fails.

### LIFETIME-4 (AC5)
User: operator reading the guides. Goal: configure the lifetime correctly. Steps: read the gateway, foundation and smoke/shadow guides. Expected: they state the 12 s gateway default, the refusal and the closed S19-GAP-1. Failure: a guide still describes the open gap or a 9 s gateway default.
