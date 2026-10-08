# S07: bounded memory lookup and resolver

Source: [#2692](https://github.com/WizardFactory/TodayWeather/issues/2692), parent [#2614](https://github.com/WizardFactory/TodayWeather/issues/2614), merged S06 baseline `94019cf5`. AK authorized this implementation and scoped PR corrections on 2026-10-08.

## Problem and outcome

S06 reconstructs checked raw acquisitions but does not supply response caching, whole-operation singleflight or ownership under caller cancellation. Implement reusable internal primitives so a checked cold S3 read and a warm memory hit produce identical fixture bytes while admission and lifetime accounting bound work. No weather or gateway route is switched.

## Users and constraints

Future assemblers consume exact response identities: route, API version, location, locale, units, output parameters and parser revision. Operators can inspect cache, admission, shared-flight and drain metrics. All implementation assets belong under `server2/`; no SQLite, disk serving store, MongoDB, shared-instance cache or persisted normalized weather is introduced.

S07 delivers geocode key identity/privacy only; a geocode value cache and actual boundary-sensitive label parity remain explicitly deferred to S10. Exact geocode coordinate and address queries are volatile only, with an explicit validity policy capped at 30 days. They do not authorize archival projections. Persistent coarse projections and actual geocoder label/privacy proof remain S10 responsibilities.

Owned work survives the initiating waiter's cancellation, while every waiter keeps its own deadline. New data must complete raw, descriptor and catalog publication before response assembly. Incomplete, corrupt, capacity-exhausted and timed-out recovery never permits a provider call. The S08 funding seam is abstract; recorded callbacks do not prove real funding integration.

## Acceptance

- AC1: exact query, locale and boundary identities; volatile geocode privacy; deterministic revision ranges, KST midnight and DST-aware UTC lookup helpers.
- AC2: checked S3 cold and memory warm fixture bytes match; warm response hits perform zero S3/provider work, verified through actual HTTP counters.
- AC3: bounded byte leases including retired pins, owner/waiter admission, per-layer CPU/I/O pools, owned same-key work, dependency refresh and bounded Spot drain.
- AC4: declared placement and dependency checks, full CI, a distinct release HTTP smoke, editable manual/PDF/usage capture and an actual independent eligible review.

## Scope and authority

One stable task `issue-2692-s07`, branch `feat/2614-s07-resolver`, base `94019cf5`, one pre-merge PR and at most ten attempts per stage. Existing configured accounts may implement, test, commit, PUSH, update the PR and task comments, and correct findings. Root exclusively owns actual Claude reviewer dispatch and the four shared architecture/plan paths.

No new accounts, settings, permission changes, secrets, live AWS/provider/Mongo/notification actions, deployment, cutover, merge or auto-queue. `merge_authorized: false`.

## Risks and exclusions

Byte accounting is logical, not a hard RSS bound; assembler allocation and existing S05/S06 scratch remain separately bounded contracts. The response cache serves memory hits. The raw tier currently retains validated identities after S06 reads; it does not bypass S3 GETs. The parsed tier reuses checked acquisition parsing.

History coverage applies to the caller's finite period scope. Selected acquisitions keep all ordered pages; they cannot be folded as complete history. Page-size-one traversal re-normalizes S06 metadata and may exhaust bounds on mature catalogs. No cold latency improvement, AWS performance, actual geocoder labels or used-route parity is claimed. S08/S09/S10 keep their later integration gates. No additional AK decision is needed for this internal scope.

## Selected independent review corrections

Actual Claude review1 on7f8c1cf2 requires: checked concurrent work must survive unrelated global invalidation; optional raw/parsed retention must not strand valid bounded responses; healthy complete-catalog cold reads must avoid mandatory full-history repair. S07-R1/R2/R3 are selected, plus S07-R4 scope wording. Read-first serving authority is the confirmed complete publication catalog, not unindexed orphan bodies. A separate bounded owned maintenance lane verifies/indexes orphans without calling providers; incomplete recovery is never a synced-prefix/empty proof.

The existing exact declaration is supplemented by [6047803555](https://github.com/WizardFactory/TodayWeather/issues/2692#issuecomment-6047803555), adding only server2/src/storage/catalog.rs for index-only repair while preserving existing full repair behavior. All other authority/route gates remain unchanged.

## External refresh corrections

AK authorized review5450386782 corrections and push within this original pre-merge task. Required S07-H1 shares the unchanged response payload/byte lease while only rearming fixed refresh metadata; external pins remain charged. Required S07-H2 rechecks the immutable original TTL after dependency I/O and before returning a refreshed value; expiry uses checked cold work within the same deadline or a typed failure. No extra provider permission, TTL extension, dependency, route or scope expansion. Historical QA2/completion receipts apply only to their frozen revision. [Exact corrective paths](https://github.com/WizardFactory/TodayWeather/issues/2692#issuecomment-6050431475) precede edits.
