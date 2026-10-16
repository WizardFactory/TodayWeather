# Rust build artifact cleanup guidance

AK requested cleanup of completed agents' Rust build output after disk exhaustion, and repository guidance for future Rust work. Add one shared section to [AGENTS.md](../AGENTS.md); preserve all existing instructions.

- GUIDANCE: tell Rust workers how to budget/reuse targets, select verification flags and report cleanup.
- SAFETY: protect active/shared consumers, source, fixtures, required executables and evidence; clean only verified regenerable paths after completion.

Scope: canonical AGENTS.md plus this intent, a separate spec and plan. No runtime code, Cargo profile defaults, tools, hooks, modes, credentials or production changes. Review/push/CI and reviewed main integration use AK's existing authorization. Required independent review remains mandatory.
