# Graft integration specification (#2671)

Owner/date: Codex root / 2026-10-03. Input: [intent](../intent/issue-2671.md); base e0b126c8. Status: PROCEED, configuration-only integration.

AC1: provide a repository-root-aware build wrapper with fixed --only-dir selections for server, client/www/js, client/scripts, web/src, packages, scripts and infra. It calls installed Graft without --deep or credentials and fails clearly when the CLI is absent. Queries/freshness use the resulting graph; generated graph stays ignored.

AC2: retain the Graft 0.21.1 upstream skill text as a single repository snapshot with relative Codex/Claude links. Shims resolve the installed CLI through PATH, local package and standard global lookup; avoid private absolute paths. Bound fallback process lookup, and treat missing Graft as a silent no-op. Configure timeouts in seconds. Hook commands resolve the current repository, preserving unrelated settings. Include features.hooks=true in project Codex configuration to match the original-checkout setup. Linked-worktree discovery follows Codex's original-repository contract; trust stays a user action, never stored in repository artifacts.

AC3: add behavioral adapter tests without a provider key; real smoke builds a fresh graph, verifies server/client retrieval, MCP handshake/six tools/freshness and actual hook context output using the installed package. Document tested versions, setup/build/refresh, indexed and unsupported paths, missing-tool behavior, hook activation, relative links and safe updates. Preserve AGENTS/CLAUDE guidance and weather runtime; commit no credentials, user hashes, raw reports or generated graphs.

Failure/recovery: wrapper missing CLI -> nonzero diagnostic, no auto-install; hooks missing package -> exit 0, no context; no shim in an unrelated linked worktree -> no-op; fresh graph missing -> contributor runs wrapper before agent use. Do not broaden indexing silently or run collection. Plain upstream init is not a migration tool because it overwrites repository adaptations and can write global settings.

Verification: regression fixtures exercise actual shim invocation and wrapper subprocess behavior. Integration uses isolated local repositories and installed CLI; retained output describes actual coverage, never implies live Claude/Codex model task execution. No server/API/model/storage change; architecture diagrams and product runtime tests are not applicable. User manual captures the CLI integration, not weather UI.
