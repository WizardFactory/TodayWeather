# Graft setup verification — issue #2671

Observed 2026-10-03 on macOS with Node 20+, Python 3, installed Graft 0.21.1 and Codex CLI 0.159.2. Repository base: `e0b126c8f5c0872ae03c4e82f1d381feac3cbf52`. Scope and commands are maintained in the [setup guide](../../../development/graft.md) and [editable manual](../../../development/graft-manual.md).

| Acceptance | Execution and result |
| --- | --- |
| AC1 | Real installed-Graft smoke copied Git-visible focused sources into a fresh temporary Git repository. Build, freshness, server skeleton and client literal search passed; generated `graft/` was ignored and untracked. |
| AC2 | Eleven offline behavioral tests passed: relative canonical links, registry symlink/local package resolution, bounded missing-tool behavior, focused wrapper from a subdirectory, missing CLI guidance and active-worktree hook execution. Real guarded session-start and prompt adapters returned context; guarded MCP initialized and listed six expected tools. |
| AC2 | Isolated Codex app-server discovered four project hooks from the original repository while querying a linked worktree. Fresh account trust was untrusted. No real account config was changed by this test. |
| AC3 | Regression suite ran Red → Green → post-refactor. Initial Red exposed the missing build wrapper and unbounded package lookup; eight tests passed after correction. Additional real-tool smoke passed. No weather service, database, mobile build or provider call was started. Initial real-Graft smoke was later found to inherit HOME and miss automatic wiring mutations; that evidence does not establish configuration preservation. |

The first Codex fixture run returned no hooks because macOS `/var` and `/private/var` paths differed in its temporary trust entry. Resolving the fixture root before adding isolated trust corrected the fixture; the rerun passed. This does not change real account trust or host policy.

Selected [CLI captures and source hashes](../../../development/graft-manual-assets/manifest.json) retain the results used by the [PDF manual](../../../development/graft-manual.pdf). Captures render actual CLI text; they are not native terminal screenshots. The PDF was rendered with PyMuPDF because Poppler was unavailable, and each page was visually inspected. Raw execution logs and stage receipts remain under ignored `reports/sdlc/issue-2671/`.

Limitations: direct Claude hook/MCP execution establishes adapter behavior, not full conversation execution. Codex discovery establishes original-checkout selection and fresh trust, not automatic approval. Graft parser edges are navigation evidence; source verification and existing repository guidance remain authoritative. Account trust hashes, installed CLI, graph cache and private release configuration are not committed.

Initial branch-push artifact CI rechecked historical failures because GitHub supplied an all-zero before SHA. The workflow now uses the default-branch merge base for that case and still checks every outgoing commit. A real temporary Git-history regression passes a clean outgoing branch and rejects a generated report added then removed in outgoing history. The original CI failure remains retained locally; no historical gates were removed.

Independent review R1-F1/F3 reproduced upstream 0.21.1 automatic `init` replay in a fresh SessionStart. It also affected the review worktree and added unintended global Graft hooks/MCP entries. Those task-created global entries were privately backed up and removed, preserving unrelated user settings; the four changed review-worktree files were restored to its reviewed commit. The earlier broad no-user-change claim is withdrawn.

Final real-tool verification isolates HOME and CODEX_HOME, runs both host SessionStart commands before a graph build with absent and mismatched wiring stamps, and repeats guarded MCP startup for both stamp states. It asserts unchanged isolated user files and clean tracked repository files after hooks/MCP. The guard suppresses only the pinned package's automatic upkeep module; unsupported versions fail closed. Eleven offline tests include malicious-upkeep and unsupported-version regressions. Final guarded smoke passed without repository/config rewrites. Raw earlier failures and final evidence remain retained locally.

Re-review R2-F1 reproduced a symlinked global npm fallback whose URL differed from Node ESM’s resolved module URL. The guard now uses the real path before matching the upkeep module. A malicious-upkeep fixture on a symlinked global package root failed before correction and passed after it; eleven offline tests and renewed real guarded smoke passed.

### Paseo preparation follow-up (2026-10-04)

The new `worktree.setup` suffix invokes the focused wrapper after preserving the existing private-file setup. Paseo setup runs once at worktree creation; the named `graft-build` script refreshes existing workspaces. Six isolated regression tests cover creation, paths with spaces, old branches without the wrapper, missing CLI, build failure propagation and manual refresh. The existing ten synthetic private-file cases remain passing. The real installed-Graft smoke now runs the configured creation setup with an absent synthetic source path and the configured refresh command, checking unchanged isolated HOME and clean tracked files. Actual Paseo daemon script discovery listed `graft-build` as a plain script. No real private inputs were copied; a full managed worktree creation was not exercised by this check.
