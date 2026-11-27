# Spec: Android performance skills

Consumes [intent](../intent/android-perf-skills.md).

1. Skills live at `.agents/skills/{jetpack-compose-performance,android-profiler,anr-audit-and-fix,r8-analyzer}` (android/skills `7f7b21730a605d112ca9f79b6e40105ce7b670ee`, Apache-2.0) and `.agents/skills/{android-performance,android-emulator-qa}` (openai/plugins `981b02c0c44058b595f3b4180002c3ae3c806d40`; manifest license MIT, `android-emulator-qa` ships Apache-2.0).
2. Upstream files are unchanged; each directory adds `PROVENANCE.md` (source URL, commit, license) and, for android/skills, the repository's `LICENSE.txt`.
3. `.claude/skills/<name>` and `.codex/skills/<name>` are relative symlinks to `../../.agents/skills/<name>`. No hooks are needed (no skill declares any).
4. Repository guidance (AGENTS.md) is unchanged: its rules already cover skill placement.
