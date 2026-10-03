# Graft setup verification — issue #2671

Observed 2026-10-03 on macOS with Node 20+, Python 3, installed Graft 0.21.1 and Codex CLI 0.159.2. Repository base: `e0b126c8f5c0872ae03c4e82f1d381feac3cbf52`. Scope and commands are maintained in the [setup guide](../../../development/graft.md) and [editable manual](../../../development/graft-manual.md).

| Acceptance | Execution and result |
| --- | --- |
| AC1 | Real installed-Graft smoke copied Git-visible focused sources into a fresh temporary Git repository. Build, freshness, server skeleton and client literal search passed; generated `graft/` was ignored and untracked. |
| AC2 | Eight offline behavioral tests passed: relative canonical links, registry symlink/local package resolution, bounded missing-tool behavior, focused wrapper from a subdirectory, missing CLI guidance and active-worktree hook execution. Real session-start and prompt adapters returned context; MCP initialized and listed six expected tools. |
| AC2 | Isolated Codex app-server discovered four project hooks from the original repository while querying a linked worktree. Fresh account trust was untrusted. No real account config was changed by this test. |
| AC3 | Regression suite ran Red → Green → post-refactor. Initial Red exposed the missing build wrapper and unbounded package lookup; eight tests passed after correction. Additional real-tool smoke passed. No weather service, database, mobile build, LLM request or provider call was started. |

The first Codex fixture run returned no hooks because macOS `/var` and `/private/var` paths differed in its temporary trust entry. Resolving the fixture root before adding isolated trust corrected the fixture; the rerun passed. This does not change real account trust or host policy.

Selected [CLI captures and source hashes](../../../development/graft-manual-assets/manifest.json) retain the results used by the [PDF manual](../../../development/graft-manual.pdf). Captures render actual CLI text; they are not native terminal screenshots. The PDF was rendered with PyMuPDF because Poppler was unavailable, and each page was visually inspected. Raw execution logs and stage receipts remain under ignored `reports/sdlc/issue-2671/`.

Limitations: direct Claude hook/MCP execution establishes adapter behavior, not full conversation execution. Codex discovery establishes original-checkout selection and fresh trust, not automatic approval. Graft parser edges are navigation evidence; source verification and existing repository guidance remain authoritative. Account trust hashes, installed CLI, graph cache and private release configuration are not committed.

Initial branch-push artifact CI rechecked historical failures because GitHub supplied an all-zero before SHA. The workflow now uses the default-branch merge base for that case and still checks every outgoing commit. A real temporary Git-history regression passes a clean outgoing branch and rejects a generated report added then removed in outgoing history. The original CI failure remains retained locally; no historical gates were removed.
