Task: issue-2695-s10; owner: /root; revision/base: 07fdaf991d617f16944d75c201d64f35a4f2c83a; date: 2026-10-13.
Authority: AK requested S10 implementation and parallel subtasks; endpoint pre-merge.
Criteria: WIRE, GEOCODE, OWNERSHIP, PRIVACY, ACTIVATION, PLACEMENT.
Issue update assessment: publish consolidated implementation plan/path declaration after design, avoid duplicate intake comments.

# Specification
Intent: [S10](../intent/issue-2695.md).

Gateway accepts owned weather/geocode aliases; all other owned variants/methods return legacy404, bad percent encoding/input400, normalizedzero404, provider/backend/deadline failure501, unavailable/admission503 with legacyretryafter. GET impliesHEAD, matching weak ETag returns304, OPTIONS preserves CORSpreflight. Preserve JSON insertion order/numeric property ordering and functional Express headers/ETag. Transport Date/Connection observation is distinct from functional parity. Decode query last value per key while keeping first order and encodeURIComponent alphabet.

Backend dispatcher keys mode by family and version. Explicit legacy HTTP target is default. Native handlers must be registered before switching. Each fetch has <=3s timeout, up to3 attempts bounded by9s overall, retry only legacy-classified cases. Weather unavailable marker preserves retryAt mapping and terminates retries. Gateway geocoder trait returns typed ordered GeoClient.

Geocoder exact requested coordinates normalize to legacy3decimals. Preserve provider-specific classifications/rotation and asymmetric fallback, <5s lookup and <=3s provider attempt. Owned spawned flight has finite admission and memory budgets; all waiters share result and retries; dropping one waiter does not release owner permit or reset quota. Fund maximum possible per-key chain once before HTTP through S08 reservation adapter; no refunds or late reservations. Real configuration absent quota evidence cannot activate live HTTP. Explicit loopback-only mock peers remain available for local verification.

Coordinate results/key histories never enter S3, catalogs, packs, metadata, logs or disk. RAM cache bounded by bytes and30dayTTL. AddressStore interface only accepts address lookup projections with time/size/schema validity. Optional S3 adapter persists permitted address projection using hashed address identity and bounds; reverse coordinate paths cannot invoke it. S3 write failure cannot report new durable address success; fall back/error per accepted route behavior. Coarse coordinate cache is not implemented/activated without boundary/locale/returnedcoordinate exact-label proof.

Runtime startup gateway is opt-in; operator provides legacy target and injected existing environment. Existing health/private metrics remain. Missing native handler/quota fails closed; legacyHTTP rollback remains configurable. No production switch/shadow/AWS action from local verification. Aggregate counters only, never request query/provider error strings.

Testing: wire fixtures, typed-provider fixture parsing, boundary/locales, input/conditional/preflight, owned cancellation/retry counts/deadline/capacity, privacy sink negative tests and addressexpiry/corruption, quotaexhaustion, switchrollback. Existing foundation/cache/storage/budget tests remain. Additional actual releaseprocess smoke uses owned loopback peers and realHTTP; it proves local integration, not live providers.

Alternatives rejected: global serde preserve_order changes canonical hashes; persistent precise/coarse reverse bodies violate privacy/unprovedlabels; universalGoogle fallback changes legacy; runtime dotenv reading from legacy couples new runtime to legacy assets.

2026-10-13 correction: actual legacy deadline returns501; capacity and explicit weather-unavailable return503. This corrects initial prose, preserving source/wire oracle and implementation behavior.
