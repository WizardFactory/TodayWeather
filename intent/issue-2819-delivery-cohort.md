# Complete admitted push cohorts safely

Address C2 and C3 of [#2819](https://github.com/WizardFactory/TodayWeather/issues/2819). An alarm/conditional-alert recipient already selected and durably claimed must not be dropped merely because earlier recipients used up the UTC minute. Preserve token/version checks, configured alert windows, shutdown admission, and one-shot durable claims.

For a conditional alert that definitively never submitted its external POST, do not retain this attempt's sent timestamp or suppress its still-unsent weather/air transition for six hours. A later ordinary scheduled evaluation may be eligible; do not replay the old claim, retry an actual rejected/unknown send, rewind a journal, restore an entire registration over user edits, or infer no-POST from task cancellation.

Before runtime changes, select an explicit finite-cohort lateness policy and conditional state ownership design; test missing fields and concurrent edits. Keep provider funding, warning fan-out/timer, cold capacity, S20 host/shadow/quota and deployment outside this increment. No live provider or notification requests.
