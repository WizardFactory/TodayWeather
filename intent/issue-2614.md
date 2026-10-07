# Intent: server2 memory and S3 design amendment

Status: original design PR #2685 merged; S04 foundation #2708 integrated.
The original design scope below is preserved. Later task-owned implementation
follows the recorded follow-up authority; production cutover remains separate.
Source: [#2614](https://github.com/WizardFactory/TodayWeather/issues/2614)
and AK's task instructions on 2026-10-05/06.

## Problem / goal

Replace the proposed local SQLite serving store with memory and S3. Document a
Rust origin that preserves used APIs, reduces cold S3 lookup fan-out, and can
start on one Spot instance before scaling up and later out.

## Binding task directions

- No local persistent weather/state store: memory → S3 → provider.
- Preserve raw provider bytes and revisions; no persisted normalized weather view.
- Examine S3 storage and lookup structures as well as memory structures.
- Start with one Spot host. Compare threads/processes and host-local cache sharing.
- Multi-instance operation needs a future plan only; no shared-cache deployment.
- Used existing APIs must be fully compatible. Exclude APIs unused in a 30-day
  window; the existing traffic investigation is an accepted baseline and need
  not be refreshed for this PR.
- All new implementation and supporting assets equivalent to `server/` belong
  under `server2/`, including configuration, data, tests, tools and deployment
  assets. Every future task must declare paths and verify this boundary.
- Review the design, maintain documents/diagrams and create a PR. No merge,
  runtime implementation, AWS configuration change or deployment.

## Acceptance criteria

- **AC1:** The specification defines raw storage, direct lookup, atomic publication,
  pack fallback, concurrency, failure behavior, privacy exceptions and future
  scale-out, with confirmed directions distinguished from proposed decisions.
- **AC2:** The compatibility inventory matches the accepted traffic evidence,
  including old versions and failed requests; exclusions and scope gaps are
  explicit. Historical acquisition gaps cannot be silently accepted.
- **AC3:** Maintained documents and diagrams have working links, reproducible
  latency arithmetic and actual artifact/browser/visual checks; the PR has an
  independent review and records limitations without claiming implementation.

- **AC4:** The architecture, agent instructions and every future task's common
  contract specify `server2/` placement, bounded outside-path exceptions and a
  required path/dependency gate introduced by the Rust foundation task.

## Risks and open decisions

AK approved demand-limited history/rainfall capture and the S3 publication,
outage and no-delete policy on 2026-10-06; the [decision record](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6009156640) reconciles O-1…O-13.
Latest [AK D01–D04](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6015980608)
resolve the superseded push-registration migration/retry and cache-policy
questions. State schema/ordering are implementation choices under durable new-state
acceptance; S18 dependencies and tests still apply. Privacy/label proof,
measured lifecycle/pack costs and production cutover retain their named gates. Exact active-API parity takes precedence over optional
performance improvements. See the [spec](../specs/issue-2614.md) and
[delivery plan](../plans/issue-2614.md).

## Follow-up authority (2026-10-06)

AK requires all server-equivalent assets under `server2/` and the rule to be
checked in every task. AK then authorized publishing all proposed subtasks and
proceeding in the recommended dependency order. This adds issue creation and
S01 decision reconciliation to the current follow-up; future runtime work still
requires the issue decision gates, task-owned implementation PRs and applicable
verification. Production cutover/resource actions and merge are not authorized
by this follow-up. Pending choices are not inferred accepted from issue creation.

## Recorded decisions (2026-10-06)

AK accepted hourly capture only for cells requested in the last 8 days and
push-subscribed cells, plus 2-minute rainfall capture for cells with demand.
Canonical raw gzip objects remain immutable; identity catalogs use versioning
and CAS. New data is acknowledged only after raw and complete catalog
publication. S3 outage uses valid complete memory or the existing error/fallback.
Raw packs require measured benefit; no lifecycle deletions are selected now.
Runtime implementation proceeds in task-owned PRs, starting with S04; this
design PR contains no runtime code. Full used-API compatibility and separate
cutover approval remain required. See the parent decision record above.


## Implementation and D01–D04 amendment (2026-10-06)

AK authorized useful parallel implementation after S01/S04. S02 goldens, S03 local
infrastructure and S05 raw records proceed in separate reviewed unmerged PRs.
This adds no merge, live resource/routing, provider-call or notification authority.
D01's writer is the component ordering updates inside the initial Rust process;
its schema/synchronization are normal design/review choices. D02 prohibits
automatic failed/unknown push-delivery retries (including recovery and hidden
adapter retries), with sanitized logs to fix subsequent distinct sends. Weather
provider retries remain unchanged. D03 imports no legacy push registrations;
users register through existing APIs. This is solely a registration-continuity
difference, not a weather-history or API payload/status/header/auth exception.
D04 permits useful memory/S3 geocoding caches under exact-label and coordinate
privacy proof. Privacy-safe coarse cache projections are a narrowly named cache
exception, with source and bounded validity; normalized weather views and precise
lookup-history archives remain forbidden. These decisions do not approve a
cutover or remove cold-cell fallback/retirement gates.
