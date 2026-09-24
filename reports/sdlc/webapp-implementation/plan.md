# Build plan
1. Add isolated npm workspaces and shared typed domain. Write behavior tests first for raw KMA/world normalization, time/units/sentinels, stable settings/storage and constrained BFF.
2. Implement API with explicit live/sample modes, search/reverse/weather/nation/warnings, bounded fetch, safe errors and capability routes. No legacy startup imports.
3. Implement responsive PWA with complete read/settings workflows, data charts/tables, permission/error/partial/stale states, public share routes and browser persistence.
4. Implement service-worker shell cache/update and notification owned APIs/scheduling integration; capability failures explicit.
5. Add deployable build/CI/IaC preparation, local run docs and current architecture evidence. Existing draft architecture stays proposal history; implementation diagram reflects actual boundary.
6. Run typechecks/tests/build, integrated local HTTP/browser smoke, screenshots and independent verification; fix substantive findings and retain issue status accurately.
Files: package.json/lockfile; packages/weather-core; web; web-api; scripts/web-*; infra/web; scoped .github workflows; docs/webapp implementation docs and reports. Legacy mobile/server code remains unchanged.
Risk: wrong meteorological units/time/source, data presented as current after failures, push identity and stale worker. Reject importing legacy Angular/server runtime. Prove with unit/integration assertions plus real composed browser journeys. Rollback is independent web artifacts; no deployment executed.
