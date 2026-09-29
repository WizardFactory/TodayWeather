# Triage
Source: https://github.com/WizardFactory/TodayWeather/issues/2581 and its two comments, read 2026-09-29.
Implementation, behavior change, endpoint pre-merge. Initial clean branch special-beaver at d4858b59. User explicitly requested issue review through pre-merge; covers scoped implementation, evidence, tests, commit/push/PR, CI and independent review, excludes merge/deploy.
AC1: timestamped collection cause documented on issue and fixed or tracked separately.
AC2: 7h accepted/9h rejected under UTC, Seoul, Los Angeles, including 24:00.
AC3: detail observations filtered or explicitly marked stale with offline route coverage.
AC4: asynchronous failing getArpLtnInfo reaches next without throwing.
AC5: full offline suite passes Node 16.20.2 and 22.22.2.
Existing getKeco guard is already present; preserve it and verify. Nationwide air investigation shares collector evidence; any new provider-chain nationwide feature is separate scope.
