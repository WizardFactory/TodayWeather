# Plan: Android performance skills

Consumes [intent](../intent/android-perf-skills.md) and [spec](../specs/android-perf-skills.md).

| # | Change | Check |
| --- | --- | --- |
| 1 | Copy six skill directories unchanged; add PROVENANCE.md and LICENSE.txt | `diff -r` against the upstream clones (only the two added files differ) |
| 2 | Symlinks in `.claude/skills` and `.codex/skills` | `ls -la`; links resolve |
| 3 | Behavioural evaluation in both hosts | fresh `claude -p` / `codex exec` sessions: list skills; read-only `jetpack-compose-performance` review; emulator-only `android-performance` gfxinfo capture (ANDROID_SERIAL pinned) |
| 5 | Round-1 review: MIT `LICENSE.txt` for android-performance; AGENTS.md device/profiling rules; PROVENANCE pointers | `diff -r` vs upstream (only added files differ); fresh Claude and Codex sessions asked to plan an emulator gfxinfo/Perfetto capture with a phone also attached state the emulator pin and no helper download |
| 4 | Artifact policy | `python3 scripts/check-artifact-policy.py --staged` |

## User scenarios

| ID | User and goal | Steps | Expected | Failure |
| --- | --- | --- | --- | --- |
| S1 | Agent asked to review Compose performance | Open Claude or Codex in the repo; ask for a Compose performance review | The host loads `jetpack-compose-performance` and cites its references | Skill not found or not applied |
| S2 | Agent asked to measure jank on an emulator | Ask for a gfxinfo/Perfetto capture of a flow | The host loads `android-performance` (+ `android-emulator-qa`), uses the pinned emulator only | Wrong device, or skill not used |
| S3 | Maintainer updating a skill | Read PROVENANCE.md | Source, commit and license are recorded | Unknown origin |
