# Service architecture

This is a source-based analysis of TodayWeather and TodayAir at commit `b9795125a1b7dc8a4f7602d4612a6be7d79413ad`, prepared on 2026-09-20. It combines checked-out implementation analysis with authorized read-only AWS inspection on the same date. Control-plane settings and deployed Lambda source were inspected. The service EC2 was subsequently inspected over authorized read-only SSH; separate gather/Mongo host internals, provider availability and end-to-end responses remain unverified.

Product status update: AK confirmed on **2026-09-28** that TodayAir is retired. See [product lifecycle](service-overview.md#product-lifecycle); historical source descriptions do not imply continued operation.

## Reading order

Proposed replacement origin: [server2 memory and S3 design](server2.md), with
[overview diagram](diagrams/server2.html) and [editable source](diagrams/server2.json).
This is a 2026-10-06 design amendment to #2614, not deployed behavior.

The 2026-10-24 [Korean acquisition and S3 retrieval proposal](server2-kma-data-design.md)
selects canonical raw/catalog replay, public source candidates and one shared RAM
input closure. The [manual-backed independent reassessment](../evidence/research/kma-storage-reassessment-2026-10-24.md)
keeps packs conditional and defers grid heads/day locators.
The later [response-first review](../evidence/research/kma-response-first-review-2026-10-24.md)
selects validated RAM response before supervised S3 persistence, with accepted
crash loss and bounded recovery. Its [sequence](diagrams/server2-kma-data-design.html)
describes the proposed order; current runtime, provider equivalence, archive
automation and new end-to-end latency remain separately qualified.
The 2026-10-25 [full-response reassessment](../evidence/research/kma-full-response-reassessment-2026-10-25.md)
keeps all requested history: current native empty-S3 acquisition is BLOCKED and
full restore is NOT_QUALIFIED. Latest-only timings are excluded; three separate
gates cover raw integrity, required coverage and value parity. Archive/APIHub
candidates and the historical-source/value conflict remain open.

The [2026-10-25 implementation record](../evidence/research/kma-full-response-implementation-2026-10-25.md)
supersedes the earlier unresolved value/granularity decisions: AK permits acquired
ASOS historical values to differ and retains the current public three-hour axis.
ASOS-primary and response-first now exist locally with scripted full-history
response/store/restore tests. Actual dry/winter/pre-release completeness and full
live cold/restore p95/p99 remain unqualified; grid combination generation is deferred.
The subsequent [source qualification](../evidence/research/kma-asos-closure-qualification-2026-10-25.md)
records ASOS-specific blank/trace/QC meanings, their bounded observed normalization,
public-city limits and remaining44 QC9 hours/midnight boundary. APIHub is optional;
its key is absent. No complete live sample or tail qualification is added.

The 2026-10-24 [external API manual](../reference/external-apis/README.md) inventories
KMA and all source-wired weather/support services, with request/response contracts,
consumer-specific bounds, official references and separate legacy/inactive status.

1. [Service overview](service-overview.md): components, server modes, persistence, platform variants and deployment evidence.
2. [Weather collection](weather-collection.md): domestic schedules, requesters, parsing, persistence, retries, and on-demand world weather.
3. [Mobile API flow](mobile-api.md): location selection, exact URL contracts, verified AWS gateway mapping, backend middleware and response handling.
4. [AWS/code correlation](aws-code-correlation.md): current routing, deployed Lambda logic, cache policy, KAQ producer/consumer links and observed failures.
5. [Service EC2 internals](ec2-internals.md): nginx, PM2 workers, resolved configuration, database sockets and deployed-code differences.
6. [Evidence and limitations](evidence.md): source map and unresolved integration questions.
7. [Push notifications](push-notifications.md): settings/token APIs, alarm and alert workers, provider selection and observed request errors.
8. [EC2 SSH and AWS API access](ec2-access.md): connection commands, local credential locations, named AWS profile and CLI/SDK usage.

## Interactive diagrams

Open the main HTML files linked in the table below in a browser. Each contains its diagram as inline SVG and includes theme switching, zoom, search and export controls. JSON files are the editable Archify sources; do not hand-edit generated HTML.

Files ending in `.visual-check.html` are local screenshot contact sheets, not the diagrams themselves. All `visual-check` outputs—temporary HTML, PNG and browser-receipt JSON—are intentionally excluded from Git and are generated only by a local `visual-check` run. Open `service-overview.html`, for example, rather than `service-overview.visual-check.html`. The main diagram HTML does not depend on those PNGs.

| View | Standalone HTML | Source |
| --- | --- | --- |
| Selected Korean response-first and S3 recovery contract | [Full-data gates, response-first and recovery](diagrams/server2-kma-data-design.html) | [JSON](diagrams/server2-kma-data-design.json) |
| Food-poisoning recovery | [Collector and response design](diagrams/food-poisoning.html) | [JSON](diagrams/food-poisoning.json) |
| Nation air recovery | [DB and global providers](diagrams/nation-air-recovery.html) | [JSON](diagrams/nation-air-recovery.json) |
| AirKorea collector repair | [Observation and page validation](diagrams/airkorea-observation-recovery.html) | [JSON](diagrams/airkorea-observation-recovery.json) |
| Historical observations | [Recovery and response](diagrams/historical-observations.html) | [JSON](diagrams/historical-observations.json) |
| Push notifications | [Settings to device notification](diagrams/push-notifications.html) | [JSON](diagrams/push-notifications.json) |
| Service EC2 internals | [nginx / PM2 / Mongo endpoint](diagrams/ec2-internals.html) | [JSON](diagrams/ec2-internals.json) |
| AWS infrastructure | [AWS resource topology](diagrams/aws-infrastructure.html) | [JSON](diagrams/aws-infrastructure.json) |
| Overall service (architecture) | [Service structure](diagrams/service-overview.html) | [JSON](diagrams/service-overview.json) |
| Domestic ingestion (architecture) | [Collection and persistence](diagrams/weather-collection.html) | [JSON](diagrams/weather-collection.json) |
| KMA warnings (architecture) | [Warning collection and town warnings](diagrams/kma-warnings.html) | [JSON](diagrams/kma-warnings.json) |
| Server payment retirement (sequence) | [Existing fallback](diagrams/server-payment-retirement.html) | [JSON](diagrams/server-payment-retirement.json) |
| Cordova advertising (sequence) | [After payment removal](diagrams/cordova-advertising.html) | [JSON](diagrams/cordova-advertising.sequence.json) |
| Mobile request (sequence) | [Request lifecycle](diagrams/mobile-weather-request.html) | [JSON](diagrams/mobile-weather-request.json) |
| KAQ image producer and consumer | [KAQ pipeline](diagrams/kaq-image-pipeline.html) | [JSON](diagrams/kaq-image-pipeline.json) |
| Overseas air request (sequence) | [Shared provider chain](diagrams/world-air-request.html) | [JSON](diagrams/world-air-request.json) |
| Stored air forecast selection (sequence) | [KAQ to AirKorea](diagrams/air-forecast-selection.html) | [JSON](diagrams/air-forecast-selection.json) |
| Domestic air fallback (sequence) | [AirKorea first, provider chain](diagrams/domestic-air-fallback.html) | [JSON](diagrams/domestic-air-fallback.json) |

The overview combines AWS-confirmed routing with repository logical roles. Dashed deployment connections remain unverified at the EC2 process/configuration level. The collection view focuses on domestic scheduled ingestion; world-weather cache fills are explained in the collection document. Auxiliary provider calls are omitted from the overview to keep it readable.

## Maintaining this analysis

Follow [AGENTS.md](../../AGENTS.md). Update the relevant document and JSON when a route, schedule, model, response or platform contract changes. Keep implementation facts separate from deployment assumptions. Source links are relative to this checkout; function names provide stable lookup targets as line numbers move.

Using an installed Archify skill, run the following with its actual path in `ARCHIFY_DIR`:

```sh
node "$ARCHIFY_DIR/bin/archify.mjs" validate architecture docs/architecture/diagrams/service-overview.json --repo-root . --quality showcase --json
node "$ARCHIFY_DIR/bin/archify.mjs" deliver architecture docs/architecture/diagrams/service-overview.json docs/architecture/diagrams/service-overview.html --repo-root . --quality showcase --json
node "$ARCHIFY_DIR/bin/archify.mjs" visual-check docs/architecture/diagrams/service-overview.html --json
```

Use `architecture` for collection and `sequence` for mobile requests. Architecture sources pin repository evidence to the analyzed revision; update that revision deliberately after relevant source changes. Validation, browser execution and perceptual review are separate claims. See the [verification record](../evidence/tasks/service-architecture/self-verification.md) for results and limitations.

- [KMA station observations](../operations/kma-station-observations.md): opt-in gather minute/hourly collectors, current-weather merge, verification, rollback and known station gaps.
- [Visual Crossing deployment checklist](../operations/visual-crossing-deploy.md): overseas weather (#2585) host configuration, `VC_SECRET_KEY`/`VC_DAILY_RECORD_LIMIT`, post-deploy smoke, usage and log monitoring, retention, kill switch and rollback.
- [Gather runtime policy](../operations/gather-runtime-policy.md): `GATHER_*` environment variables for retry counts, retry delay, task flags and the KAQ minimum (#2588), production values, operator procedure and remaining host-only drift.
- [Static web client](web-client.md): responsive PWA, direct existing-API reads, local persistence and S3/CloudFront deployment boundaries.

The opt-in [S3 push coordinator](push-s3-design.md) has a separate [interactive diagram](diagrams/push-s3-proposal.html) and [Archify source](diagrams/push-s3-proposal.json); it is repository implementation, not a deployed-topology claim.

Current-grid quota prevention: [flow](diagrams/current-grid-collection.html), [JSON](diagrams/current-grid-collection.json), [operations](../operations/current-grid-collection.md).
