# Build
Keco freshness now validates the KST wall-time format/calendar, treats 24:00 as next midnight and compares elapsed milliseconds. No caller Date mutation or DST-local subtraction. Existing strict eight-hour threshold and future policy are preserved.
Both detail paths filter all AirKorea input rows with the same predicate, skip empty/stale stations and retain provider-chain rows under their existing validator. Existing getKeco guard is unchanged; asynchronous regression proves next once.
Added timezone child-process tests, full v000903 DB1/DB2 route tests, separate real loopback HTTP smoke, fixed existing fixture clocks, registered checks in test:offline and RSS CI. Updated mobile API contract and regenerated/validated domestic air sequence.
Candidate identity and exact relevant file hashes: candidate.json. Base is the initial d4858b59 commit. Operations were read-only; tracked follow-up #2636. No database writes, collection trigger or deployment.
