# Artifact retention specification

Consumes [intent](../intent/reports-cleanup.md).
Maintained facts belong in docs/architecture or docs/operations, selected historical evidence in docs/evidence, reusable tools in scripts/verification. Raw reports and planning state remain ignored and locally preserved. Keep existing reference screenshots and product diagram sources/HTML.

One Python standard-library checker reads Git index or commit blobs, never working-tree substitutes. Reject reports/, .archify/, .planning/, test-results/ and playwright-report/ in snapshots. Check maintained Markdown/HTML references and screenshot manifests against the same snapshot. Range checks inspect every new commit after the documented pre-policy baseline, including files added then removed. Missing refs fail explicitly.

Hooks and CI call that checker without editing files/index or invoking production. Hooks are installed deliberately with existing configuration preserved. Generated test output moves to reports/verification; explicit authoring/promotion tools are documented separately. CI diagnostics expire after 30 days; selected durable evidence remains in Git.

Shared skills are read-only in this task. The upgrade guide covers policy alignment and Codex/Claude validation without claiming either host ran.
