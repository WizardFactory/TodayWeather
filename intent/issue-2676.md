# Forecast publication grid deduplication (#2676)
Owner: AK. Builder: /root (OpenAI). Source: [issue 2676](https://github.com/WizardFactory/TodayWeather/issues/2676).
AK requested implementation through pre-merge on 2026-10-03. This authorizes scoped code/tests/docs, commits, push, PR, CI, issue updates and independent review/correction using configured accounts. Merge, auto-merge, queue entry and production actions remain excluded.

Legacy short and ultra-short polls repeat completed grids. Read exact publication coverage before HTTP, fetch pending grids only and verify persisted results afterwards. Preserve timing, coordinates, formats, output and bounded retry/quota behavior.

- AC1: Complete repeat/recreated coordinator sends no HTTP; new publication walks every grid; only missing slots/fields/failed grids repair for DB1/DB2.
- AC2: Same publication overlaps share a run; read/write/HTTP failure, deadlines and late callbacks cannot falsely complete coverage or hold a guard forever. Existing current and response regressions pass.
- AC3: Synthetic loopback HTTP plus temporary Mongo exercises real Manager/collector/writers on Node16.20.2 and Mongoose5.1.2 with measured pages/retries and repair, documented and in CI.
- AC4: Production successive-publication and public-response readback remains pending separate deployment authorization; implementation readiness does not claim recovery.

Main risks: publication provenance in legacy merged arrays, truncated horizon, conditional categories, issued Mongo operations after expiry. Quota entitlement is unknown; deduplication does not establish sufficient capacity. No server2, schema/key/grid/scheduler/backfill changes.

2026-10-04 AK decision: KMA updates ultra-short publications every ten minutes; keep one full refresh walk per current ultra-short publication (default base+40min, configurable/disable) instead of freezing values at the first complete walk.
