# Specification: server2 design amendment

Status: proposed design; no runtime code. Source: [intent](../intent/issue-2614.md).

## Required changes

The canonical architecture/data/failure contract is
[server2.md](../docs/architecture/server2.md). This spec supplies acceptance
traceability without duplicating that contract.

| Criterion | Required specification outcome |
| --- | --- |
| AC1 | No local persistence; exact raw/revision storage, catalog CAS plus complete fetch-group reader eligibility across partitions, bounded raw packs with canonical fallback, one-process shared-cache concurrency and future multi-host plan |
| AC2 | All 19 accepted traffic groups are included; zero-observed public APIs excluded within evidence scope, internal used behaviors retained; old versions/errors/preflight and precise-geocode privacy reconciled |
| AC3 | Source JSON and standalone HTML linked from architecture index; checked latency, dominant cold-geocoder demand/deadlines and catalog-version cost arithmetic; independent review; assumptions and pending decisions explicit |

## Verification and implementation constraints

This PR's checks are content/link/schema, browser/visual diagram checks and
latency arithmetic, not execution of a future Rust implementation. Runtime
acceptance in the [plan](../plans/issue-2614.md) requires byte-equivalent golden
responses from frozen raw inputs/clock and current contracts, crash/concurrency
tests and measured latency. No declared performance estimate is a cutover gate.

Precise reverse-geocoding cannot be both volatile-only for privacy and guaranteed
provider-free after replacement. Preserve the provider/legacy acquisition path;
do not silently round coordinates, omit labels or treat S3 failure as a new 200.
Missing 8-day history cannot be accepted for a used API merely to honor D1.

No schema, new API, alert broadcast, shared cache, purchased capacity or production
route switch is introduced in this design PR. Remaining issue decisions are
listed in the canonical architecture's reconciliation table.
