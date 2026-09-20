# Self-verification
Builder: /root. Scope: documents, Archify artifacts and shared agent instructions; local endpoint.
Checks: guidance-check.py before creation failed specifically on missing AGENTS.md, then passed after canonical guidance and Claude import were added. A separate post-refactor check confirms the same result (no refactor was necessary).
Document checks: document-check.py checks relative links, diagram source paths, 27 final showcase checks, browser/artifact/specification hashes, git diff hygiene and preservation of original README/product files. See document-check.log for executed result.
Diagrams: final validation, delivery, browser and perceptual evidence is recorded in design-validation.md and diagram-handoff.json. Existing Chromium was found outside PATH; initial skipped discovery was repaired with ARCHIFY_CHROME. Mobile overflow was corrected in source and revalidated/delivered.
Independent behavioral evaluation of shared guidance is retained separately in independent-verification.md; it exercises canonical entrypoint resolution and representative API, collection and skill-installation decisions. It is not a Claude CLI execution claim.
Application tests/builds/provider calls: not run. Product source and runtime configuration are unchanged; no mobile build, live API, deployment, external gateway or provider availability is asserted. No remote publication or commit performed.

Functional guidance smoke: guidance-smoke.py executed six actual file navigation journeys from both entrypoints to source documents and implementation files. This supplements independent agent decision evaluation; it does not launch either CLI. Source identity: sha256:316b77b3a5ca92a6f115f396d61bd577b422e768b276bbb5bf105b498f0790cb.
