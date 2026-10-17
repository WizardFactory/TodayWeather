# S19b: common native verification command

AK requested item 1 of the proposed S19 continuation: one repeatable execution/report path across KMA CORE/Rich, world, warnings, summary, state and workers. Parent #2704 stays open for remaining per-family/release recovery and operational gates.

- **RUN:** One command runs the declared existing checks in a stable sequence using explicitly supplied, hash-verified release artifacts. Operators can select a subset; the result states exactly what ran.
- **REPORT:** Each check records family, verification layer, capability/limits, actual command/time/exit, artifact identity and retained output references. Missing input, nonzero exit, invalid/missing output and zero matching tests cannot be PASS. A subset is never full coverage.
- **SAFE:** Use task-owned loopback peers and synthetic fixtures; no inherited operator settings/credentials, .env, production network/deploy/push, new runtime verification modes or arbitrary manifest commands. Preserve original checks/oracles. Output is a new caller-owned directory, not an overwrite of a previous run. Timeout stops only owned process groups and records failure.
- **PLACEMENT:** All paths match S19b.json. No runtime import/include/symlink/file dependency reaches legacy assets. Outside changes are documentation only; placement/dependency review must pass.

Authority: AK “1번 진행”, continuing the previously authorized scoped implementation, PR/review/CI and reviewed main integration. Source/task evidence may be shared with configured independent reviewers; no new accounts or permissions. Source recovery after unsupported/failed eligibility is not authorized by a PASS label. Binary profile/revision are caller-supplied provenance, hash checks are not a signed build attestation.

Exclusions: new product/runtime features, rewriting legacy oracles/shared peers, new live shadow traffic, whole-service earlier-release rollback qualification and S20 operational activation. Existing world coexistence fixture is labeled as such. Worker signal matrix and summary library checks remain distinct layers.
