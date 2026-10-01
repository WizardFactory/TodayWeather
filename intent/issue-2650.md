# Intent: working LifeIndex data (#2650)

Source: https://github.com/WizardFactory/TodayWeather/issues/2650 and AK's follow-ups on 2026-10-01 to include pollen, test an existing data.go.kr key, review implementation and proceed through pre-merge.

Authority: AK authorized scoped implementation, tests, commits, branch push, PR, CI and independent review/correction through configured accounts. Merge, auto-merge, merge queue, production deployment, credentials, account configuration and permission changes are excluded.

Problem: the planned LifeIndex surface lacks live values for most indices. The legacy health and food poisoning host is unavailable; activity suitability has no provider or accepted derivation rule.

Outcome: UV and seasonal pollen risk have working collectors and optional weather fields; discontinued indices have no active calls; the web client shows only available data. Related food poisoning sourcing remains in #2600.

- AC1: every current life/health index has a documented source or dropped decision, operation, update cycle and area granularity.
- AC2: dropped/migrated indices no longer call the retired host from any collector or schedule.
- AC3: current-shape fixtures produce optional UV/pollen values in weather response; missing/invalid values are omitted.
- AC4: weather-core maps the optional values, existing response fixtures still parse and web detail displays available grades.
- AC5: activity suitability decision/rules and collector/API architecture are documented.
- AC6: actual key and additional functional verification, CI, independent PR review and final pre-merge readiness are recorded.

Repository: WizardFactory/TodayWeather. Branch: `tame-pug`; target: `master`. Endpoint: pre-merge. Main agent owns shared SDLC records; independent reviewer may access only scoped code/test/evidence, with no secrets or merge authority.

Risks: seasonal oak/pine are not currently publishing; a positive live probe is unavailable. Collection depends on the existing account's endpoint approval and the gathered area list. No unverified index should be represented as live data.
