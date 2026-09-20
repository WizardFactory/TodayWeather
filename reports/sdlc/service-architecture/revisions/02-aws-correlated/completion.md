# Local completion — AWS correlation

Final primary candidate: `sha256:db0c828e4bacdb6f24e035e617cc1f643971d363bf67e073f1ebecbfb7ae2597` (19 files). Source-only predecessor and receipts are preserved under revisions/01-source-only.

| Criterion | Outcome |
| --- | --- |
| AC1 | Service overview connects repository components/modes/data stores to timestamped AWS routing and deployed Lambda source, with host-runtime uncertainty explicit. |
| AC2 | Detailed domestic/world collection plus KAQ EventBridge producer, OCR/S3 objects, pixel-derived station hourly forecasts, separate map-case records, schedule mismatch and observed errors. |
| AC3 | Exact public paths, country/version dispatch, DynamoDB coordinate versus address cache differences, HTTP cache layers/retries, response enrichment and unsupported weather-address handler. |
| AC4 | Four Archify JSON/HTML diagrams, 36 showcase checks with zero composition errors/warnings, desktop browser measurements and actual screenshot review; canonical AGENTS.md and CLAUDE import with six navigation journeys. |

Start at docs/architecture/README.md and aws-code-correlation.md. Diagram source/artifact bindings are in diagram-handoff.json; selected AWS observations/hashes in aws-readonly-evidence-2026-09-20.json. All 150 local links pass. Independent review identified four precision issues and verified corrections: loc parameter name, coordinate-only record expiry, current-resource timeout provenance and KAQ forecast output semantics. See independent-verification.md for its separate verdict and final hash confirmation.

AWS access was explicitly authorized and read-only: configuration, selected deployment settings/source, metrics and bounded logs. Credentials unchanged. No application/Lambda invocation, collection/provider probe, SSH/SSM, cloud write, deployment, product code change, commit or push. Product integration tests/mobile builds were not run. EC2 deployed revision/process mode/database endpoint and release mobile configuration remain unverified; OCR failure symptom is observed but upstream cause is unresolved.
