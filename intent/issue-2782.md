# Issue #2782: numeric coordinates for newly resolved towns

Source: https://github.com/WizardFactory/TodayWeather/issues/2782. AK explicitly requested review and execution through pre-merge on 2026-10-16. This authorizes scoped implementation, isolated tests/smoke, commits/push, PR/issue updates, CI and independent review/correction using existing GitHub account hwanjjang and configured review launchers. No merge, auto-merge, queue, deployment, new account or permission changes.

Newly geocoded domestic towns must have numeric coordinates before first response and cache reuse. Mongoose casts only the saved document today.

- AC1: first lookup, same-process reuse and persisted lean reload produce HTTP 200 with identical numeric location and legacy three-decimal rounding on v000901+.
- AC2: isolated regression fails before the fix; existing numeric towns, empty town lists, invalid/out-of-area results, geocoder failure and save failure retain their established lookup behavior without live calls.

Scope: legacy _findTown admission, offline regression and functional smoke, affected API documentation/diagram and CI wiring. Formatter, provider selection, existing cache records and server2 remain outside scope. Deployment incidence is unknown.
