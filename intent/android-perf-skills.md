# Intent: Android performance skills for agents in this repository

- Task: `android-perf-skills`. Mode: implementation. Change kind: configuration (agent skills). Endpoint: **main** — AK, 2026-11-27: "premerge까지 진행하고, 문제 없으면 머지". No product code, release or device-state change.
- Source: after #3224 (tab-switch jank), AK asked for Android performance skills, then: "저장소의 `.agents/skills`에 두고, Claude와 Codex 양쪽에 연결한 뒤 동작을 확인해줘". Scope chosen by AK: Google's official `jetpack-compose-performance`, `android-profiler`, `anr-audit-and-fix`, `r8-analyzer` and OpenAI's `android-performance` (it composes with `android-emulator-qa`, installed alongside).

## Acceptance criteria

- **AC1** Each skill has one canonical copy under `.agents/skills/<name>/`, byte-identical to its upstream source at a recorded commit, with its license and a `PROVENANCE.md`; `.claude/skills/<name>` and `.codex/skills/<name>` link to it (as graft does).
- **AC2** Both Claude Code and Codex discover all six skills in this repository and execute them: a read-only code review with `jetpack-compose-performance` and an emulator `gfxinfo` capture with `android-performance`, without touching the attached phone.
- **AC3** The repository's artifact policy passes and no product file changes.
