# S08 durable provider admission specification

Consumes [intent](../intent/issue-2693.md), base `94019cf5` and S01 O-5/O-9/O-10.
This implements internal primitives, not provider-route parity or a deployed quota policy.

## Separate quota namespace and ceiling (AC1)
`budgets/v2/{provider}/{opaque_quota_key_id}/{window_id}/authority.json`
holds version2 immutable policy plus `used` high-water. Policy includes provider, logical
quota owner (64 lowercase hex, never the actual key or coordinate), stable provider-local
window ID/start/end, limit and block size. Only trusted operator configuration creates
policies; client request IDs cannot change quota namespaces. All instances for the same
real quota owner must share this identity/policy. Different endpoint quotas require
operator-confirmed namespaces, not guessed limits. No deletion/reset/lifecycle expiry or
version rollback is allowed; this is a production IAM/configuration prerequisite.

Read authority with a bounded JSON GET and opaque ETag. Validate exact policy/schema and
`used <= limit`; malformed/mismatch/overflow fails closed. To obtain a block, calculate
`amount = min(block_units, limit-used)` with checked arithmetic and sufficient requested
max cost. Conditional creation or ETag CAS writes `used+amount <= limit`. Only 200 is an
acknowledged grant of `[used,used+amount)`. A bounded 412 conflict may read and recalculate;
unknown, 409, or 5xx/transport/timeout never grants ownership or sends provider HTTP. No SDK
retry can independently repeat allocation. In-memory observed floors cannot decrease.

After acknowledged CAS, publish its immutable JSON witness with `If-None-Match:*`:
`budgets/v2/{provider}/{opaque_quota_key_id}/{window_id}/blocks/{start}-{end}.json`.
The witness identifies policy/range/unit capacity only; no request coordinates, provider
URL/key, IP/device/subscriber/token or normalized weather. Only acknowledged witness
publication permits private in-memory subdivision. Raw-record/catalog objects are not
budget authority. Budget writes sign conditional headers and MD5 over JSON bytes.
A witness conflict/error/unknown outcome denies this acquisition and leaves its range spent.

A cold new block has three dependent S3 waves: authority GET, CAS PUT, witness PUT.
A conflict adds another GET and conditional PUT. Funding from an existing live owner's
memory block has no S3 wave. The earlier architecture reservation assumption of
0.1–0.2 seconds is not a measurement or a promise for this three-wave primitive.
S09 must measure the actual path, block waste and headroom. Replacement loses each
live block's remaining unused units, at most its block capacity; multiple key blocks
contribute separately. No benchmark is claimed from local HTTP peers.

A store may subdivide only a block that this live owner acknowledged in both steps.
Issued request units are debited before HTTP and are never refunded. A new store/Spot
reads the current high-water and never claims unused old witnesses. Crash/cancellation
between CAS/witness/permit/HTTP burns acknowledged capacity. If an unknown CAS committed,
its durable high-water is retained; replacement or late completion cannot allocate overlapping
ranges. A never-committed/unrecorded CAS attempt cannot be identified after replacement.
The safety claim is no HTTP without verified admission, not an impossible permanent charge
for a write that left no remote record.

## Budget APIs and bounded waits
- `BudgetTransport`: bounded authority GET and conditional JSON PUT under budgets/v2 only.
- `BudgetPolicy`, `Authority`, `RangeWitness`: validated serializable schema, no secret Debug.
- `BudgetStore<T>::reserve(max_units, absolute_deadline)`: private non-clone reservation,
  issued only after acknowledged durable funding. No caller can manufacture attempt permits.
- Only the funded executor can consume reservation units into an attempt permit.
- Per-store I/O admission, mutex wait, CAS loops, credential waits, reads and writes share
  the original absolute Tokio deadline. transport three-second maxima cannot extend it. Cooperative
  owner cancellation/drop denies incomplete work; committed ranges stay spent.
- Explicit trusted provider-local window is valid at funding and each attempt. Wall time
  moving backwards within a store fails closed; no namespace/reset is silently generated.
  Monotonic elapsed time governs deadlines. Clock trust and stable configuration after host
  replacement remain operational prerequisites, not evidence supplied by a local clock fixture.

## Maximum funded acquisition (AC2)
A generic S08 executor owns funds and HTTP attempts; it is independent of the unfinished S07
branch. S07 owns its resolver FundedAcquirer/request/context/result trait; a later adapter maps
its absolute owner deadline/cooperative cancellation and privately held provider mapping to
S08 execution. Waiter cancellation is distinct from owner shutdown. Quota denial/unknown
is terminal and cannot become a provider fallback. S07 admits acquisition only after finite
repair CompleteEmpty and publishes a complete raw group through S06 before new success.

Total provider HTTP attempts are at most 2. VC per-attempt records 49/25/1 gives upfront maxima
98/50/2. data.go.kr first candidate quota reserves two calls; an optional next key reserves
one additional call before the first HTTP. This conservative 3-unit funding covers either
one same-key transient retry or one quota/auth rotation, never three actual HTTP attempts.
If any candidate funding fails, provider calls remain 0 and any earlier reservations stay spent.
A later request may use a rotated configured key; secrets remain privately held in memory.
The default block size of 256 units is an engineering choice; deployments may configure it. `max_units`
must fit one block; leftovers and final partial capacity can reduce usable headroom, never
increase it. Tests use small limits/blocks to prove exact ceiling and waste behavior.

Rejection rules port server/lib/dataGoKrRejection.js (#2604), with provenance and no runtime
legacy reads: HTTP 429 or code 22 => quota; HTTP 401/403 or 20/30/31/32 => auth. Either stops
retrying that key and may use the already-funded next key within the same two-attempt bound.
Other 4xx stops. Transport, 5xx, 3xx, empty/invalid bodies permit one funded subsequent attempt
inside the deadline. Gateway XML error bodies are never successful data. data.go.kr uses
`dataType=JSON`; body/schema validation precedes any successful acquisition return. Provider
ports supply their kind-specific semantic validator; the generic executor never claims full
provider/route parity from JSON syntax alone. Opaque typed failure counters omit secrets/bodies.
Push send retry policy is unrelated and is not changed here.

## Verification and operation (AC3/AC4)
Exact paths are in config/tasks/S08.json and the pre-edit issue declaration. Existing storage
transport changes are four visibility promotions only; preserve raw/catalog regression checks.
No SQLite, normalized weather persistence, legacy reads, shared cache or route startup changes.

Meaningful Red tests precede implementation. Actual isolated HTTP tests cover two competing
stores, policy drift/overflow, range non-overlap, replacement/late commit, every durability
boundary, exhausted/outage/unknown funding, cancelled waits, old-window/backwards clock,
unit costs and the complete classification/retry/rotation matrix. A distinct release example
uses local S3/provider peers and asserts observed call counts/spend across replacement.
Synthetic protocol fixtures are labeled synthetic, not live recordings. No test uses live
AWS/providers/Mongo/push. Operator manual source/PDF and actual scenario capture document
configuration, spent-block waste, rollback (disable acquisition, never refund/delete) and limits.
Rust fmt/clippy/tests/release, placement/artifact checks, CI and actual independent review are
required. AWS SigV4/IAM/quota ownership/latency and live route/mobile parity remain unverified.

Protocol basis: [AWS conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html).
The high-water/witness algorithm is our inference/design; AWS offers no multi-object transaction.
