# TodayWeather GTM folder specification

Sources: [intent](../intent/gtm.md), issue [#3145](https://github.com/WizardFactory/TodayWeather/issues/3145). Tasks and pull-request boundaries are in the [plan](../plans/gtm.md). Current locations and access state are maintained in [gtm/sources.md](../gtm/sources.md), which this specification does not repeat.

## Folder

`gtm/` is the entry point for go-to-market work. `gtm/README.md` indexes: product context, metric definitions, sources and locations, a dated log, store listing state and a research index. Existing documents keep their locations and are linked.

## Privacy boundary

The repository is public.

- Never tracked: credentials, tokens, vendor and publisher identifiers, the Google Play report bucket identifier, download counts, ad statistics, review bodies and reviewer names.
- Tracked: definitions, variable names, file-name patterns, console pages, resource names of the private bucket and its collector user, and public store values (rating, rating count, version) with their observation date.
- `gtm/data/` is a local cache of private records. Git ignores it, and the artifact checker rejects any tracked file under it.

## Records

- Records live in the private bucket. One record per source and covered day; reviews are one record per review; briefs are one per run day.
- Every record carries source, store, country where the source provides it, the covered day, that day's timezone and the collection time.
- A re-run with identical content changes nothing. A restated day replaces its record.
- A source that fails or is not yet published is recorded as not collected with its reason. No zero is written in its place.
- Review records keep the review ID, store, territory, rating, dates, app version, text and reply state. Reviewer names are not stored.

## Brief

The brief reports, per source, the latest complete day with its date, the change against the previous day and the seven-day average, new and edited reviews, and every source without data with its reason. Sources have different day boundaries and publication delays, so the brief does not use one common "yesterday". [gtm/metrics.md](../gtm/metrics.md) defines each metric.

## Tools

Collectors and the brief are built in the Hermes workspace (AK, 2026-11-24). They read the variables named in `gtm/.env.example`, have no dry-run or mock mode, use in-test doubles in tests, and verify each source once against the real service.

## Acceptance

| ID | Criterion | Check |
| --- | --- | --- |
| AC1 | From `gtm/README.md` a reader reaches the data location and every source's access requirement, and every link in `gtm/` resolves. | Artifact checker on the candidate; document review against `gtm/sources.md` |
| AC2 | The artifact checker link-checks `gtm/` and rejects a tracked file under `gtm/data/`. | `python3 scripts/verification/test_artifact_policy.py`; a real staged `gtm/data/` file is rejected |
| AC3 | The change contains no credential, account identifier, figure or review body. | Pattern scan of the outgoing commits against the private values |
| AC4 | `AGENTS.md` and the artifact retention document point to `gtm/`. | Document review; artifact checker links |

AC1 to AC4 belong to the first task (`gtm-g01`). The later tasks use the completion criteria of #3145.

## Not specified here

Uninstalls, crash-free rate, active users, retention, store conversion, competitor and keyword tracking, and the Hermes host setup.
