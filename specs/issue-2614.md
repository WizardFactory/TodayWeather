# Specification: server2 design amendment

Status: design contract under implementation; S04 Rust/CI/placement foundation
is integrated, while weather/storage/provider routes remain task-owned future
work. No deployed server2 is claimed. Source: [intent](../intent/issue-2614.md).

## Required changes

The canonical architecture/data/failure contract is
[server2.md](../docs/architecture/server2.md). This spec supplies acceptance
traceability without duplicating that contract.

| Criterion | Required specification outcome |
| --- | --- |
| AC1 | No local persistence; exact raw/revision storage, catalog CAS plus complete fetch-group reader eligibility across partitions, bounded raw packs with canonical fallback, one-process shared-cache concurrency and future multi-host plan |
| AC2 | All 19 accepted traffic groups are included; zero-observed public APIs excluded within evidence scope, internal used behaviors retained; old versions/errors/preflight and precise-geocode privacy reconciled |
| AC3 | Source JSON and standalone HTML linked from architecture index; checked latency, dominant cold-geocoder demand/deadlines and catalog-version cost arithmetic; independent review; assumptions and pending decisions explicit |
| AC4 | All server-equivalent runtime/supporting assets under `server2/`; each task declares paths and bounded exceptions, reviews dependencies and satisfies the common placement criterion; Rust foundation introduces the local/CI gate before later implementation |

## Verification and implementation constraints

The [implementation placement contract](../docs/architecture/server2.md#implementation-placement)
and [common task contract](../plans/issue-2614.md#common-contract-for-every-implementation-task)
apply to every future task, including tests, tooling, migration and deployment.
Root `AGENTS.md` carries the execution instruction for both agent hosts. The new
runtime cannot depend on legacy source/data outside `server2/`; the explicit
HTTP coexistence path is allowed. Documentation/shared CI wiring and named
legacy recorder/export changes are bounded exceptions, not alternate locations
for implementation. No task is complete with an unexplained outside path. S02/S03 server2 assets
require S04; pre-gate work is inventory/planning only. Ordinary legacy
maintenance remains outside this server2 placement rule. Explicit pending
decisions block the mapped tasks even if S01 or a predecessor issue is closed.

The original design PR's checks were content/link/schema, browser/visual diagram checks and
latency arithmetic, not execution of a future Rust implementation. Runtime
acceptance in the [plan](../plans/issue-2614.md) requires byte-equivalent golden
responses from frozen raw inputs/clock and current contracts, crash/concurrency
tests and measured latency. No declared performance estimate is a cutover gate.

D04 permits useful memory/S3 geocoding caches within the original privacy and
label contract. A forbidden precise-coordinate archive cannot guarantee
provider-free restoration after replacement; privacy-safe persistent cache
projections still require schema/expiry/source and exact-label proof. Preserve the provider/legacy acquisition path;
do not silently round coordinates, omit labels or treat S3 failure as a new 200.
Missing 8-day history cannot be accepted for a used API merely to honor D1.

No schema, new API, alert broadcast, shared cache, purchased capacity or production
route switch is introduced in this design PR. Recorded O-1…O-13 dispositions and still-deferred task prerequisites are
listed in the canonical architecture's reconciliation table.

## Approved S01 policy

AK's [2026-10-06 decision record](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6009156640)
approves demand-limited hourly history and 2-minute rainfall capture, immutable
raw gzip with versioned identity-catalog CAS, full raw/group publication before
new success, existing error/fallback or valid memory during S3 outages,
conditional measured packs and no lifecycle deletions now. Capture demand and
ownership are implemented in S14. D01–D03 resolve the prior push retry/migration
policy gate: S18 designs state ordering and durable new acceptance, performs no
automatic failed/unknown resend and no legacy registration import. D04 authorizes
privacy-safe memory/S3 caching; exact labels, bounded validity and privacy tests
still gate reuse. Provisioning/cutover remain separate authorized actions.

## Cold-cell compatibility and demand privacy (R16/R18)

For never-requested cells, renewed demand after more than 8 days, or partial S3
history, only verified S3/legacy-export data and legacy-equivalent recovery are
eligible. ASOS cannot replace missing grid-hour history as an approved difference.
If parity cannot be reconstructed, the affected behavior stays on or forwards
to legacy through S20; S21 retirement waits for cold-cell parity. Continuing
legacy capture retains quota/cost and must be measured in coexistence budgets.
S14 fixtures cover all three cold-cell cases. Durable demand records under
`state/demand/grid/` contain grid identity, last-demand time and expiry only,
without coordinates, IPs, device/user/subscriber IDs, tokens or request logs.


## D01–D04 implementation constraints

The [latest AK record](https://github.com/WizardFactory/TodayWeather/issues/2614#issuecomment-6015980608)
is authority for the narrow push-registration continuity difference. Payload,
status, headers and auth remain compatible. Recovery restores new durable state
without sending again; operations use sanitized error/uncertain-outcome logs to
fix the next distinct send. No separate writer organization/process is required.
Geocoding cache projections are the narrowly named D04 cache exception, with
coarse identities/source/expiry and legacy response proof; they do not allow
normalized weather views or indefinite precise lookup history. None of these
choices relax the weather-history, cold-cell fallback or retirement criteria.
