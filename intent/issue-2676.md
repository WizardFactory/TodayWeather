# Forecast publication grid deduplication (#2676)
Owner: AK. Builder: /root (OpenAI). Source: [issue 2676](https://github.com/WizardFactory/TodayWeather/issues/2676).
AK requested implementation through pre-merge on 2026-10-03. This authorizes scoped code/tests/docs, commits, push, PR, CI, issue updates and independent review/correction using configured accounts. Merge, auto-merge, queue entry and production actions remain excluded.

Legacy short and ultra-short polls repeat completed grids. Read exact publication coverage before HTTP, fetch pending grids only and verify persisted results afterwards. Preserve timing, coordinates, formats, output and bounded retry/quota behavior.

- AC1: Complete repeat/recreated coordinator sends no HTTP (amended 2026-10-04 by AK: except one scheduled ultra-short refresh walk per current publication per process; `GATHER_SHORTEST_REFRESH_AFTER_MS=0` restores zero); new publication walks every grid; only missing slots/fields/failed grids repair for DB1/DB2.
- AC2: Same publication overlaps share a run; read/write/HTTP failure, deadlines and late callbacks cannot falsely complete coverage or hold a guard forever. Existing current and response regressions pass.
- AC3: Synthetic loopback HTTP plus temporary Mongo exercises real Manager/collector/writers on Node16.20.2 and Mongoose5.1.2 with measured pages/retries and repair, documented and in CI.
- AC4: Production successive-publication and public-response readback remains pending separate deployment authorization; implementation readiness does not claim recovery.

Main risks: publication provenance in legacy merged arrays, truncated horizon, conditional categories, issued Mongo operations after expiry. Quota entitlement is unknown; deduplication does not establish sufficient capacity. No server2, schema/key/grid/scheduler/backfill changes.

2026-10-04 AK decision: KMA updates ultra-short publications every ten minutes; keep one full refresh walk per current ultra-short publication (default base+40min, configurable/disable) instead of freezing values at the first complete walk.

2026-10-04 rollback amendment (task issue-2676-r2, builder Claude Code/Anthropic). Source: AK request to implement [comment 5977503815](https://github.com/WizardFactory/TodayWeather/issues/2676#issuecomment-5977503815) through pre-merge with the same exclusions. Deployment of e22c678f was rolled back:
- R1: ultra-short requests `base_time=HH30` but data.go.kr echoes `baseTime=HH00`; request validation, batch admission and coverage must treat the echoed base hour as the same publication, so a normal response is collected and recognised as complete. A response for another hour remains rejected.
- R2: the short DB2 coverage read must finish within the default read wait at production volume (577,244 slot documents, 134,178 per publication), so a poll is not stopped by `read-failed`. Measure the new read against a production-sized temporary collection.
AC1-AC3 keep their meaning and must hold with the real HH30 to HH00 echo. AC4 remains human-owned.

2026-10-04 late-publication amendment (AK, during issue-2676-r2, with the September 2026 guide 260928): grids of one publication are published at different times and often later than the provision time (short HH:10, ultra-short HH:45); a grid can answer NO_DATA or still the previous publication. Collect about two minutes after the provision time, re-walk grids not updated or with incomplete content (for example wind) at about +5 minutes and finish with a final re-walk at about +10 minutes. Report the daily request impact; approved quota remains unknown (#2648).
