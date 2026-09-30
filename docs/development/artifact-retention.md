# Artifact retention

Keep maintained knowledge, reusable tools and selected evidence in Git. Generated execution output belongs under ignored directories.

| Content | Location |
| --- | --- |
| Current behavior and architecture | `docs/architecture/` |
| Operating procedures and rollback | `docs/operations/` |
| Selected dated observations and verification evidence | `docs/evidence/` |
| Reusable verification programs | `scripts/verification/` or existing test suites |
| Reference screenshots and fixtures | Their existing documented locations, with manifests |
| Stage state and raw runs | `reports/sdlc/<task>/`, `reports/verification/<suite>/` |
| Planning and diagram scratch | `.planning/`, `.archify/` |

Retain evidence when a maintained claim, an accepted reference baseline, an incident/release decision or required verification depends on it. Record date/revision, commands, environment and limitations. Do not move entire execution directories into `docs/evidence/`. Preserve active gate inputs and Archify recovery/provenance files until their consumers finish. Intent/spec/plan documents keep their existing locations.

## Before commit and push

1. Reconcile useful findings into maintained docs, select necessary evidence, and fix references before final verification. Keep generated files out of the proposed commit; preserve local bytes.
2. Run relevant checks. Stage only intended files and verify the actual index. Any relevant edit requires restaging and renewed checks.
3. Check actual outgoing commits before push. A report added and later removed in an unpublished series is still part of that series.

```sh
python3 scripts/check-artifact-policy.py --staged
python3 scripts/check-artifact-policy.py --range <base-commit> <tip-commit>
python3 scripts/verification/test_artifact_policy.py
```

The checker reads Git blobs, checks maintained Markdown/HTML links and screenshot manifests, and rejects tracked local-output paths. It does not check every prose claim, external link, source-line anchor or runtime behavior. Link scanning covers `.md`/`.html` under `docs/`, `intent/`, `specs/`, `plans/` and `scripts/verification/`, plus root `README.md`, `AGENTS.md`, `CLAUDE.md` and `server/test/offline/README.md`. Other documents under `web/`, `client/` and `server/` are outside this gate; validate those with their relevant package checks. Code examples are excluded from link checks. It never modifies files/index, starts a service, fetches remote data or uploads evidence.

The committed `scripts/artifact-policy.json` identifies the last pre-policy baseline. Its ancestors remain historical evidence, not retroactive violations. Each outgoing commit after that boundary and the selected tip are checked. Missing base objects cause an incomplete-check failure; fetch the needed history explicitly and retry. For a new branch in `--pre-push <remote>`, commits already reachable from that named remote’s local tracking refs are excluded; the selected tip is always checked. Refresh those refs with an explicit fetch before pushing if they are stale. With no tracking refs, or a direct URL instead of a configured remote name, checking conservatively falls back to the history boundary. Explicit `--range` checks (including CI) retain their supplied range: remote refs fetched after a push must not hide its intermediate commits. Blob bytes are cached by object ID across snapshots during one invocation.

## Local hooks and CI

The versioned `.githooks/pre-commit` and `pre-push` call the same checker as the **Repository artifacts** workflow, which also runs for documentation-only changes. Installation is explicit:

```sh
python3 scripts/install-artifact-hooks.py
python3 scripts/install-artifact-hooks.py --check
```

The installer preserves existing hooks/configuration. Repository-local `core.hooksPath` also affects linked worktrees; install only when those worktrees contain the hook files. No global hooks are installed. Hooks only reject/report; they do not delete, rewrite, stage or invoke an agent. Local hooks can be bypassed. CI becomes a merge requirement only when its check is configured in remote rules; adding this workflow does not change those rules or prevent a bypassed push.

## Generated results and intentional publishing

Web browser screenshots use `reports/verification/web/screenshots`; client smoke uses `reports/verification/client/payment-removal`. Rewrite validation prints results by default; `--output reports/verification/rewrite/package-validation.json` saves a local report. Captures use `reports/verification/rewrite/captures` or an external directory.

`build-gallery.py`, `add-native-captures.py` and `rebaseline-anchors.py --write` are explicit reference/document publishing operations, not read-only checks. Review their intended changes and provenance. Run capture server/evaluator copies only inside a prepared isolated harness.

Web diagnostic CI artifacts are retained for 30 days, subject to repository limits. Existing deployable web artifacts retain their separate 90-day rollback policy. The task owner preserves essential evidence in selected tracked records or an authorized durable task record before disposable artifacts expire or a worktree is removed. Do not publish unrelated/private files with a broad upload of `reports/`.

See the [migration record](../evidence/README.md) and [shared-skill upgrade guide](skill-retention-upgrade.md).
