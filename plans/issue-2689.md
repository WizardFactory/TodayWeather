# S04 implementation plan

Owner: S04 builder. Endpoint: unmerged PR against feat/2614-server2. Pinned execution
ledger: `.planning/issue-2689-s04/` (local generated state).

1. Test-first Rust contract tests and synthetic Git placement fixtures; record intended
   failures before implementation. Compile missing foundation API counts as intended red.
2. Build library/binary, validated config, shared bounded state and separate listeners.
   Implement checker and exact S04 declaration, then wire CI without changing old jobs.
3. Run green and post-refactor fmt/clippy/workspace/placement tests. Build release,
   execute separate real process loopback smoke and invalid-config startup.
4. Record actual operator usage capture; editable manual/PDF visually checked.
5. Stage intended paths, retention/placement checks, commit/push/PR and CI. Root
   orchestrates independent Claude review; fix selected findings, no merge.

Operator scenario: start isolated release binary, query health/public metrics/internal
metrics, stop with SIGTERM; exact health OK, metrics isolated, graceful exit. Nonloopback
metrics config must fail before serving.
Contributor scenario: declare paths, run checker for tracked layout and base diff;
allow exact docs and named legacy recorder wiring; reject misplaced server-equivalent
assets, rename outside boundary and legacy dependencies even if unchanged.
Concurrency scenario: exhaust admission/CPU reservations, cancel CPU await while work
continues, then release; no unbounded queue, permit retained until work finishes.
Root findingS04-A2: add an isolated runtime fixture holding a real CPU closure,
assert shutdown returns within its bound and release/wait for closure cleanup.
Retain no test CPU HTTP route. Update manual/PDF to distinguish listener5s drain,
runtime1s wait and the separate foundation connection-age limit.
Claude findings S04-R1–R8 all selected. Add full-Git escaped/raw/matched-hash/plain
literal controls, executable non-Rust reference and exact fixture-role exemption
checks, plus workflow action/timeout tests. Run new cases against checker bytes from
`git show cf8b8447:server2/tools/check_placement.py` for genuine red before fixing.
Remove CORS on private metrics; add public503 admission assertion. Real release
smoke verifies socket-cap rejection/recovery, elapsed slow headers and signal-forced
partial-header drain. Regenerate actual usage manual/PDF and re-review new head.

Root S04-A4 (R3): future S02 declaration metadata naming its allowed legacy recorder
must pass. Validate every task declaration, exempt only valid outside.path identities,
and retain failures for invalid/blanket declarations and runtime config resources.

Actual r2 selects R9/R10/R11: compile harmless outside include/path-module/Path/Command
fixtures, then assert placement rejection; run against exact65ecc5e checker for Red.
Use comment/string-aware bounded Rust tokens, all macro delimiters/nested path
attributes and retained Rust-wide legacy guard. Audit executable/shebang scripts.
Preserve owned controls and all previous fixes; full CI, distinct smoke/manual QA
and exact new-head review remain required.
