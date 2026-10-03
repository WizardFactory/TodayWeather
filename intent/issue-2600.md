# Restore domestic food-poisoning forecasts (#2600)

Users need the existing food-poisoning rows for today, tomorrow and the day after. Collect MFDS poisonmap forecasts and restore `fsn` (percent), `fsnGrade` (0–3) and localized `fsnStr` for domestic daily/current responses. Scope: collector, separate dated regional store, scheduled gather, response enrichment, tests and architecture/operations documentation. Existing app rows require no UI change. UV/pollen, other weather fields and both domestic storage versions remain compatible.

Authority: AK requested pre-merge implementation in this session. Use the configured GitHub account and configured independent review launcher for task code/test/evidence. Commit, push, create/update the scoped PR, inspect CI and correct reviewed changes; do not merge, enable auto-merge, enqueue or deploy. No unrelated or private account information belongs in artifacts.

- AC1: Seoul Jongno daily forecasts carry provider percentages, page grades and labels for three matching KST dates; current copies today's value.
- AC2: Gwangju's renamed province resolves by district; absent districts fall back to the correct province.
- AC3: recorded provider fixture parses with inclusive transitions at 0.315/0.559/0.743; invalid data is rejected/omitted.
- AC4: missing/failed optional collection or storage preserves successful weather and other fields; expired dates never leak.
- AC5: no legacy getFsnLifeList request runs; UV/pollen remain active.

Live source availability is separate from implementation correctness. The 2026-10-03 read returned baseDate 20260929, so live today/tomorrow acceptance cannot be demonstrated until a current publication exists. Offline date-bound scenarios must prove the contract without fabricating current forecasts. No production activation or mobile build is included.
