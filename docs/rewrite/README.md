# Server and client rewrite reference

This package records the current TodayWeather/TodayAir behavior before a rewrite. Source baseline: `ff7acf3996ccb66c912d2ed4710cf300197d6966`, analyzed 2026-09-23. It contains **16 screen definitions, 21 simulator screenshots, request/response and normalized-data examples, two server assembly diagrams, and migration/verification guidance**.

Production application code was not changed. Screenshots use synthetic data in an isolated native WKWebView; server analysis is source-based. Historical deployment observations are explicitly dated. This package is not a specification of a newly chosen framework or a claim that the legacy deployment has been retested.

## Read by task

| Question | Reference |
| --- | --- |
| What does each screen do and consume? | [Screen specifications](screen-specifications.md) |
| What do the screens actually look like? | [Visual screenshot gallery](screenshots/index.html), [capture manifest and provenance](screenshots/README.md) |
| What JSON does the client request and receive? | [Client data contracts](client-data-contracts.md), [examples](examples/README.md) |
| How are payloads converted into UI state and stored? | [Client state and behavior](client-state-and-behavior.md) |
| What data does the server load/merge, in which order? | [Server response assembly](server-response-assembly.md) |
| Who collects each product and how fresh is it? | [Server data lifecycle](server-data-lifecycle.md) |
| How should replacement be staged and rolled back? | [Rewrite playbook](rewrite-playbook.md) |
| Which behaviors need characterization/regression tests? | [Verification matrix](verification-matrix.md) |
| Which quirks need decisions rather than accidental preservation? | [Decisions and open questions](decisions-and-open-questions.md) |
| What was actually verified for this document package? | [Verification record](../../reports/rewrite-verification/README.md) |

## Server diagrams

| Diagram | Editable specification | Evidence |
| --- | --- | --- |
| [Domestic request assembly — workflow](diagrams/server-domestic-assembly.html) | [JSON](diagrams/server-domestic-assembly.json) | [Artifact/browser/visual review](../../reports/rewrite-verification/server-diagram-verification.md) |
| [World weather cache/fill — sequence](diagrams/server-world-cache-sequence.html) | [JSON](diagrams/server-world-cache-sequence.json) | [Artifact/browser/visual review](../../reports/rewrite-verification/server-diagram-verification.md) |

The domestic diagram groups stages for readability; the document preserves the exact 37-middleware list. The world diagram separates weather/AQI parallel work and cache/provider boundaries; the document preserves the 14-middleware list and exceptional paths. Generated HTML must be regenerated through Archify from JSON, not patched by hand.

## How the documents connect

Follow one user flow end to end: **S01 location selection → public weather URL → gateway boundary → KMA or world assembly → raw response → WeatherUtil conversion → WeatherInfo city → S03/S04/S05**. The public `/weather/v000903` prefix is not an Express mount in this repository. Backend storage objects, wire JSON and client chart models are three distinct shapes.

For rewrite acceptance, map each screen to its required fields, each field to the producing server stage, and each stage to its data producer/freshness/failure behavior. Use explicit decisions for incompatible changes. Examples are executable characterization inputs, not an exhaustive new schema.

## Existing references that remain necessary

- [Architecture index](../architecture/README.md): overall service, request lifecycle, collection and existing diagrams.
- [AWS/code correlation](../architecture/aws-code-correlation.md), [service host internals](../architecture/ec2-internals.md), [evidence gaps](../architecture/evidence.md): historical deployment context, not a fresh live audit.
- [Push notifications](../architecture/push-notifications.md): token/settings persistence, workers, provider submission and device-display boundaries.
- [Traffic distribution](../../reports/aws/api-traffic-2026-09-22.md): older/unversioned consumers matter for compatibility; caller identity remains partly unresolved.
- [Build variants](../../client/gulpfile.js), [iOS weather widget](../../tw.ios/widget/TodayViewController.m), [iOS air widget](../../ta.ios/widget/TodayViewController.m): shared web source is not the entire product perimeter.

## Evidence vocabulary and maintenance

**Observed source** means checked at the baseline revision. **Synthetic execution** means a parser or test shell ran with fixtures. **Historical deployment** means an earlier dated observation. **Proposal** means a decision/test/migration step has not yet been implemented. Preserve those distinctions when quoting this package.

On route/model/parser/screen changes, update the affected contract, screen definition and example together; regenerate diagrams and capture evidence as applicable. Record a new revision deliberately. Do not relabel old screenshots or AWS observations as current without revalidation. Recheck native status bar/safe area, live API/CORS, provider availability, production release configuration, user preference migrations, widgets and purchase/push before treating a rewrite as production-equivalent.
