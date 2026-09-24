# Static deployment build

Default browser transport now normalizes existing public APIs directly; local catalog/capabilities require no backend. Proxy and demo are explicit options. Static CloudFormation, exact edge navigation function, guarded dry-run uploader, CSP-enabled preview, docs and CI artifact are included. No native or legacy server source change.

52 unit/API tests, typecheck and production build passed. 14 actual Chromium scenarios against the static-only server passed with raw mocked external APIs and no local API calls. Previous E2E fixture errors (JSON import attribute, DSF current row) were test harness mistakes. Route mocking served responses while offline; removing the external mock before disconnect verifies actual failed transport and offline storage. Test evidence distinguishes those intermediate failures. CloudFormation ValidateTemplate succeeded (syntax service check, not provisioning validation); uploader dry-run made no AWS writes. Live browser read evidence is separate.

Candidate manifest covers all changed source, tests, configuration and documents, including untracked new files; reports are evidence, not executable app files. No production resources, DNS or uploads executed.
