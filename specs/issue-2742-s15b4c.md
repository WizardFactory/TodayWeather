# Specification: verified immutable weather raw disk cache

Intent: [intent](../intent/issue-2742-s15b4c.md). Owner OpenAI main, base 88448ddf, 2026-10-16.

The optional ObjectTransport cache capability defaults to None and is forwarded by BoundedS3. S3Settings reads SERVER2_LOCAL_CACHE_DIR and SERVER2_LOCAL_CACHE_MAX_BYTES (default 8 GiB when a directory is configured; no directory means no disk cache). MAX_BYTES alone or invalid/zero cap is configuration error. No mode, provider key or endpoint setting is added. No runtime.rs edit.

RawRecordStore consults the cache only for a validated expected RecordId of data-go-kr, kma-web, vc, or exact airkorea-image/airkorea-forecast-image. It still verifies the complete identity and raw codec. Other sources, state/budget/control/negative/geocode data are ineligible. CatalogStore remains unchanged and checks S3 publication before loading members.

Files are opaque hashed names in a bucket/region/endpoint/schema namespace. Format: bounded header with key and S3 object metadata, bounded immutable gzip body, checksum over both. Disk read validates framing, namespace/key, declared size and checksum; the existing codec validates raw identity/body. Any local error/corruption is a miss, local invalidation and canonical S3 recovery; corrupt canonical S3 retains the existing error. No negative cache. No local cache write acknowledges S3 publication.

Use private owned directories/files, refuse symlink cache entries/root, one OS file lock per namespace and bounded blocking admission. Atomic temporary write+rename; caps include committed and temporary allocation charges, across all namespaces under the dedicated root, and a fixed entry cap limits per-namespace inode use. A root OS lock serializes admission and temp lifecycle; only the current namespace is evicted, otherwise fill is skipped. Startup scans/prunes only owned namespace regular hash-named files and incomplete temporary files. Unwritable/ENOSPC/owner-lock failure safely bypasses cache. Cleanup never touches unrelated files or S3. Eviction uses least-recent access while running, file modification order after restart. Operators sharing a root must use the same cap; directory/inode overhead is counted in root headroom. File loss/replacement while live invalidates that entry.

Cache writes are best-effort bounded owned work after raw verification; they must not add an unbounded request wait or task queue. Memory for a copy/decoder is bounded with the owned write permit until actual completion. Counters contain no keys, locations, URLs or credentials.

Recovery and freshness: mutable catalogs/listing/absence proofs are never cached. A cached raw is used only after the same existing catalog/expected-identity decision. Late revision and S16 excluded-group accounting remain unchanged. Request wait, backend/legacy error shaping, source acquisition ownership and provider timeouts are not extended.

Alternatives rejected: unchecked transport cache could poison verified reads; global automatic test cache leaks across fixtures; mutable catalog cache could hide publication; packs do not yet have measured need.

Verify primitive and real local S3 transport behavior, actual HTTP binary results, cold RAM/disk and warm disk restart GET bytes/counts, corruption/loss/caps/temp/namespace/privacy; retain source/fixture identity. Production S3/EBS measurements remain outside this task. Deliver setup Markdown/PDF, capacity assumptions and prerequisites; independent review/CI before readiness.
