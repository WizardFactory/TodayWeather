# S06 specification: bounded complete S3 acquisitions

Owner /root/s05_raw_records; 2026-10-07; consumes [intent](../intent/issue-2691.md) and baseline `4864c9368e78061fbc65b57ac0abaaa3b9408eff`. Root owns the validated publication sequence and shared architecture; this is an internal storage feature, no route or AWS deployment.

## Canonical identity schema (AC1)

`CatalogId {source, kind, key_sha256, partition}` validates existing source/kind/key identity plus a bounded ASCII partition token. Its direct key is `index/v2/{source}/{kind}/{key_sha256}/{partition}.json`. The partition is caller-defined schedule/date/month/warning-type identity, never user coordinates. Provider keys preserve S05 upstream coarse-grid contracts.

`Catalog {schema:1, identity:CatalogId, generation:u64, entries:[Envelope]}` stores identities and provider envelope metadata only, no normalized or merged weather. Entries retain every revision, sorted by `(fetched_at_ms, raw_sha256, canonical identity)`; exact same identity with a different envelope is corrupt, never overwritten. Generation is checked on decode, bounded overflow fails. Canonical JSON is compact serde struct field order; arbitrary normalized bodies are not legal catalog fields (`deny_unknown_fields`). Catalog updates are union-only.

`GroupDeclaration {schema:1, partitions:[CatalogId], members:[GroupMember]}` contains the sorted unique full partition list and ordered members. Each `GroupMember {envelope:Envelope, catalogs:[CatalogId]}` declares its complete sorted unique partition ownership. The envelope has `fetch_group:None` in the declaration. Members are one source/kind/key acquisition; distinct identities remain distinct; nonempty ownership matches member namespace. All expected partitions must be represented exactly by the member ownership union.

Group SHA256 hashes the complete canonical declaration. Member SHA256 hashes the canonical ordered members, partition SHA256 hashes the canonical sorted partition list. Thus no self-reference exists. Descriptor key is `index/v2/groups/{group_sha256}.json`. Descriptor is immutable, conditional-create with Content-MD5, and exact bytes/hash validated on existing412 and read. Each raw envelope receives the resulting S05 `FetchGroupRef` before raw PUT. Raw metadata/ref and descriptor/envelope must agree at load.

Paged acquisitions require each page1..N exactly once in order, same declared N, all complete=true, no unexpected/duplicate/missing pages. Unpaged groups remain ordered by revision identity. No mixed paged/unpaged groups. A previously ungrouped or differently affiliated raw identity cannot be reassigned: fail safely on immutable metadata mismatch. Standalone ungrouped records can be discovered/read only when pagination is absent; an ungrouped paginated body never proves a complete acquisition.

## Publication, CAS and pinned read (AC1, AC3)

`CatalogTransport: ObjectTransport` adds bounded control JSON GET/conditional PUT and ListObjectsV2. Control reads preserve opaque ETag and optional version ID; ETag is only an If-Match token, never a raw integrity hash. No secret/signed URL diagnostics or credential auto-discovery. Existing HttpS3Transport signs real conditional headers/Content-MD5 and reuses coherent refreshable credentials; loopback peer does not establish AWS signature validity.

Publish: validate/prepare declaration and immutable descriptor → descriptor create/reconcile → every raw PUT → CAS union each partition → pin all siblings → verify descriptor, exact member/page/digest/catalog ownership and bounded raw loads → checked complete group result. Successful raw PUT alone is not successful group/client publication. Cancellation after A/new and before B leaves raw/A durable but unreadable as the new group; old complete groups remain eligible.

CAS is bounded read/union/IfMatch (or IfNoneMatch on404), completed PUT200 only.412/409 re-read/union without dropping concurrent revisions. Unknown transport/5xx/timeouts retain cumulative uncertainty; later rejection cannot erase a prior possible commit. Reconcile actual current catalog containing expected union; no extra provider fetch/new raw identity. Corrupt/Invalid remain fail-closed. First direct definitive PUT rejection retains its status. Whole deadline/caps prevent infinite conflict loops.

Reads pin every required sibling catalog exactly once per operation, retaining identity/generation/opaqueETag/version dependency tokens for S07. A descriptor group is eligible only when all declared members are present in the required siblings and raw metadata/bytes validate. A healthy B with only old entries cannot complete A/new. Incomplete groups are excluded from reads/packs/summaries. Valid older groups may still be returned with an explicit excluded-group count.

