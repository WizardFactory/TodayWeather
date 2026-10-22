# Structural fold PR plan

Stable task: issue-2849-structural-fold; owner root Codex. Stacked branch perf/2849-structural-fold targets fix/cold-build-speed-2849 at bd7122ae. Execution notebook: existing Phase 11 of 2026-10-22-issue-2849-uncached-forecast-build-speed; no competing notebook.

1. Reuse passing-before-change prototype characterization evidence. Keep failed naive experiment rejected. Productionize the checked fold in grid_fold.rs and move parser Node ownership.
2. Retain schema-cast Docs rather than raw Rows; verify ledger equivalence, eager loser errors, count/byte bounds, invalid dates, revisions, coordinate identities and Current isolation. Run unit/neighbor integration checks and isolated golden/native HTTP smoke.
3. Update architecture/operations and selected dated evidence. Regenerate the existing cold-read Archify flow; verify artifact, browser and screenshot separately.
4. Commit/push only clean implementation, tests and maintained docs. Create a dependent PR, independent required review plus optional reviewer attempts, correct findings and inspect CI. No merge.

Scenarios: S1 domestic user requests a cold forecast with overlapping publications; fixed full-window seed and no providers; invoke diagnostic/HTTP; all 13 view goldens and response bytes equal baseline. S2 caller reads malformed/oversized history; unit fixtures with bad dates, superseded row/byte overflow and DOCS boundary; same error/stop rule as baseline. S3 parser consumes escaped/scalar/duplicate/unknown keys and malformed pages; original Item oracle and bounded tests retain behavior. S4 operator inspects performance and rollback; evidence states actual revision/environment and unmet 2.5 s target; rollback this child PR only.

Placement: exact intended server2 and outside documentation paths are in server2/config/tasks/StructuralFold2849.json (declared before edits). No shared runtime or legacy exception. Generated runs stay under reports/sdlc/issue-2849-structural-fold. Before each build check free space/owned target, preserve exact executable before cleanup. No concurrent timing and compilation.
