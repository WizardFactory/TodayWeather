# Completion — issue 2563

Local implementation complete. No commit, push, PR, restart or deployment performed.

- AC1: real dotenv bootstrap runs before New Relic and configuration consumers; absolute server/.env path works for direct app, bin/www and npm startup.
- AC2: existing process values win; missing file supported; other read errors sanitized. Pinned dotenv syntax and permissive parsing documented.
- AC3: uploaded file placed byte-for-byte at server/.env, permissions 0600; excluded from Git and all evidence. Sanitized .env.example retained. Secret-value scan of candidate/evidence passed.
- AC4: dotenv 10.0.0 package declares Node >=10, matching documented Node10 service snapshot. Actual Node10 execution remains unverified. Existing server/README symlink and root README preserved; new instructions at server/CONFIGURATION.md. Architecture document/JSON updated and HTML regenerated.
- AC5: intended Red; 12 focused Green checks; 235 total offline regression checks plus gather smoke; separate real uploaded bootstrap/config smoke. Independent fresh-context local verification passed, including three supplemental natural-entrypoint probes and the full offline suite.

Artifact index: intent.md, spec.md, plan.md, test-plan.md, build.md, change-record.json, candidate.txt, test-results.json, self-verification.md, independent-verification.md and artifacts.json. Source hashes are fixed in change-record.json; private .env is deliberately outside that source identity.

Diagram: architecture, docs/architecture/diagrams/service-overview.html. Delivery 9/9 showcase, zero errors/warnings. Browser evidence passed at four required desktop sizes; both themes captured. Visual review of light/small and dark/large screenshots passed, zero correction rounds. Specification SHA-256 df518d06cd9d9c6b8fef31c6b323bf8f165b4d46af130d13aff87f516a3d50bd; HTML SHA-256 b79b30bb0303026679104746a34fa8ff89824b675ac21c2658d2e1429281cd52. See diagram-delivery.json and diagram-browser.json.

Operator boundary: install the declared dependencies in the intended server runtime before starting. Full legacy dependency installation, full app/New Relic/Express startup, real providers/DB, hosted CI and deployed Node10 runtime were not exercised. Missing DATA_GO_KR_NORMAL_KEY and DATA_GO_KR_CERT_KEY remain unchanged; test keys are not substituted. The supplied gather mode starts real scheduled work when the actual application is started.
