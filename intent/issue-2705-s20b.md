# S20b: process-owned delivery supervision

Owner: own S20b builder, coordinated by root. Stable task: `issue-2705-s20b`; scope evidence: [#2792](https://github.com/WizardFactory/TodayWeather/issues/2792). Initial base: `171472c5bfffb0010f1868ffcae1100dfb262de6`.

AK's 2026-10-16 assignment authorizes implementation, isolated tests/smoke, scoped commits/push, task PR and issue updates, and root-coordinated eligible review using configured accounts. Endpoint: **pre-merge**. No merge, auto-merge, queue, deployment, live actions, private environment reads, credentials transfer, new accounts or permission changes. No extra development agents. Root owns parent plans/integration and the fourth QA slot.

Connect existing ordinary push selection to alarm, conditional and warning scheduling over actual S20a RuntimeServices. Preserve notice API without Translator, lazy per-product FCM credential failures, durable claim-before-POST, no automatic replay of failed/ambiguous sends, native request contracts and no startup weather acquisition.

- AC1: Delivery begins after both listeners bind; next observed UTC minute only, silent first warning baseline, shared typed native/S3 dependencies and no constructor provider/OAuth/FCM calls.
- AC2: Signals and listener failure quiesce schedules and POST admission, own/join/cancel jobs and writer under one wall-clock bound, with unfinished work honestly classified.
- AC3: Durable claims and final selection/time/zones prevent duplicates/replay across overlapping workers and restart, including changes during OAuth and ambiguous POST/result writes.
- AC4: Intended Red/Green/refactor, actual process HTTP/signal/failure smoke, relevant regressions, manual PDF/diagram checks, exact-head CI and independent review establish readiness without integration or live sending.

Risks: long native owned acquisitions outlive their 3-second waiter; shutdown must cancel them at runtime teardown and explicitly avoid a completed claim. Registration and delivery result writes may have ambiguous outcomes; authoritative S3 and immutable claims remain recovery truth. Retired TodayAir is no new required account. Full S20/#2742, cutover, EC2/quota/live shadow are excluded.
