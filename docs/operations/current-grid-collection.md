# Current-grid collection and quota budget

The source fix for [#2648](https://github.com/WizardFactory/TodayWeather/issues/2648)
avoids refetching complete current-hour grid observations. It does not increase a
provider entitlement or activate production.

## Coverage and traffic

For N grids, the existing scheduler polls current six times each hour:
144 × N first-pass grid fetches/day, before retries, pages, startup/manual calls
and multiple processes. Complete-publication filtering needs 24 × N successful
current fetches/day. For the deterministic 2,032-grid fixture this is 292,608
versus 48,768 (83.3% fewer), when every publication is complete and one process
collects it. Missing fields/failed writes remain eligible. This is a source/fixture
budget, not measured production usage or a hard quota cap.

Short/shortest schedules remain unchanged: their baseline first-pass grid fetches
are 24 × N and 96 × N respectively. Short continuation pages, retries and other
consumers add requests. Preserve the [#2604 bounded concurrency/retry budget](gather-runtime-policy.md#quota-and-key-rotation-2604).

The [official data.go.kr service page](https://www.data.go.kr/data/15084084/openapi.do)
(read 2026-10-03) lists development traffic of 10,000 and operational increase
applications. It defines code 22 as daily exhaustion and code 23 as per-second
exhaustion. This does not verify configured account approval, operation/service
sharing, usage window or other callers. Obtain each key's exact approval from
its existing account before rollout. Even once/hour full-grid collection needs
48,768 current calls/day for 2,032 grids; 10,000 cannot provide that coverage.

## Collection receipts

Preserve sanitized gather stdout; the error-only production logger suppresses
successful info records.

- current-coverage: UTC timestamp, publication, before/after stage, total,
  complete and pending grids. Remaining coverage is an error despite the legacy
  gather route's HTTP 200 response.
- forecast-pass: UTC completion time, KST hour, product/key index, publication,
  attemptsByKstHour including pages, received/pending counts and stop reason.
  Received counts completed fetches; pending equals failed plus rejected. Failed
  counts retryable incomplete rows, rejected counts non-retryable rejected rows.
  These fetch outcomes do not replace persisted coverage.
  Aggregate each pass once by product, key index and KST hour. Fetch counts
  differ from persisted coverage.
- first-quota: UTC response time, KST hour, requestKstDay, product/key index,
  daily-quota/per-second/unclassified-429 reason and current cooldown action.

Records contain no keys, URLs, provider bodies or exception text. A crash before
pass completion can lose its attempt totals. Existing untimestamped logs cannot
reconstruct first-rejection instants. Retain first-quota records and aggregate
windows for future incidents.

Only confirmed code 22 blocks current keys until the next KST day. Other products
retain their own bounded stop/rotation. Each cycle excludes its already rejected
indices as well as any daily-blocked current keys. Memory is per Manager/process; restarts
and multiple workers need separate accounting. This is not a global reservation
or hard daily request cap.

## Rollout and rollback gates

Production deployment/configuration/key changes and backfill require separate
approval. Before an approved action:

1. Check actual deployed Manager/collector and runtime policy; preserve local
   overrides and backups. Deploy both new helpers, Manager and collector together.
   No dependency upgrade/schema migration is required.
2. Verify approved current capacity covers 24 × live valid-grid count plus bounded
   retries, other usage and a measured margin. Otherwise obtain an authorized
   entitlement change or reviewed provider design; do not silently drop grids.
3. Run isolated tests below; inspect process count, time basis and log retention.
   Coordinate/coverage reads stop waiting after three seconds without cancelling
   Mongo transport. The entire collection/write run has no new hard deadline;
   a stuck writer can keep the local overlap guard busy.
4. After approved activation, read expected current slots across 16:00–22:00 KST
   on successive days. Check full-grid coverage, partial writes, rejection onset
   and measured HTTP budgets. Report historical hourly/daily gaps separately.
   PM2 online, HTTP 200 or station enrichment does not establish recovery.
5. Check the public API's yesterday comparison against stored observations.
   Merged #2656/#2665 response fixes do not prove primary collection recovery.

Rollback the scoped source change through the existing approved deployment
process. No backfill/data deletion is part of rollback.

## Isolated verification

See [offline commands](../../server/test/offline/README.md#current-grid-collection-2648).
Regression uses real Mongoose 5.1.2 query construction without a DB connection.
Separate HTTP/Mongo smoke uses synthetic responses, actual gather route/Manager/
collector and temporary Mongo. Mongo 7 requires Mongoose 5.13.23's driver;
the smoke adapter does not upgrade deployment or establish provider entitlement.
