# Rust build artifact cleanup implementation plan

Owner: root. Base: 69fff410. Implement [intent](../intent/rust-build-artifact-cleanup.md) and [spec](../specs/rust-build-artifact-cleanup.md).

1. Preserve root's existing local guidance and add that exact section to AGENTS.md in an isolated worktree.
2. Confirm original instructions remain byte-identical outside the new section; inspect paths and maintained links.
3. Validate the recorded cleanup cases: active/shared target preserved until its consumers finished; completed caches removed with required proof retained. Reuse those real actions, without another build/deletion.
4. Run diff and staged/outgoing artifact-policy checks. Obtain independent review and exact-current CI, then integrate under AK's standing authorization.

Paths: AGENTS.md (explicit agent-guidance exception), intent/rust-build-artifact-cleanup.md, specs/rust-build-artifact-cleanup.md and this plan (maintained task docs). No server2 implementation or shared infrastructure changes.

Scenarios: a worker prepares a build under a disk budget (GUIDANCE); a coordinator encounters an active or dirty owner and preserves it (SAFETY); a coordinator cleans completed caches only after retaining required proofs and reports recovered space (GUIDANCE, SAFETY). A failed ownership/proof/consumer check must leave that target intact.

No Archify/manual PDF: this is a small development-instruction update with no service architecture, product workflow, API or UX change. Non-executable document checks and actual retained cleanup outcomes apply; no invented TDD/smoke. Rollback: revert the guidance-only change, never restore/delete other agents' source or evidence.
