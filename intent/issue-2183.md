# Intent: administrative-area life-index fallback (#2183)

Owner: AK. Endpoint: pre-merge. Source: [issue #2183](https://github.com/WizardFactory/TodayWeather/issues/2183) and AK's explicit request to proceed through pre-merge, followed by instructions to continue.

Administrative-area changes leave address and nearby area metadata pointing at codes without life-index rows. The exact-code lookup then tries only the first nearby code, so available later candidates are missed. Domestic weather users should receive available optional indices without losing the weather response when indices are absent.

- AC1: Keep address-first precedence; on no-data walk the existing nearest candidates in order, excluding the failed exact code, and use the first available result.
- AC2: Preserve optional-weather/MFDS continuation, valid zero values, longitude/latitude order and bounded reads. DB errors remain observable and stop further life-index reads.
- AC3: Preserve UV and pollen contracts, including current/daily pollen summary, on supported Node 16/22 runtime paths.
- AC4: Deliver a tested, reviewed PR with current CI and explicit no-merge/no-production authority.

Keep the existing 0.3-degree distance and three-row metadata query. Do not hard-code historical aliases, migrate nationwide metadata, fetch providers on weather reads, change schemas or perform production actions. Stale metadata may still exhaust the bounded candidates; this fix does not establish freshness or expiry.

Authorized actions include implementation, isolated testing/smoke, commit/push, PR and material issue updates, scoped task evidence transfer and independent review/correction through the already configured GitHub and Paseo/Codex paths. No credential transfer, new accounts, permission-setting changes, merge, auto-merge, merge queue or production deployment is authorized.

This artifact records the established intent after the shared SDLC skill became available during pre-merge. It does not retroactively claim a different execution order. Earlier findings and tests are retained in [verification](../docs/evidence/tasks/issue-2183/pre-merge.md). See [spec](../specs/issue-2183.md) and [plan](../plans/issue-2183.md).
