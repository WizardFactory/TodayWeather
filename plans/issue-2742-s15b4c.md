# Plan: verified disposable weather disk cache

Owner OpenAI main, task issue-2742-s15b4c, base 88448ddf, endpoint pre-merge.
Inputs: [intent](../intent/issue-2742-s15b4c.md), [spec](../specs/issue-2742-s15b4c.md),
[sequence](../docs/architecture/diagrams/server2-disk-cache.html).
Declaration: [S15b-4c.json](../server2/config/tasks/S15b-4c.json).
Execution notebook: ignored `.planning/s15b4c/`; state/evidence: ignored reports/sdlc/issue-2742-s15b4c.

1. Red: write explicit cache/transport tests for restart GET reuse and corruption/missing recovery;
   confirm they fail because the cache API does not exist. No real env/provider/AWS reads.
2. Implement bounded checksum-verified files and one namespace owner, byte/entry/temp accounting,
   atomic replacement, safe miss/error/eviction and bounded owned background fill.
3. Wire optional verified-raw capability through ObjectTransport/BoundedS3, S3Settings and
   RawRecordStore only. Do not alter runtime.rs, mutable catalogs, state/budgets/geocode or source wait.
4. Green/regression: cache tests plus relevant storage/catalog/domestic/summary cases; fmt/clippy.
   Run full suite once on the final integrated candidate. Coordinate build slot; jobs2/debug0/incremental0.
5. Actual binary HTTP smoke/measurement with isolated local S3/provider roots injected in harness.
   Measure cold RAM/disk, restart warm disk and repeat RAM, disk loss/corruption/eviction, concurrent
   pressure and slow provider. Preserve same-ready-input bytes/ETag, <=3 s acquisition wait and no
   legacy hop. Record wire counts/bytes, disk allocation, temp high water and CPU/RSS; label all
   timings as local evidence, not AWS/EBS claims. No decoded cache/pack without measured need.
6. Compute capacity from measured cache/temporary footprint plus labelled OS/binaries/logs/headroom;
   update infrastructure Markdown, actual CLI capture, rendered visually checked PDF, prerequisites
   and cache architecture. The intake 32 GiB example is not a final sizing result.
7. Placement/dependency review, artifact policy staged/outgoing, clean selected evidence; commit/push,
   independent PR review/corrections and CI. Parent owns final merge, no auto-merge/queue/deployment.

Scenarios (CACHE/RECOVERY/BOUNDS/PRIVACY/CAPACITY) are the nine cases in the approved intake:
empty RAM+disk/S3 populated; empty everything/slow provider; restart warm disk; warm RAM;
missing/corrupt/truncated/swapped local file; eviction/full/unwritable; late catalog revision/bad S3;
cancellation/restart temporary writes; namespace/privacy separation. The test receipt maps them to
concrete tests and captures. Local cache failure must never widen authority or cause durable data loss.

Riskiest boundary: cached content must not replace S3 publication/absence/completeness decisions.
Unchecked transport caching and mutable catalog disk snapshots are rejected. Existing S16 exclusions,
raw codec limits and CAS publication tests are reused as regressions. Source absence remains a miss;
corrupt canonical S3 keeps the existing route behavior. Cache is an optimization, not a backup.

Rollback: remove real cache path/cap configuration or revert the implementation; S3 data is unchanged.
Only task-owned cache files may be removed. Original records, unrelated local files and other
worktrees are preserved. No S3 delete or provider pre-collection occurs.

Parent-approved refinement: the dedicated root cap includes old namespace raw/temp allocation under a root capacity lock; only current namespace eviction is allowed. Cache fill skips if other namespaces consume the cap. No decoded sidecar or pack is added: local native raw GET improvement does not prove cold p95, and catalog reads remain the measured bottleneck.
