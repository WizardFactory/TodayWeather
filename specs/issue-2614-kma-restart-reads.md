# Acceptance for the restart reads

- **LANE:** with the lane full of blocked bulk requests, bulk work never holds more than `limit / 3` permits (at least one), and a request read is admitted at once. A bulk view of a bulk view is the same lane. Checked by `tests/storage/bulk_lane.rs`.
- **WARNINGS:** the warning store and feed built by the process wiring (`gateway::runtime::warning_store`, `warning_feed`) use the bulk lane. Checked by `tests/storage/bulk_lane.rs`; the warning, delivery and runtime-services suites pass unchanged.
- **RESTART:** EC2, master against the candidate, restarts after at least 30 minutes of operation on one bucket: first request time and the presence of the minute observations and past days. Recorded in the task evidence.
- **PLACEMENT:** the placement gate passes against the single declaration, and the artifact policy passes on outgoing commits.

Failure paths: a closed admission still fails with `Capacity`; a bulk request waits for the lane before taking a shared permit, so a waiting bulk request never holds a shared permit.
