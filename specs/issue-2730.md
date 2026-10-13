Task: issue-2730-s10b; base d15ea118; date 2026-10-13. Intent: [S10b](../intent/issue-2730.md).

# Specification

Configuration (`server2::Config::from_env`, before the Tokio runtime and any bind):

| Gateway (`SERVER2_GATEWAY_LEGACY_URL` present) | `SERVER2_CONNECTION_SECONDS` | Result |
| --- | --- | --- |
| absent | absent | 9 s (foundation default, unchanged) |
| absent | 1..=30 | configured value (unchanged) |
| present | absent | 12 s (`GATEWAY_CONNECTION_SECONDS`) |
| present | 10..=30 | configured value |
| present | 1..=9 | error: lifetime must exceed the 9 s gateway deadline |
| any | 0, >30, non-numeric | existing range/parse error |

Gateway enablement uses the same presence test as `gateway::runtime::configured_gateway` (`env::var_os`). The deadline constant `gateway::PUBLIC_DEADLINE` (9 s) is the single source used by `Gateway::new`, `Gateway::with_limits` and the lifetime check. `listener.rs` and the private metrics listener's use of the selected lifetime are unchanged.

Errors keep the existing `main` path: `Config::from_env` error -> nonzero exit with the message on stderr, before `server2 public=... metrics=...` is printed.

Rehearsal: the S19 deadline probe uses the default gateway configuration (no lifetime override) in the mock and legacy phases. It compares the stalled-backend response with the S02 `gateway-deadline` record (status 501, body SHA-256, `cache-control`, `content-type`, `content-length`, `access-control-allow-origin`) and the 9 s timing. The pinned S19-GAP-1 check is removed. A refusal check starts the release binary with the gateway enabled and `SERVER2_CONNECTION_SECONDS=9` and requires a nonzero exit, the configuration message and no listener announcement.

Alternatives not selected (AK decision): exempting dispatched requests from the absolute lifetime (changes `listener.rs`); refusal without a raised default (forces every operator to set a value).

Verification: unit tests of the selection table; a release-process test of the refusal; full `cargo test`; foundation smoke with the gateway disabled; `deploy/smoke.sh` (gateway smoke, scenarios, replay, rollback with deadlines) on the release binary; placement gate; artifact policy.
