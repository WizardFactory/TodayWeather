# Plan
Owner: Codex /root; execution ledger: ../.planning/issue-2633/task_plan.md.
Inputs: ../intent/issue-2633.md and ../specs/issue-2633.md.

1. Add offline regression to vc-weather.test.js using a São Paulo-zone Brasília synthetic timeline and usage=976/1000; observe intended budget failure.
2. Tag only local budget errors; add a range-selection helper preserving fresh fallback and provider-down rejection. Route _requestDatas through selection; reuse locks, converter and storage. No new markers.
3. Cover both Brasília coordinates, another zone, fresh repeated requests, budget reset, missing usage counter, exhausted cap and provider-down. Run full offline suite and Node 16 targeted checks.
4. Extend smoke harness configuration injection; run a real local HTTP gateway -> DSF router pipeline with synthetic provider/database dependencies. Verify source/temperature and forecast-only cost for both coordinates.
5. Update weather-collection contract and existing world-cache Archify JSON/HTML. Validate artifact/browser/visual separately.
6. Independently verify using authenticated other-provider Claude Code, latest GA model verified at execution, medium effort and auto mode, isolated from author writes. Commit/push PR after tests and smoke; inspect CI and review exact candidate. Stop before merge.

Risk: forecasts may omit history; missing-history behavior already exists and must remain honest. Budget is approximate under concurrency. Most risky: accidentally downgrading a provider outage or repeatedly billing fresh cache; explicit tests cover both. Alternative raising cap rejected. Rollback: revert scoped source change; no migration or operational mutation.
