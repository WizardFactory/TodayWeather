# Service architecture

This is a source-based analysis of TodayWeather and TodayAir at commit `b9795125a1b7dc8a4f7602d4612a6be7d79413ad`, prepared on 2026-09-20. It combines checked-out implementation analysis with authorized read-only AWS inspection on the same date. Control-plane settings and deployed Lambda source were inspected. The service EC2 was subsequently inspected over authorized read-only SSH; separate gather/Mongo host internals, provider availability and end-to-end responses remain unverified.

## Reading order

1. [Service overview](service-overview.md): components, server modes, persistence, platform variants and deployment evidence.
2. [Weather collection](weather-collection.md): domestic schedules, requesters, parsing, persistence, retries, and on-demand world weather.
3. [Mobile API flow](mobile-api.md): location selection, exact URL contracts, verified AWS gateway mapping, backend middleware and response handling.
4. [AWS/code correlation](aws-code-correlation.md): current routing, deployed Lambda logic, cache policy, KAQ producer/consumer links and observed failures.
5. [Service EC2 internals](ec2-internals.md): nginx, PM2 workers, resolved configuration, database sockets and deployed-code differences.
6. [Evidence and limitations](evidence.md): source map and unresolved integration questions.
6. [EC2 SSH access](ec2-access.md): user-confirmed connection command and local private-key setup.

## Interactive diagrams

Open the HTML files in a browser. Each file is standalone and includes theme switching, zoom, search and export controls. JSON files are the editable Archify sources; do not hand-edit generated HTML.

| View | Standalone HTML | Source |
| --- | --- | --- |
| Service EC2 internals | [nginx / PM2 / Mongo endpoint](diagrams/ec2-internals.html) | [JSON](diagrams/ec2-internals.json) |
| AWS infrastructure | [AWS resource topology](diagrams/aws-infrastructure.html) | [JSON](diagrams/aws-infrastructure.json) |
| Overall service (architecture) | [Service structure](diagrams/service-overview.html) | [JSON](diagrams/service-overview.json) |
| Domestic ingestion (architecture) | [Collection and persistence](diagrams/weather-collection.html) | [JSON](diagrams/weather-collection.json) |
| Mobile request (sequence) | [Request lifecycle](diagrams/mobile-weather-request.html) | [JSON](diagrams/mobile-weather-request.json) |
| KAQ image producer and consumer | [KAQ pipeline](diagrams/kaq-image-pipeline.html) | [JSON](diagrams/kaq-image-pipeline.json) |

The overview combines AWS-confirmed routing with repository logical roles. Dashed deployment connections remain unverified at the EC2 process/configuration level. The collection view focuses on domestic scheduled ingestion; world-weather cache fills are explained in the collection document. Auxiliary provider calls are omitted from the overview to keep it readable.

## Maintaining this analysis

Follow [AGENTS.md](../../AGENTS.md). Update the relevant document and JSON when a route, schedule, model, response or platform contract changes. Keep implementation facts separate from deployment assumptions. Source links are relative to this checkout; function names provide stable lookup targets as line numbers move.

Using an installed Archify skill, run the following with its actual path in `ARCHIFY_DIR`:

```sh
node "$ARCHIFY_DIR/bin/archify.mjs" validate architecture docs/architecture/diagrams/service-overview.json --repo-root . --quality showcase --json
node "$ARCHIFY_DIR/bin/archify.mjs" deliver architecture docs/architecture/diagrams/service-overview.json docs/architecture/diagrams/service-overview.html --repo-root . --quality showcase --json
node "$ARCHIFY_DIR/bin/archify.mjs" visual-check docs/architecture/diagrams/service-overview.html --json
```

Use `architecture` for collection and `sequence` for mobile requests. Architecture sources pin repository evidence to the analyzed revision; update that revision deliberately after relevant source changes. Validation, browser execution and perceptual review are separate claims. See the [verification record](../../reports/sdlc/service-architecture/self-verification.md) for results and limitations.
