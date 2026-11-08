# Acceptance for the restart reads

- **LANE:** with the lane full of blocked bulk requests, bulk work never holds more than `limit / 3` permits (at least one), and a request read is admitted at once. A bulk view of a bulk view is the same lane. Checked by `tests/storage/bulk_lane.rs`.
- **WARNINGS:** the warning store and feed built by the process wiring (`gateway::runtime::warning_store`, `warning_feed`) use the bulk lane. Checked by `tests/storage/bulk_lane.rs`; the warning, delivery and runtime-services suites pass unchanged.
- **RESTART:** EC2, restarts after at least 30 minutes of operation on one bucket: every first request answers 200 within the bound with every field the client gets today, except slow-provider exclusions such as fine dust (client validation, AK 2026-11-07); compared field by field with the next answer for the same place. **Not met** on 2026-11-07 (master, this change, and this change with #2872; three restarts each): first requests took 3.0 to 3.7 s and lacked current observations (8 of 9), yesterday's values, past days, history mapping and freeze index (9 of 9), UV (5 of 9) and the narrative (4 of 9). `kma_client_eval.py` reported 0 violations for these bodies; it does not check completeness.
- **PLACEMENT:** the placement gate passes against the single declaration, and the artifact policy passes on outgoing commits.

Failure paths: a closed admission still fails with `Capacity`; a bulk request waits for the lane before taking a shared permit, so a waiting bulk request never holds a shared permit.
