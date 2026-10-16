# S15b-4c verification

Owner: OpenAI main. Reviewed parent `88448ddf` is integrated as master `ec32c73f`;
the trees are identical. This task's source identities and built binary hashes
are in [capture.json](capture.json); the final PR binds the committed candidate.

Intended Red: the new cache tests failed to compile with missing `cache::disk`
and missing `ObjectTransport::raw_cache` (E0432/E0407). Initial wrong-directory
setup was not counted as intended Red. Green: cache integration 9/9 and disk fault
unit tests 8/8, all-target Clippy with `-D warnings`, debug process and measurement
examples passed locally. Initial Clippy style findings were corrected. The complete binary coverage combines the initial workspace suite with corrected
gateway/cache and previously unexecuted binaries: **792 unique Rust tests passed,
2 pre-existing slow sweeps ignored**. The old variable allowlist failure is retained;
only its test constant/comment changed. Placement and staged artifact checks passed.
Independent review and CI results are recorded in the final PR; this receipt
does not pre-claim them.

Coverage includes empty disk/RAM and restart hit; corrupt/truncated/missing raw
and entire live cache-directory loss; locally checksum-valid forged metadata;
corrupt canonical S3; byte/entry eviction; allocated-block/temp reservation;
ENOSPC after temp creation; stale temp cleanup; namespace/root OS locks;
old-namespace temporary allocation/root-wide cap; concurrent two-namespace
admission; owner conflict; symlink/private files; explicit config with no `.env`;
privacy-source exclusion and dropped bounded write reservation.

The [actual local HTTP measurement](cache-measurement.json) uses an owned S3 peer
and actual `loopback_server` binary. It seeds three synthetic recent grid current
publications and an incompressible 6 MiB raw object under the exact image source
identity. This object is **not a valid GIF** and measures raw storage/verification,
not the AirKorea decoder. Native direct KMA requests return 200 with identical
response SHA across cache unset, cold disk and empty-RAM warm disk, with zero
legacy hops. Warm disk reduces raw GETs from 3 to 1 in the selected sample; 371 catalog GETs remain. Optional fills can be skipped under bounded contention; an earlier sample reached 0, which is not guaranteed. The
[rendered result capture](cache-measurement.png) derives from that actual JSON.

The sample's warm raw elapsed time is slower than cold raw elapsed time; checksum
and raw decoding remain. No timing speedup, full-data parity, production cold
p95, EBS IOPS, provider quota, live GIF, IAM or AWS result is claimed. The root
recommendation is 32 GiB gp3 for the **labelled** 8 GiB cache cap + OS/binary/log/
non-cache temporary budgets + 25% free-space assumption. Cache temporaries are
inside the global cap, not counted twice. Real S19/S20 cold measurements must
establish whether mutable catalog latency needs O01 or decoded caching.

No actual `.env` was read/changed, provider/AWS/DB called, push sent, resource
created, deployment performed or merge invoked by this task.


## Independent review correction D4C-R1

The reviewer found that a warmed local raw could mask canonical S3 body corruption
when `publish` reconciled a conditional/uncertain PUT using matching HEAD metadata.
The added regression first failed with `Ok(AlreadyPresent)` after changing only
the canonical bytes, preserving their length and metadata. Reconciliation now
bypasses local cache and always GETs/decodes canonical S3. Ordinary `load` keeps
its immutable cache path. The selected performance capture above predates this
correction and remains bound to its recorded source hashes; it is not relabelled
as a later execution. Corrected focused/HTTP checks and reviewer confirmation
are recorded on the final PR.
