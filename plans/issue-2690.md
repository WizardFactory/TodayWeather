# S05 implementation plan

1. Validate immutable format and dependency APIs from primary documentation.
2. Expected tests before codec implementation: exact bytes/full identity/limits.
3. Implement codec plus async transport contract and SigV4 HTTP S3 client.
4. Scripted loopback transport tests exercise 412/ambiguous outcomes/concurrent writers/corruption/deadlines.
5. Separate executable local HTTP smoke publishes binary and collision records, repeats PUT and restores them from empty client memory. No live AWS.
6. fmt/clippy/tests/release/placement/artifact checks; operator source/PDF/actual screenshot; commit/push/PR and independent review via root.

Scenarios: S1 normal exact archive/restore (AC1); S2 collision and revisable identity (AC1); S3 existing/ambiguous PUT (AC2); S4 corrupt and oversized input (AC2); S5 placement and real wire smoke (AC3).

Actual review1 correction scenarios: an existing/committed body meets CPU contention and waits before GET; deadline after PUT yields Ambiguous with stored object, before PUT yields Timeout/no object; sixteen admitted IO calls share two CPU workers; real409 restores or retries same key; alternate valid gzip preserves exact raw envelope; caller rotates supplied credentials without replacing store. Automated unit/wire regressions and independent release HTTP smoke cover these. No descriptor/catalog implementation.

Review2 scenarios: four actual committed-PUT/HEAD-or-GET403-or-503 probes retain one object and yield Ambiguous, direct PUT403 writes none; 16 delayed50ms network loads run beyond cpu2 while download payload slots cap retention; coherent credentials rotate during128 real wire loads without busy-lock rejection; held lock yields/waits and honors caller deadlines. Preserve every review1/2 finding ID and real Reds, repeat distinct releaseHTTP smoke/manual checks, then root reviewer3.
