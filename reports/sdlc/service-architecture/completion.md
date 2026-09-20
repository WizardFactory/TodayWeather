# Local completion — service EC2 internals

Final candidate: `sha256:c373d00c03953b5d8eec776b3cdd05517c163312a699010e2561411c6e444f73` (27 primary files). Prior source-only and AWS-correlated candidates remain in revisions/01-source-only and revisions/02-aws-correlated.

| Criterion | Result |
| --- | --- |
| AC1 | Service/AWS overview updated with nginx, PM2 ten-worker topology, service mode, DB version2.0, actual Mongo target16652 and deployed revision differences. |
| AC2 | Collection docs distinguish source schedules and request-time provider access from service-host startup; separate gather host remains uninspected. |
| AC3 | Mobile API diagrams and documentation connect AWS dispatch to observed nginx/PM2 service routing, retaining untested live-response boundaries. |
| AC4 | Six Archify JSON/HTML diagrams,54 showcase checks, zero errors/warnings,182 local links; current browser bindings and actual visual review. Canonical AGENTS plus thin CLAUDE adapter and six navigation journeys pass. |

Added docs/architecture/ec2-internals.md, its sanitized timestamped JSON evidence and diagrams/ec2-internals.{json,html}. Updated AWS infrastructure, service overview and mobile sequence. See diagram-handoff.json and independent-verification.md. Independent review PASS; selected override-absence evidence finding resolved with ten PIDs × twelve keys plus unchanged config hash and kernel metadata.

Authorized SSH was read-only against the named service host using the existing PEM. No application/provider/DB probes, restart, deployment, lateral SSH, cloud writes, product edits, commit or push. Database engine/query success, separate gather/Mongo host internals and released mobile configuration remain unverified.

HTML/JSON retained, including browser sidecars; visual-check PNGs and local private key excluded by Git. Sensitive-pattern scan and product source preservation checks pass.
