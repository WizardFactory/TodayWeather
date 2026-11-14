# Spec: server2 log pipeline LP-2 (#2979)

- **AC1 Isolation.** With the collector stopped, and with both destinations failing, the server's responses (status and body) to a fixed request set equal the baseline, and the server stops within its bound and within the baseline + 5 s.
- **AC2 Independent destinations.** While one destination fails, the other receives new records within its window.
- **AC3 Redelivery.** After recovery, including after a collector restart during the outage, every server record in the journal arrives exactly once, in journal order (CloudWatch stream; per S3 object).
- **AC4 Overrun and counters.** Records rotated out before delivery produce a `collector.journal_overrun` record with the lost range at the destinations and a nonzero count in the status record; the counters endpoint listens on 127.0.0.1 only and is not reachable on the host address.
- **AC5 Status record.** A `collector.status` record with per-destination counts, unconfirmed age and overruns reaches every destination every 60 s; it is `warn` while a destination is behind its window.
- **AC6 Documentation.** The guide explains reading process and collector counters together, sizing of the journal, and the restart limit; diagram and manual updated; placement passes.
