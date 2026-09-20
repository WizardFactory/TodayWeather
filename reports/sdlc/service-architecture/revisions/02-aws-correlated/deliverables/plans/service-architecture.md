# Architecture documentation implementation plan
Owner: /root. Selected execution notebook: .planning/2026-09-20-service-architecture/task_plan.md.
Inputs: intent/service-architecture.md, specs/service-architecture.md, reports/sdlc/service-architecture/investigation.md; diagram JSON/HTML and validation receipts.
1. Write source-linked overview, collection, mobile API, evidence and index documents under docs/architecture.
2. Preserve three Archify sources and delivered HTML; validate showcase, inspect desktop browser behavior and light/dark screenshots.
3. Create root AGENTS.md as canonical guidance; CLAUDE.md contains only a native import. Add architecture navigation to README without replacing original content.
4. Check local document links, JSON/source references, artifact hashes, instruction discovery/representative decisions and git diff hygiene. Use a dependency-free local check for canonical/adaptor resolution before and after writing guidance.
5. A distinct native agent independently verifies source claims and task scenarios without editing authored files; main resolves findings, refreshes checks and records local completion.
No application runtime or external provider execution is needed. No skill changes. Rollback: remove added documents/instructions and the README insertion. Blast radius is documentation and future agent guidance; product code stays unchanged.

## AWS continuation
1. Preserve initial artifacts; verify account and gather minimal read-only routing, deployed Lambda source/settings and operational evidence.
2. Produce AWS/code correlation and sanitized evidence; update existing docs/guidance.
3. Regenerate overview and request diagrams; add KAQ producer/consumer diagram with explicit unverified host boundary.
4. Validate links, source claims, showcase composition, real browser and screenshots. Reuse independent verifier for the changed candidate; renew receipts and completion. No runtime code edits, invocation or deployment.
