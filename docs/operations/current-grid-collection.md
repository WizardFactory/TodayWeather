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
collects it. Missing data/core fields and failed writes remain eligible; optional-only
partial rows use the bounded repair policy below. This is a source/fixture
budget, not measured production usage or a hard quota cap.

Short/shortest schedules remain unchanged: their baseline first-pass grid fetches
are 24 × N and 96 × N respectively. Short continuation pages, retries and other
consumers add requests. Preserve the [#2604 bounded concurrency/retry budget](gather-runtime-policy.md#quota-and-key-rotation-2604).

Summed current/short/shortest first-pass grid traffic after successful filtering is
144 × N/day: 24N + 24N + 96N, or 292,608 for 2,032 grids. Before filtering it was
264N, or 536,448. This aggregate reduction is 45.45%; 83.3% applies to current alone.
It does not establish which operations or consumers share an approved quota.
Persisted partial wind/REH rows deliberately stay pending; a writer's successful
callback is not a declaration of complete observations. Measure their frequency
and later repair before relying on the ideal complete-publication budget.

### Optional-field repair policy

Each Manager remembers at most two collection admissions per coordinate for its
current publication. Initial and joined polls use one admission together. Once
an exact-hour stored row has valid finite t1h/rn1/pty but incomplete wind or REH,
after two admissions later polls defer it. One initial partial observation can
therefore receive one later repair walk; if that response is complete, subsequent
polls skip it through ordinary coverage. Useful partial observations stay stored.
Deferred rows stay pending and the callback returns an incomplete error, including
when every pending row is deferred and no HTTP is sent. Missing/wrong-hour data
and invalid temperature/rain/type remain eligible on later polls.

The allowance resets when the inactive coordinator starts another publication,
and on process restart. It is a per-process admission policy, not a persisted
repair ledger or shared HTTP quota cap: pages/transport retries, absent/core-invalid
grids, multiple workers, restarts and alternating manual publication requests
remain additional traffic. Values that arrive after the two-admission allowance
is consumed are not fetched again for that publication by that coordinator;
next-hour collection proceeds, and historical gaps remain separately reported.
Measure deferred frequency and decide any historical recovery through a separately
reviewed/authorized policy; no backfill is added here.

For N grids and P consistently optional-only partial grids per publication,
six-poll first-pass volume becomes N+P/hour (24N+24P/day), under one uninterrupted
process and successful persistence, before the exclusions above. The ideal83.3%
current saving applies to P=0. Complete coverage must not be claimed when P>0.

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
- current-repair-plan: UTC time, publication, pending, eligible, deferred and
  limit2. The callback also reports deferred; these rows are included in pending.
- forecast-pass: UTC completion time, KST hour, product/key index, publication,
  attemptsByKstHour including pages, received/pending counts and stop reason.
  Received counts completed fetches; pending equals failed plus rejected. Failed
  counts retryable incomplete rows, rejected counts non-retryable rejected rows.
  These fetch outcomes do not replace persisted coverage.
  Aggregate each pass once by product, key index and KST hour. Fetch counts
  differ from persisted coverage.
- first-quota: UTC response time, KST hour, requestKstDay, product/key index,
  daily-quota/per-second/unclassified-429 reason and current cooldown action.
- current-collection-stop: UTC time, publication and static `deadline` reason;
  this is a terminated run, not proof that coverage was recovered.

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
   Mongo transport. `GATHER_CURRENT_DEADLINE_MS` defaults to 540000 (nine minutes)
   and bounds the complete current run. On expiry it aborts active HTTP requests,
   clears delayed recursive retries, stops admission of new saves and releases
   only its own active run. Late callbacks cannot clear a later run or admit a
   new write. A previously submitted Mongo read/write may still finish at its
   original publication identity; there is no Mongo cancellation or rollback.
   Different-publication busy remains eligible at the next scheduled poll.
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
