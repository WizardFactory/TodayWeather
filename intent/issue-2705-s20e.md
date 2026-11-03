# Native forecast narratives — S20e / issue2809

Source: AK 2026-10-17 requested a server2 issue and implementation of merged
[PR2805](https://github.com/WizardFactory/TodayWeather/pull/2805) first, followed
by actual widget compatibility, complete release rollback and environment work.
Task: [issue2809](https://github.com/WizardFactory/TodayWeather/issues/2809).
Parent: [S20](https://github.com/WizardFactory/TodayWeather/issues/2705).

## Desired outcome

National weather and domestic regional weather responses can include the same
optional original Korean `forecastNarrative` as the accepted legacy change.
Clients keep receiving their existing weather/air response if the narrative is
unavailable. Client presentation remains a separate change in issue2803.

## Constraints and acceptance

- PARITY: national office108 and all nine regional offices/aliases produce the
  accepted field types, UTC timestamps and plain text. No nested city narrative.
  Existing weather, units, errors, ETag, HEAD and conditional response behavior
  remains compatible; cache age cannot outlive the attached publication.
- ACQUISITION: one bounded/coalesced background cycle, no request-triggered
  narrative provider work or startup pre-collection. Reuse accepted per-key/API
  daily funding and existing native transports; actual quotas are not measured.
- RECOVERY: native immutable office/publication records recover from S3 without
  Mongo or a runtime legacy asset. The first committed publication is retained.
- SAFETY: omit missing, stale, future, malformed or unavailable optional data;
  preserve warning, zone, registration, claim, retry and send behavior.
- PLACEMENT: exact declaration before implementation, S04 check, S02 parity
  evidence and updated architecture/operator source, PDF and actual captures.

## Authority and limits

Continue the authorized implementation/test/review/PR/main endpoint autonomously.
Independent required reviewer effort is medium; no override is requested. No
deployment, production resource, live-provider, mirror, notification, final-copy
or2724 measurement authority is added. This feature does not close2704 or2705.

## Risks and decisions

The highest risk is attaching wrong-office or stale prose, or turning optional
data into provider work on the HTTP path. A dedicated background owner and
read-only bounded serving interface enforce the split. Existing raw/index S3
formats are retained; no normalized weather view or parallel storage is added.
Spec/plan record the first-write publication and shutdown behavior before code.
