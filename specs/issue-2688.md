# S03 local peer and infrastructure contract

Source: [intent](../intent/issue-2688.md). AC1 local isolation; AC2 resource plan;
AC3 placement and accepted-policy consistency. Base f568508da68d408a282752f55614407899631c88.

The local test S3 server owns volatile object/version maps under a lock. It accepts
path-style PUT/HEAD/GET and bounded ListObjectsV2, preserves gzip bytes and user
metadata, requires Content-MD5, and implements If-None-Match:* / If-Match before
mutations. Store, body, metadata, connections and socket timeouts are bounded.
A test-only next-PUT fault can commit then return 500 or close the connection;
HEAD/GET must still retrieve the committed bytes. Unknown credentials, methods,
buckets, keys or provider paths are rejected locally. There is no network proxy.

Known test credentials identify presigned requests but the emulator does not
validate SigV4 cryptography, IAM, TLS, AWS clock/skew, distributed consistency,
throughput or durability. Versions disappear when the process ends. This is an
explicit test subset, not a production adapter, serving cache or persistent store.

The provider listener serves copied repository fixtures byte-for-byte after
checking their pinned SHA-256. Copy is one-time with provenance; runtime reads
only server2-owned data. No provider key appears in Git except obvious local dummy
credentials. The launcher gives child Rust only approved local configuration,
starts no legacy process, and publishes complete ready endpoints/PIDs atomically
to an absent file in a private task-owned temporary directory. A reader opening
the file as soon as it appears must receive complete JSON without decode retries.
Write the JSON to a same-directory temporary file first, then use no-replace
publication; existing regular files, symlinks and dangling symlinks must remain
untouched. Failure cleans owned temporary files and child/listeners; normal stop
removes the ready path only while it still identifies the owned inode.
Shutdown signals only owned children and bounds the wait/kill fallback. Foundation
only serves health/metrics; it does not query these peers until later route ports.

Staging templates do not create resources. S3 writes are scoped to serving/raw,
identity catalogs, reservations and required state; no delete permission. Operators
approve actual account/region/bucket/key owners, egress and costs separately. Default
one Spot / one Tokio process; no gp3 serving store or shared-cache implementation.
Host type is a candidate, not a measured target; S09 checks musl on real Linux,
RSS/CPU, cold p95/p99, S3 throughput and provider headroom before promotion.
