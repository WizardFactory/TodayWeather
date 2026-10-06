# S03 implementation plan

Inputs: [intent](../intent/issue-2688.md), [spec](../specs/issue-2688.md),
[S03 paths](../server2/config/tasks/S03.json). Endpoint pre-merge only.

1. Declare exact paths and record S01/S04 gates. Write expected contract tests first.
2. Implement bounded volatile S3 subset, immutable recorded-provider replies and
   local stack launcher. Coordinate wire shape with S05 without importing it.
3. Add staging JSON templates and operator prerequisites, reconcile latest AK
   decisions in the architecture/parent plan and regenerate the existing diagram.
4. Run Red, Green, post-refactor, then distinct subprocess stack smoke with the
   release Rust binary. Check placement, Rust foundation checks, artifacts and links.
5. Capture actual CLI results, render/visually check manual PDF, commit/push/create
   PR, then root dispatches actual independent Claude review. Do not merge/close.

| Scenario | User / goal / prerequisites / actions | Expected result and failure | AC / proof |
| --- | --- | --- | --- |
| L1 | Developer builds release binary, starts stack, reads ready endpoints, requests health/provider, PUTs then HEAD/GETs gzip | Exact fixture/bytes, metadata and local-only addresses; unrecognized provider is rejected | AC1; integrated subprocess smoke |
| L2 | Storage developer uses test credentials, submits wrong MD5 then two concurrent conditional PUTs, injects committed-response fault and reconciles GET | Bad MD5 rejected, one create/one 412, durable-within-process committed bytes visible; no overwrite on bad CAS | AC1; wire contract tests and smoke |
| L3 | Operator sends SIGTERM with active peers then checks all child PIDs and listeners | Owned processes exit within bounded drain; ready file retired; no unrelated process killed | AC1; separate stack smoke |
| L4 | Operator prepares staging account/region/bucket/role/separate keys and measures proposed 2-vCPU/4-GiB Spot on target Linux | Ready-for-approval worksheet; missing prerequisites block deploy, no local result relabeled AWS measurement | AC2; content/template checks and manual |
| L5 | Implementer adds local configuration and updated policy docs then runs full placement gate | Exact declaration passes, no outside runtime or legacy asset dependency | AC3; checker and manual dependency review |

Temporary namespace: server2-s03-* with OS-selected ports and owned PIDs. Existing
Rust fmt/clippy/tests/release smoke reused because runtime source is unchanged.
New tests reject capability absence as intended Red; missing toolchain is setup
failure. Root authorized the exact additive server2/tools/ci.py pairing of local
tests before Cargo checks and stack smoke after release checks in amendment
[6016603807](https://github.com/WizardFactory/TodayWeather/issues/2688#issuecomment-6016603807).
S03 owns that declared edit; S02 retains workflow/checker ownership. Raw runs/state/planning and Archify captures stay ignored; selected
CLI screenshot, manifest/manual and concise verification stay durable. Artifact
checker runs against the staged snapshot and exact outgoing base..head range.

Rollback is stop local stack/remove test configuration; production rollback is a
future per-family approved switch with cold-cell legacy fallback and CloudFront
rehearsal. AWS resources and live routing are untouched.
