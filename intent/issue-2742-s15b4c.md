# Intent: disposable verified weather raw disk cache

Task issue-2742-s15b4c; parent #2742/#2614; owner OpenAI main; 2026-10-16; base 88448ddf.
AK approved implementation through pre-merge, including scoped tests, captures, commits, push, PR/CI and independent configured reviewers. No merge/auto-merge/queue, deployment, AWS/provider/DB changes, private .env access, secrets transfer or new credentials. Existing authorized public-code/sanitized-evidence review accounts only.

Repeated S3 weather reads and GIF downloads after restart waste I/O. Cache already verified immutable raw bytes on disposable local disk. S3 publication/completeness stays authoritative; disk loss changes latency only.

- CACHE: same ready inputs produce identical native bytes/ETag with fewer immutable raw GETs after restart.
- RECOVERY: missing, corrupt, truncated and evicted cache files recover verified canonical S3; no stale or invented success.
- BOUNDS: one process owns a namespace, disk bytes/entries/temp writes and blocking work are bounded; unusable disk behaves as a miss. Existing <=3 s request wait/partial responses/owned acquisition remain unchanged.
- PRIVACY: only explicit public weather sources/kinds are eligible; no precise geocode, push/state/budget/credential or request-history disk storage. Tests inject configuration and never read actual .env.
- CAPACITY: measured cache footprint plus labelled OS/binary/log/temp/headroom assumptions produce a concrete gp3 capacity in setup Markdown/PDF and prerequisites. Local timings do not establish AWS/EBS latency.

No decoded GIF sidecars or raw packs without separate measured need and declaration amendment. No pre-collection or legacy fallback. Names equivalent to legacy remain unchanged; only real server2-only cache path/cap settings are added.
