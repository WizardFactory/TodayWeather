# Spec: Android performance skills

Consumes [intent](../intent/android-perf-skills.md).

1. Skills live at `.agents/skills/{jetpack-compose-performance,android-profiler,anr-audit-and-fix,r8-analyzer}` (android/skills `7f7b21730a605d112ca9f79b6e40105ce7b670ee`, Apache-2.0) and `.agents/skills/{android-performance,android-emulator-qa}` (openai/plugins `981b02c0c44058b595f3b4180002c3ae3c806d40`; manifest license MIT, `android-emulator-qa` ships Apache-2.0).
2. Upstream files are unchanged, file modes included; each directory adds `PROVENANCE.md` (source URL, commit, license, pointer to the AGENTS.md rules) and, for android/skills, the repository's `LICENSE.txt`. `android-performance` adds `LICENSE.txt` with the MIT text and the copyright holder its manifest declares (OpenAI), since upstream ships no license file (review round 1, CODEX-1).
3. `.claude/skills/<name>` and `.codex/skills/<name>` are relative symlinks to `../../.agents/skills/<name>`. No hooks are needed (no skill declares any).
4. AGENTS.md gains "Android device and profiling skills" (review round 1, CODEX-2, CODEX-3, GEM-3). It overrides the skill text instead of patching the copies: emulator-only targets with `ANDROID_SERIAL` passed to every command, no downloaded Perfetto helper scripts (the device's `perfetto` plus the bundled hash-checked `trace_processor`, run with `python3`), default device paths, outputs under ignored `reports/`, Python packages in a temporary venv, and `r8-analyzer` Path A only.