`LookupOutcome::Ready(CompleteSet)` is a checked nonempty eligible set with pinned dependencies. `LookupOutcome::Incomplete` cannot be treated as provider miss. Missing/empty/healthy catalog reads alone never return a proof of empty coverage. A complete empty result is available only from the repair API's fully scanned explicit candidate scope. CompleteSet fields are private/validated; consumer access is read-only.

## Full bounded repair (AC2)

Caller supplies `RepairScope {catalog, periods:[Period]}` covering the provider resolution's candidate periods; completeness is scoped to this supplied finite set, not the entire archive. Validate prefix identities and candidate count. Repair runs even when the target catalog looks healthy: LIST every relevant canonical raw prefix, follow opaque tokens until IsTruncated=false, then bounded GET/hash/envelope validation. Scope key/source/kind/date/slot/fullhash is recomputed; wrong-key/raw-hash objects are ignored as corrupt and prevent claiming complete empty coverage.

For grouped raw, GET/verify descriptor and the complete members/ownership set, including sibling members outside the scanned target period; only fully checked groups are repaired into every required catalog by CAS. Ungrouped unpaged singleton revisions repair directly. Descriptor orphan with missing body, unavailable sibling, corrupt object, repeated/missing continuation token, malformedXML, timeout or any count/byte cap yields `RepairOutcome::Incomplete`, never complete-empty. Successful fully scanned scope with no candidates yields `RepairOutcome::CompleteEmpty {scope}`; a nonempty restored checked set yields `Complete`. Repair does not invent responses or authorize provider HTTP itself.

## Derived policies and resource bounds (AC1–AC3)

All complete acquisitions are ordered deterministically by `(fetched_at_ms, raw_sha256)` with full canonical identity tie-breaks; pages stay ordered. Immutable policy selects earliest whole acquisition; revisable policy selects latest; absent-only field merge fills only absent top-level properties (present null/zero/false remain); list replacement replaces the whole list with the latest parsed acquisition. Parsing is caller-supplied and memory-only; provider parsers/response caches are S07/later route scope.

Defaults: control JSON/XML <=1MiB, catalog entries<=2048, group members<=128, partition/prefix candidates<=16, LIST pages<=8 per prefix and total raw candidates<=2048, maxkeys<=1000, CAS attempts<=4, operation-wide retained control bytes<=8MiB and decoded raw output<=32MiB. Limit setters are validated with hard ceilings. Saturation/overflow fails safely. Global RSS is not claimed: caller input/results and other stores/concurrent operations also consume memory.

The caller passes an absolute monotonic deadline; it is capped by the configured <=3s default (<=9s hard ceiling). One outer timeout covers credential waits, descriptor/raw/catalog/siblings/repair and retries, not a fresh three seconds per object. Bounded I/O admission spans retained control buffers until bounded spawn_blocking parsing; CPU permits remain owned by started workers after cancellation. Raw gzip work reuses S05 bounded store permits. S06 does not implement single-flight ownership/caches/reservations.

## Verification and limitations (AC4)

Test-first model/page/digest and actual wire regressions: concurrent forced CAS; A/new+B/old; missing/false descriptors; healthy orphan and multi-page LIST; invalidXML/token/caps; committed500/drop/late unknown catalog PUT followed by rejection; first direct403; strict200; deadline/cancellation. Preserve the complete existing S05 suite. Separate release example against maintained task-owned loopback peer verifies cold read/repair with no providers and repeatable wire failures. Root design gets artifact/browser/visual checks. Operator manual editable Markdown, PDF rendered/visually checked, actual usage screenshot+hash manifest. No benchmarks or AWS IAM/auth/lifecycle correctness inferred from local runs.

Versioning/no-delete/IAM role policy remain staging preconditions. Current catalogs retain all revisions, so version-LIST and historical-version recovery are not prerequisites here. Catalog size limits may require future measured identity-only split/root indexing; no silent pruning now. Repair coverage belongs to the explicit caller schedule set; later S07/provider integrations must supply the correct candidate scope. Existing API/cold-cell parity gates remain unchanged.
