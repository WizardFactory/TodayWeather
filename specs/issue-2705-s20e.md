# S20e native forecast narrative specification

Issue2809; source PR2805 at9333d196; criteria in the [intent](../intent/issue-2705-s20e.md).

## Contract and serving

Use the exact ten-office mapping and province aliases from the accepted legacy
source, including renamed provinces. `forecastNarrative` contains stationId
(number), region, announcement, expiresAt, text, language `ko`, source `KMA`,
textFormat `plain`, in that property order. Parse tmFc as a real twelve-digit
KST calendar minute, subtract nine hours for UTC; accept age>=0 and<24h only.
Normalize line endings only. The entire provider items array must be valid,
contain1..10 rows and match the requested office. Select the latest fresh row.
No-data or a bad row must not replace a valid stored publication.

Decorate successful domestic JSON only when its assembled source is KMA and
regionName maps to an office. National KR uses108; unknown country gets no
national narrative. Strip regional narrative from national child weather rows.
No mutation/error/special-warning response gains prose. Delete any preexisting
optional narrative before attaching the selected valid one. A missing or failed
read preserves the original weather/air response. Serve only a validated durable
original, never uncommitted provider data. Reads share the existing request
deadline, with at most two seconds for the optional lookup; cancellation drops
the lookup and cannot start provider work.

Both direct and gateway response writers cap successful max-age to min(existing,
300, floor((expiresAt-now)/1000)); retain no-store for error paths. The same
cache bound applies before HEAD and304 handling. ETag identifies the final body.

## Acquisition and lifecycle

A dedicated owner exists only when native KMA/nation serving is configured.
Construction performs no network acquisition. Start after listeners bind; first
tick is delayed180seconds, then every180seconds with missed ticks skipped and
one cycle at a time. No startup pre-collection is required to serve. Each cycle
tries ten offices serially; errors are isolated per office. Each funded attempt
has at most30seconds; quota/auth/invalid configuration can advance through the
configured key ring once. The existing S08 executor can make its one funded
same-key retry on a retryable/transport failure; that failure never advances the
narrative key ring. No new retry policy is introduced.
Cycle cancellation cannot detach work; process shutdown stops/aborts and joins
the owned task within the existing process drain bound.

Use native data.go.kr transport, DONGNAE keys, API/key/KST-day S08 budgets and
VilageFcstMsgService/getWthrSituation (page1, numOfRows10, stnId). Its documented
development allowance is10000/day/key; operating override remains unmeasured.
No warning/zone/feed/push claim/ledger writes or new production enable mode.

## Persistence and recovery

Store original provider bytes with S06 RawRecord, source
`kma-forecast-narrative`, kind `overview`, named office ProviderKey and actual
fetchedAt. Index each office/publication in an existing v2 CatalogId whose
partition is the validated12-digit tmFc. A single-record `publish_once` API
uses conditional-absent catalog publication after durable raw publication.
The first successful catalog wins across processes. A rejected later raw body
may remain an unreferenced raw object; never union/repair it into the winner.
Reconcile ambiguous catalog writes by reading and validating the winner; never
claim a durable commit based only on an HTTP timeout or a local cache.

On serving, bounded catalog LIST for today/yesterday KST discovers possible
fresh publications, validates the latest committed raw record and reconstructs
the object. Cap page/key counts and body sizes with S06 limits. Corruption or
partial/failed discovery omits prose; it must not claim a complete history.
Use only bounded ten-office in-memory read caches, with short refresh and
expiry checks on every return; background commit invalidates that office cache.
Memory loss needs S3 reads only. No Mongo/legacy asset dependency or derived
weather-view persistence. Ordinary CatalogStore.publish union semantics stay
unchanged. No retention deletion or IAM-prefix expansion is introduced.

## Verification and operations

Freeze a test-only legacy oracle under server2 tools; it can evaluate named
legacy files in isolation but is never a runtime dependency. Compare aliases,
UTC/expiry/text/object order and unchanged fields, including no-data/malformed
cases. Test concurrent first-writer publication and ambiguous writes separately
from HTTP serving. Real release-binary smoke uses owned loopback provider/S3
peers; test initial background acquisition through a test entrypoint, then
restart with providers disabled and verify native HTTP recovery and no extra
provider calls. Test HEAD/304/cache expiry, request cancellation, coalescing,
budget/key isolation, shutdown and no warning/push state mutation.

Retain original Red logs, green/post checks, independent smoke, source identities,
manual capture/PDF and diagram gates. Do not label local results production
parity, seven-day shadow, quota/host readiness or full-release rollback.

## Alternatives and risks

Request-time acquisition was rejected because optional prose must not collect
providers from HTTP. Reusing warning jobs/state was rejected to preserve
failure isolation. Catalog union plus earliest fetch time was rejected because
late commits could replace the first committed text. A parallel normalized
S3 view was rejected in favor of existing raw/index formats. The main risks
are identity/time validation, cross-process immutability and deadline/cache
interaction; tests must demonstrate these before integration. Rolling back
this code leaves immutable raw/index records intact and does not replay sends.
