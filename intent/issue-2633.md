# Intent: Brasília coordinate weather (#2633)
Source: https://github.com/WizardFactory/TodayWeather/issues/2633 and AK's 2026-09-29 request to investigate, fix and proceed through pre-merge.

Users of the PWA/apps cannot obtain weather at -15.794,-47.882 and -15.78,-47.93. Restore normal VC current/forecast responses and cover the affected location class without fabricating historical observations or bypassing provider budgets.

AC1: both public coordinate paths return HTTP 200 JSON, source VC and finite numeric current temperature on the repaired candidate. Record production reproduction separately; deployment and post-deployment verification are human-owned.
AC2: an offline regression reproduces the identified cause before the fix and npm --prefix server run test:offline passes afterward.

Authorized endpoint: pre-merge, including scoped implementation, tests/smoke, commit, branch push, PR creation/updates, CI, independent verification/review and corrections using already configured GitHub and Anthropic Claude Code. Only task code, tests and sanitized evidence may be transferred. Excludes secrets, new accounts, permission changes, merge/auto-merge/queue enrollment and production deployment/configuration changes.

Risks: approximate daily budget under concurrency; incomplete historical charts under graceful degradation; provider availability. Out of scope: quota increases, new provider, unrelated domestic errors and strict distributed budget reservation.
