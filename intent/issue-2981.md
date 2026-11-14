# Intent: server2 log pipeline LP-4 (#2981)

Source: AK, 2026-11-14 — decisions per recommendation and "구현 진행" for [#2977](https://github.com/WizardFactory/TodayWeather/issues/2977), then "머지하고 작업계속". LP-4 is [#2981](https://github.com/WizardFactory/TodayWeather/issues/2981).

- **Outcome:** a Spot interruption notice is seen within 6 s, recorded at every destination before the server's shutdown records, and the server then the collector stop inside a documented budget of 86 s, under the 120 s notice; a normal shutdown keeps the same order; without a notice the loss is bounded by the delivery windows.
- **Endpoint:** PR to `master`, merged under the standing "머지하고 작업계속" once review and CI pass. No deployment and no AWS change.
- **Design choices (recommendations applied):** a small watcher unit polling IMDSv2 `spot/instance-action`; on a notice it writes `collector.interruption_notice`, marks the interruption for the collector's stop, and stops `server2.service` then `server2-logs.service` (the instance itself is stopped or terminated by EC2). On an interruption the stop drain waits at most 10 s and the collector's own SIGTERM flush ships the rest (records may repeat if the disk survives; never lost while destinations work). The S3 object window becomes 50 s so that a record reaches S3 within the required 60 s including the upload.
- **Excluded:** removing the instance from routing and readiness (#2705); the qualification host (LP-6).
