# D2 domestic forecast memory contract

Base: c1ae9082b2c86f0087727be9872b0cf82b4e3bb1. Endpoint: pre-merge. Root owns stages, Cargo scheduling, shared documentation, commits and review. No merge, cloud action, provider campaign, live send or seven-day shadow is authorized.

## Reuse and observable parity

A process-shared S3Source owns typed Grid(Family,nx,ny), Rss(nx,ny) and Mid(model, original logical region) entries. Include parser/schema revision and source/storage-instance identity. Reuse immutable final Docs, exact canonical raw handles, identities and eligibility/publication facts. Do not retain parser trees in this slice, cache final responses or include station/air/life/warning/narrative. Complete idle hits add zero forecast LIST/catalog/descriptor/raw GET, BODYOUT, parse or fold. Exact current Docs, ordering and S16 identities match the uncached path; units, language, version, town labels and assembly remain request-owned.

Canonical changes refold the full ordered source set. An own awaited acquisition may have a request-private visible clamp; retain original identity/fetched time for S16, pin the canonical parent, build that overlay under its own charged ticket and never install it as shared truth. Public Vec-returning compatibility methods may copy for callers, but the native Snapshot pins leased handles and does not deep-clone cached Docs outside an admitted workspace.

## Freshness and local writes

Reuse begins at first validation admission/read, never completion, and lasts at most30monotonic seconds. Clip at every Current217h/Shortest247h/Short361h/RSS312h oldest-partition minute, publication/retention/retry/mid08/20/RSSHH02/latest/month/day boundary and known future-fetched equality. Recompute pure selectors from existing helpers; wall rewind, forward boundary or nonfinite clock is a miss. Do not substitute a wider month projection. Complete external writes, deletes and new faults may remain unseen only within the accepted clipped interval. Expired or failed refresh never serves/renews the old view.

Wrap the actual ForecastAcquire installed by with_forecast. An RAII guard begins before its detached provider/publication future and finishes at actual completion/drop, covering success/None/error/ambiguity/panic. Increment a checked epoch and active-writer count and invalidate forecast views at both ends. Check active writer, epoch and installation under one short mutex; no install races or wrapping epochs. Do not attach invalidation only to an outer waiter. Warning/zone collection does not invalidate unrelated forecast views. Unhooked and other-process writers follow the external bounded-refresh rule.

Every request still evaluates acquisition eligibility from present/usable facts, including short +2/+5/+10 retries and per-request mid collection. A cache hit cannot suppress required acquisition. No new provider timing, retry or publication budget is introduced.

## Complete reads and failures

Use a source-private counted Reader path with all canonical acquisition/member identities and excluded count. Process one partition at a time with checked scope totals before retention/dispatch. RSS and mid propagate exclusions through every searched newer month, including an older fallback. Existing eligible partial Docs may be returned privately to current cohort, but incomplete/excluded views never map or get a reusable TTL. Completely verified parse rejection remains different from missing/corrupt/excluded storage. Never turn an error into a successful empty cache, extra provider funding or stale fallback.

## Bounded ownership and memory

Use existing ByteBudget, WeightedCache and S07 ownership; no new generic cache/storage framework. Reserve a workspace before input/build growth. At most2 active owners,8 queued keys,10 admitted keys and128 waiters; owner8s includes queue/I/O/CPU wait, completed-flight retention0. A town build holds no aggregate workspace/cache lock while joining families. Retained insertion is nonblocking after bounded eviction; pinned old values can cause Capacity through existing dependency behavior. No unbounded uncached retry or expired fallback.

Snapshot, overlay parent and retained flight result all hold the same charged Arc after map eviction. Release charges only after the last pin drops. Charge actual backing Vec/String capacities, inline/Arc roots and exact identity/member storage with checked traversal; never serialized JSON or RSS as Doc weight. Count inline headers once, all heap descendants and round-up16(capacity+64) logical allocator allowance.64 is policy, not measured allocator overhead. Share raw handles without a second uncharged lifetime; independently owned duplicates may be overcharged.

Before source parsing, bound page bytes, depth32, node/field/item/row counts and summed acquisition parse plan. Add fallible bounded converter/saver variants in items/grid/rss/mid/doc for cache paths, preserving existing compatibility semantics. Reserve/check before Vec/String/Doc growth, clone or output materialization; a late size check after arbitrary serde growth is insufficient. Use try_reserve_exact and checked copies or a small typed converter where required. No HTML/AWS parser or global allocator rewrite.

