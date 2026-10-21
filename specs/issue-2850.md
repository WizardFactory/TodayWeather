# Forecast cache lifetime and SSD restoration

Consumes [intent](../intent/issue-2850.md), baseline PR #2841 at `307defeb` and
source investigation on 2026-10-22. This amends D2 source-view lifetime only;
S07 final-response caching keeps its existing non-extending TTL.

## Retained behavior

The 13 grid/RSS/mid views and native HTTP response remain byte-identical to the
retained oracle. Keep complete-acquisition ordering, capacity limits, original
S16 input identities, own-write overlay and request/owner deadlines. Cache errors
fall back to existing source reconstruction; expired/failed validation never
silently renews or serves an old view. No new mode, API, provider call or legacy
runtime dependency.

## Key-local ownership (AC1)

An acquisition maps to exactly its Grid(family,x,y), Rss(x,y) or Mid(model,code)
view key. Zones, warnings and unsupported forecast families have no view key.
Advance the affected generation at future entry and retirement (success/error,
abort or panic). Unrelated keys remain readable. Bound registry growth; retain
key-state identity while any view, writer or build holds it to prevent ABA.
A writer blocks affected memory/disk admission; post-writer readers cannot join
an older generation's build. Overlay answers remain request-local and unpersisted.

## Selector-bound lifetime (AC2)

Keep the build's wall instant; reject earlier clocks. Expire at the minimum of
future acquisition visibility, a changed latest-publication/retention anchor,
removal of an included oldest partition, RSS hourly run time, searched-month or
KST-day boundary. Compute these using existing pure selectors; an arbitrary
minute boundary alone is not invalidation. Boundary equality misses. Renewal
cannot move a selector boundary. Day/month expiry is conservative where no output
row changes and prevents carrying a view into a new calendar scope.

## External changes (AC3)

**Maximum observation delay: 30 seconds**, measured using both advancing request
wall time and process monotonic time since the start of the last successful
identity check. This is an explicit task design choice retaining D2's prior
bound, not an attributed AK timing decision. Identity checks can renew the source
view because its complete immutable inputs and pure-selector interval prove the
fold unchanged. This intentionally replaces D2's full-refold-on-expiry rule;
S07 response TTL is unaffected.

IndexListing exposes keys only, so revalidate every searched month (including
empty newer Mid months) with LIST, then GET each retained partition's catalog.
Canonical fingerprints include complete acquisition, page and fetch-group
identities, not just partition names or latest timestamps. A changed set rebuilds;
a failed/incomplete check cannot renew. Raw GET, raw parse and fold deltas are 0
when fingerprints match. Control cost per check is **L LIST + P catalog GET**:
L is the actual monthly pagination count (at most 4 pages/month), P is the number
of selected partitions (at most 1024). No descriptor/raw GET is required for
unchanged identity. Record observed costs for the retained corpus. Cold builds
capture controls before raw reads and compare the same scope after reads before
admission, rejecting concurrent identity movement.

## Disposable disk (AC4)

Reuse the configured DiskCache Arc: directory/namespace ownership, two-operation
admission, root-wide allocated-byte cap, atomic private files, verified hashes and
LRU are shared with raw objects. No second cache directory or setting. Persist
only complete, non-overlay, generation-fenced views. Folded documents, required
raw-page handles, original summary IDs, usable partitions, canonical identity
scope, wall/boundary and explicit parser/schema revision form the payload.

Restore checks bounded file length/hash, revision and key, selector interval,
then the current authoritative identity scope before memory admission. Restore
uses zero raw GET, raw parse and fold; deserialize work is separately measured.
Preserve floating-point bits (including NaN/infinity/-0), undefined and ordered
properties. Do not use projected API JSON as the stored representation. Normal
miss, corruption/truncation, wrong key/identity/revision, admission failure and
changed controls reconstruct from S3. A local disk file never establishes truth.
No upgrade migration: mismatched files are disposable. Disabling existing local
cache settings restores memory/S3 behavior. Record serialized/allocated sizes,
restore time and floor(memory budget / town weight), floor(8 GiB / town disk
weight), including metadata and shared-raw contention assumptions.

## Verification and documentation (AC5)

User scenarios in [plan](../plans/issue-2850.md) map each outcome to focused tests
and the owned loopback S3/native HTTP smoke. Cover writer start/drop/abort/panic,
revalidation races, boundary equality/rewind, disk eviction/restart and corrupt or
capacity misses. Compare all 13 goldens and exact HTTP bytes. Update D2, operator
guide and generated Archify lifecycle. Placement matches the intent declaration.
Local measurements do not attest EC2, production parity, live providers or S19/S20.
