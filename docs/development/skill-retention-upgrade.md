# Shared-skill retention upgrade guide

This repository change does **not** install or modify user-wide skills. The inspected canonical SDLC skill already contains an `artifact-retention.md` contract; preserve that work and compare its current behavior before proposing further edits.

## What to align

- **SDLC:** keep repository retention policy discovery, cleanup before final verification, and the repository's staged/outgoing/CI checker in the workflow and templates. Distinguish generated stage state from retained decisions and required evidence. Preserve independent verification, full required findings, candidate identity, iteration history and readiness gates. Ignoring files must never waive those requirements.
- **Planning-with-files:** keep named ignored notebooks for execution/recovery. At handoff, promote useful knowledge and required evidence into their canonical homes. Do not force-add planning state or introduce another competing plan.
- **Archify:** honor installed delivery and recovery contracts. Keep source JSON and delivered HTML; distinguish portable evidence from location-bound receipts. Preserve pending journals/locks and active provenance; never silently delete or hand-edit them to make checks pass. Repository artifact/browser/visual requirements remain applicable.

## Installation and verification

1. Resolve the current skill and policy paths. Keep one canonical copy under `~/.agents/skills/<name>/` for user scope, with links from Codex and Claude. Do not create repository-specific copies merely to encode these output paths; use [the repository policy](artifact-retention.md).
2. Change only demonstrated gaps across the entrypoint, normative policy, workflow, verification reference and relevant templates. Preserve unrelated settings and hooks. If the old shared-policy path is absent, follow the installed skill's normative policy instead of creating a divergent copy.
3. Evaluate both Codex and Claude on an isolated representative task: generated output remains ignored; staged/local mismatch is detected; resume preserves state/counters; independent findings remain distinct; required evidence is retrievable after removing local reports. Test a local-only task without external storage as well.
4. Verify actual discovery and execution in both hosts. Symlinks, installed files or text matching alone do not prove behavioral success. Record host/version, task, observed files/checks and remaining gaps.

Do not add automatic deletion or publication to skill hooks. Repository pre-commit/pre-push hooks report violations; the agent performs deliberate cleanup before verification. Shared-skill execution and cross-provider review were not performed by this repository cleanup.
