# Intent: server2 log pipeline LP-6 (#2983)

Source: AK, 2026-11-15 — "/sdlc 권고대로 머지하고 계속 작업 진행": merge #2947 and #2971 as recommended, then continue with LP-6 ([#2983](https://github.com/WizardFactory/TodayWeather/issues/2983)) of [#2977](https://github.com/WizardFactory/TodayWeather/issues/2977), applying the recommended option at each decision.

- **Outcome:** the qualification host ships its candidate, guard and reader output through the LP-1..LP-4 pipeline, so a stop such as `provider_auth_or_quota` can be read after the host and its disk are gone; supervision is unchanged.
- **Endpoint:** PR to `master`, merged under the same instruction once review and CI pass. No qualification run, no host, no AWS change, no spending.
- **Design choices (recommendations applied):**
  - Destination: S3 only, in the run's own `-state` bucket under `logs/server2` (unused by the candidate). The instance role can already write there, and the cleanup's export retains every object before the buckets are deleted, so no IAM, resource or cleanup change is needed. CloudWatch would need a new role grant, a log group in the frozen resource set and its deletion; it is not selected for the bounded run.
  - Sources: candidate `server`, guard `guard`, reader `reader`, collector `collector`. The collector takes its unit-to-source map as an argument of its units; the default stays the LP-1 map.
  - Guard and reader: only lines that are JSON objects leave the host (the guard's canonical decision with its fixed vocabulary, the reader's summary). Tracebacks and `refused:` lines, which can carry local paths or loopback URLs, stay in the local journal.
  - Bundle: the collector archive, its pin, `render.py`, `status.py` and the logging variables become host artifacts, checked like the others; the collector units and journal settings are generated with the other host units.
  - The collector is not part of the guard's coupling; the retention step stops it with its drain before the evidence export and the cleanup.
