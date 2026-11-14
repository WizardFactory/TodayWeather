# Intent: server2 log pipeline LP-5 (#2982)

Source: AK, 2026-11-14 — decisions per recommendation and "구현 진행" for [#2977](https://github.com/WizardFactory/TodayWeather/issues/2977); retention CloudWatch Logs 30 days, S3 log objects 90 days. LP-5 is [#2982](https://github.com/WizardFactory/TodayWeather/issues/2982).

- **Outcome:** reviewed templates for the least-privilege role policy, the S3 lifecycle limited to the log prefix, and the log group with retention, plus operator steps to apply and read them back.
- **Endpoint:** pre-merge, stacked on LP-1 (#2978, PR #2984). **No AWS change**: nothing is applied, created or attached by this task.
- **Excluded:** applying the templates (owner step), LP-2/3/4/6 behaviour.
