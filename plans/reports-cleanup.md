# Artifact retention implementation plan

Consumes [spec](../specs/reports-cleanup.md).
1. Add isolated Git behavioral tests and a read-only staged/commit/range checker; observe failures before implementation, then implement hooks and workflow.
2. Map existing report paths to maintained docs, selected evidence, tools or dated Git permalinks. Copy retained files before untracking originals; keep a migration manifest. Update relative links and reproduction paths.
3. Fix tool roots and output paths; separate capture output from explicit reference publishing. Update ignore, AGENTS, retention policy and shared-skill upgrade guide.
4. Verify selected sources, screenshot hashes, checker tests and real Git-hook smoke in isolation. Verify a clean staged export without reports and request independent assessment.

Risks: losing unique evidence, altering historical claims, staged/working-tree mismatch, old history rejected forever, hidden file-writing behavior. Mitigate with byte hashes, dated historical links, snapshot reads, explicit baseline and output checks. Do not bulk-delete locally or rewrite history. Existing native/provider builds are outside scope; verify moves offline. Rollback is the inverse reviewed file mapping and policy/tool changes, with original local bytes retained.
