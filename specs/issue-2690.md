# S05 raw record format

AC1: One deterministic gzip per exact response; identity includes source, kind, canonical typed provider key, period/local placement date, fetch milliseconds and full SHA-256. Binary EUC-KR/HTML/RSS remain bytes. Collision bodies retain distinct IDs.

AC2: Conditional PUT with compressed Content-MD5; 412 and ambiguous outcomes reconcile full identity/envelope/length and bounded decoded bytes. Never overwrite. HEAD alone is insufficient. Reject corrupt/truncated/extra-member gzip, wrong identity/hash/metadata and size violations. Absolute monotonic operation deadlines, bounded CPU and I/O, at most two same-key conditional PUTs; cancellation may leave an immutable orphan, never creates a new identity.

AC3: All implementation under server2 and exact documentation exceptions declared on issue before edits; no legacy dependencies. Actual loopback HTTP smoke independently exercises PUT/HEAD/GET and retry/recovery. S3 body acknowledgement is not complete request publication.

Immutable envelope supports optional FetchGroupRef (full group/member/partition digests, bounded member count) before PUT. Deterministic descriptor key is index/v2/groups/{group_sha256}.json. S06 supplies and validates group membership before complete publication; standalone None is not proof of a complete paginated or cross-partition acquisition. All metadata including base64 expansion fits S3 2KiB usermetadata byte limit. No mutation of group metadata after PUT.

Review1 corrections: bounded CPU waiting before GET, distinct Ambiguous after sent PUT, decoded envelope/raw identity across gzip builds; conditional409 and explicit caller credential replacement. FetchGroupRef validates shape only; S06 descriptor/page/group completeness remains required.
