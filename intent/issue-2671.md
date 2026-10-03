# Share Graft repository integration (#2671)

Owner: Codex / root. Date: 2026-10-03. Source: [issue #2671](https://github.com/WizardFactory/TodayWeather/issues/2671) and AK's request to publish the Graft issue and proceed to pre-merge. Mode: implementation; kind: configuration; endpoint: pre-merge.

The existing Graft setup is local and uncommitted. Contributors need one reproducible repository setup for focused code search and Codex/Claude integration.

- **AC1:** A fresh checkout builds the focused graph and retrieves representative server/client code with installed Graft; generated graph files remain untracked.
- **AC2:** Both hosts resolve a single canonical skill and portable tool adapters. Linked-worktree Codex hook discovery is reproducible; unavailable Graft does not break agent operation.
- **AC3:** Reusable checks and setup documentation explain supported scope, activation and failures without changing weather runtime or user-level configuration.

Scope: repository skill snapshot/links, host configuration and shims, focused build command, offline checks, real CLI/MCP smoke, setup manual and selected verification evidence. Preserve existing guidance; source inspection and architecture rules outrank generic upstream skill recommendations. Keep generated data, credentials, personal paths and persisted trust hashes out of Git.

Authority: implement/test/smoke/commit/push/create-update PR/read CI/correct/post issue updates and transfer scoped code/tests/evidence to existing independent reviewer contexts. GitHub uses existing hwanjjang authentication. Author execution is local-codex (OpenAI); eligible alternate review is configured local-claude (Anthropic), with independent fallback contexts under the SDLC policy. Default reviewer effort medium, effective auto/full within existing permissions. No account enrollment, permission-setting changes, merge, auto-merge, merge queue or production action.

Known limits: deterministic parsers cannot prove every dynamic JavaScript call edge, index extensionless/Objective-C source or establish deployed behavior. Hook trust is personal and depends on exact hashes. Codex 0.159.2 discovers linked-worktree hooks from the original checkout. No weather collection, provider request, mobile build or production verification is required by this tooling change.

Intent gate: PROCEED within the explicit pre-merge scope; final readiness requires current review and CI. Consumers: specification, builder and reviewer.
