# Spec: server2 log pipeline LP-1 (#2978)

Source: [intent](../intent/issue-2978.md) and the [#2978 body](https://github.com/WizardFactory/TodayWeather/issues/2978).

- **AC1 Destinations.** Each of `local`, `s3`, `cloudwatch` and a combination delivers the server's records to exactly the selected destinations, with stream names and keys in the naming contract (`<source>/<instance-id>/<boot-id>`; `<prefix>/<source>/dt=…/hour=…/<instance-id>/<boot-id>-<time>-<uuid>.ndjson.gz`). `local` alone ships nothing.
- **AC2 Levels.** Each remote destination receives exactly the server's schema-1 records at or above its level (S3 default `info`, CloudWatch default `warn`) as unchanged lines, plus collector records. Non-NDJSON lines (readiness line, abort text) stay in the journal.
- **AC3 Validation.** An unknown destination or level, or a missing required name, fails the collector unit with a message naming the variable and not the value; the server unit stays active and answers `/health` 200. The server unit does not require the collector.
- **AC4 Isolation and privacy.** The collector reads only the allowlisted names from server2's `.env`; its environment and rendered configuration hold no other `.env` value; destinations hold none of the #2802 synthetic sensitive values.
- **AC5 Start record.** Each collector start ships one record in the collector record format (`collector_schema` 1) with collector version and active destinations.
- **AC6 Choice record.** The guide records collector version, archive hashes, licence and the feasibility answers (journal reading, variables, permissions, flush time, memory).
- **AC7 Documentation and placement.** Guide, `.env.example` and the logging diagram are updated; links resolve; the placement gate passes.

Failure paths: collector absent/failed/skipped never changes server start or `/health`; invalid settings do not restart in a loop; the collector never creates log groups or reads/lists the bucket.
