# Rust build artifact cleanup requirements

The canonical [agent guidance](../AGENTS.md) must cover these outcomes:

1. Check space/target size, reuse compatible ignored targets, coordinate concurrent builds, and preserve an additional 3 GiB reserve.
2. Use process-scoped incremental/debug settings only when appropriate; retain symbols for debugging and preserve global/release defaults.
3. At completion, assess active and scheduled target consumers. An idle compiler alone does not authorize deletion.
4. Hash/copy required verification inputs before cleanup; preserve source, fixtures, locks, logs, state, selected evidence and diagram recovery metadata.
5. Verify target ownership/resolution, avoid symlink traversal/broad wildcards, and delete only eligible regenerable output.
6. Report paths/skips/free space and avoid claiming retained binaries remain runnable without checking their dependencies.

These satisfy GUIDANCE and SAFETY. There is no product or runtime interface change. Validate the exact documentation diff and artifact-policy checks. Assess the actual completed-work cleanup ledger and active-consumer preservation record; do not run a new Cargo build or deletion just to test prose.
