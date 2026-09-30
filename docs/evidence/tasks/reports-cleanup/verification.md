# Repository cleanup verification

Local cleanup prepared on 2026-09-30 from `a5fdde1f`. Shared-skill changes are guidance only; no user-wide skill/configuration update, issue update, commit or push was performed in the working repository.

## Preserved material

- All 652 original report files remain locally with their original SHA-256 values; none remain in the proposed Git index.
- 143 selected files were copied to maintained operations/evidence or reusable verification tools. [Migration mapping](../../report-migration.json) identifies the original bytes and destinations; other records remain retrievable in the baseline Git tree.
- All 74 reference screenshots retain their bytes and manifest hashes. Three missing operator-contract links now lead to a clearly reconstructed checklist. [Historical source-link repairs](../../source-link-repairs.json) retain available revisions for removed files and retired line ranges without asserting current behavior.

## Executed checks

- `python3 scripts/verification/test_artifact_policy.py`: 16 tests passed after intended initial missing-rule failures. Includes staged/unstaged disagreement, force-added outputs, local-only references, transient outgoing files, multiple/new/deleted refs, missing objects and index/worktree preservation.
- `python3 scripts/verification/smoke_artifact_hooks.py`: six scenarios passed using actual hooks, commits and pushes in temporary local Git repositories. Existing hook configuration was preserved; fixtures were removed.
- `python3 scripts/check-artifact-policy.py --staged`: passed on the proposed index.
- `python3 scripts/verification/rewrite/validate-package.py`: JSON/Python syntax, local references, source line ranges, screenshot hashes/dimensions/diagnostics and gallery consistency passed.
- A temporary checkout of the staged candidate initially contained no reports. Checker, validator, capture help, two source probes and JavaScript syntax checks passed in 19 invocations; eight Python files parsed. Tracked content stayed unchanged. Initial macOS export encountered the old `KR.png`/`kr.png` aliases; both have the same Git blob, and force materialization in a new temporary checkout preserved the bytes with clean status.
- Six original/relocated Node probes were compared. Four succeed in both locations. Two retain their pre-existing incompatibility with newer source; see the [probe baseline and limits](../../../../scripts/verification/rewrite/probes/README.md).
- `git diff --cached --check`: passed.

## Boundaries

This is local verification, not remote CI or a release approval. Current worktree hook configuration remains opt-in; installation and actual execution were exercised in isolated fixtures. Required-check settings were not changed. No native build, live provider, production operation or Codex/Claude skill execution was performed. Historical reports were relocated, not re-certified. Independent verification is recorded separately.

The initial independent review found two required fixes (local `file:` links and probe result paths) and two navigation/usability recommendations. All four were corrected; the [initial findings](independent-verification-initial.md) are retained separately from the follow-up verdict. Added regression cases failed before the fixes and passed afterward; the reviewer’s five isolated edge cases and six real-hook smoke scenarios also passed.

[Independent follow-up: PASS](independent-verification.md) closes F1–F4 against the corrected candidate. Publication of these reports is evidence-only and receives a separate final staged link/content check; it does not change the independently verified implementation.
