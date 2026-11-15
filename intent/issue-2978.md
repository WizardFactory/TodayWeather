# Intent: server2 log pipeline LP-1 (#2978)

Source: AK, 2026-11-14 — "결정해야 할 사항은 권고대로 하고, 구현 진행" for [#2977](https://github.com/WizardFactory/TodayWeather/issues/2977), after the review and breakdown into LP-1 to LP-6. LP-1 is [#2978](https://github.com/WizardFactory/TodayWeather/issues/2978), the first slice; the others depend on it.

- **Outcome:** a host collector outside the server process ships the server's NDJSON log to the destinations selected by environment variables (local, S3, CloudWatch Logs), with validation that never affects the server, a naming contract that keeps instances and boots apart, and a capped local journal.
- **Decisions applied (owner, 2026-11-14, recorded in #2977):** scale-out must work and no disk may be relied on; S3 objects closed at least every 60 s, CloudWatch within 10 s; retention CloudWatch 30 days / S3 90 days (LP-5); non-NDJSON lines stay local; phase changes are owner configuration, no automatic switching.
- **Endpoint:** pre-merge. Commits, push, PR, CI and review within this task; no merge, no deployment, no AWS resource creation, no live provider calls.
- **Excluded:** LP-2 to LP-6 behaviour (redelivery counters, IMDS identity and boot configuration, Spot watcher, IAM templates, qualification host).