D2 blocking parse/fold owns its CPU/workspace/input handles until actual closure completion even after waiter/owner timeout. A timed-out closure cannot install later. No CPU permit or state lock spans S3/provider await; no nested CPU acquisition. Existing S06 codec timeouts retain their own bounded slots and are not magically covered by the D2 workspace. The profile bounds D2-owned lifetimes and declared logical input work, not every pre-existing provider/HTTP/serde allocation or whole-process RSS.

## Fixed admission profile

{
  "retained_bytes": 134217728,
  "entry_total_bytes": 50331648,
  "entry_raw_payload_bytes": 33554432,
  "entry_doc_bytes": 8388608,
  "entry_identity_metadata_bytes": 4194304,
  "mapped_entries": 128,
  "metadata_pool_reservation_bytes": 1048576,
  "active_workspaces": 2,
  "workspace_bytes_each": 201326592,
  "logical_retained_plus_workspace_bytes": 536870912,
  "queued_keys": 8,
  "admitted_flight_keys": 10,
  "waiting_callers": 128,
  "cache_cpu_jobs": 2,
  "reader_partition_slots_per_owner": 1,
  "forecast_catalog_io": 2,
  "forecast_catalog_cpu": 1,
  "forecast_raw_buffers": 2,
  "forecast_raw_cpu": 1,
  "partitions_per_scope": 1024,
  "acquisitions_per_scope": 2048,
  "raw_pages_per_scope": 8192,
  "source_page_bytes_before_parse": 1048576,
  "json_xml_depth": 32,
  "shape_nodes_per_page": 32768,
  "items_per_acquisition": 4995,
  "raw_fields_per_item": 64,
  "fields_per_materialized_row_or_doc": 32,
  "rss_rows_per_page": 1024,
  "docs_per_view": 4096,
  "parse_workspace_bytes": 50331648,
  "owner_deadline_seconds": 8,
  "finished_flight_retain_seconds": 0,
  "maximum_freshness_seconds": 30,
  "numeric_values_mean": "fixed conservative admission choices; not measurements of heap/RSS or production capacity; baseline fit analytically bounded then mandatory actual weigher tests before acceptance"
}

The logical128MiB retained plus2x192MiB workspaces is512MiB, not a host-memory or hard allocator bound. Per entry32MiB raw,8MiB Docs,4MiB identities within48MiB. Static fixture-shape arithmetic is only a prospective basis: the actual complete baseline corpus must fit the implemented default weigher and its raw/Doc/metadata charges must be retained. If it fails, stop and return to root; do not silently raise caps, remove horizon rows or rename JSON bytes as heap weight.

## Required verification and limits

Retain original complete730-acquisition/851-page seed and845selected-page inputs and outside-window sentinels. Preserve actual native baseline failures and all compile/scaffolding failures. Meaningful regression must expose warm repeated source I/O before the fix; no missing-symbol Red. Test all freshness/clock/future/writer/partial/raw-identity boundaries, old pins and blocking cancellation, exact-cap +/-1 and overflows, independent keys and request-private overlay. Then run the same complete default-profile corpus with actual charges and an additional optimized normal native HTTP workflow. Diagnostic60s/library success is never native3s or coldp95 proof. Production host/city capacity, global CPU/S3 metrics, full recovery and seven-day shadow remain separate gates.


## Failure-informed raw versus materialized field boundary
The first complete source regression retained a genuine failure: existing mid-temperature raw pages are only843–848 bytes but carry49 fields (including low/high alternatives). A32-field limit for raw Items accidentally rejected this supported input. The fixed raw Item bound is now64 fields; canonical materialized Row/Doc remains32. Preserve all raw scalar fields and full duplicate identity; do not project away unknown keys. This is an explicit reviewed contract correction, not a silent passing-cap increase. All existing page/depth/node limits, checked48MiB parse scratch,32MiB raw entry,48MiB whole entry,192MiB owner workspace,128MiB retained and512MiB aggregate logical envelope remain unchanged. Actual capacity-based charges must precede allocation and enforce these unchanged limits.

Regression acceptance: pinned valid49-field mid Item equals the original converter including unknown fields; exactly64 raw fields succeeds unchanged;65 fails Capacity independently of page/node limits; exactly32 canonical fields succeeds and33 fails. Then renew complete source/oracle/late/S16/parity and full730 default-fit/diagnostic with no reduced corpus or cap override. Prior focused Green and35pass1fail source result stay in the evidence. No production capacity or allocator/RSS bound follows from static limits.
