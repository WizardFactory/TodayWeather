# Provenance

- Source: https://github.com/openai/plugins/tree/981b02c0c44058b595f3b4180002c3ae3c806d40/plugins/test-android-apps/skills/android-performance
- Commit: `981b02c0c44058b595f3b4180002c3ae3c806d40` (fetched 2026-11-27)
- License: MIT, as declared by the plugin manifest plugins/test-android-apps/.codex-plugin/plugin.json (`"license": "MIT"`, author `OpenAI`). Upstream ships no license file at the repository root or in the skill directory, so this repository adds `LICENSE.txt` with the standard MIT text and that copyright holder. It composes with ../android-emulator-qa (installed alongside).
- Upstream files are copied unchanged (file modes included); `LICENSE.txt` and this file are the only additions. Repository rules for device targeting, downloads and outputs are in the root `AGENTS.md` (Android device and profiling skills) and take precedence over the skill text. Copied into this repository's canonical skill directory (`.agents/skills/android-performance/`) and linked from `.claude/skills/` and `.codex/skills/` (AK, 2026-11-27, after #3224). To update, replace the directory with a newer upstream copy and record the new commit here.
