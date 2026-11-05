# Acceptance for one bound on a KMA request

- **BOUND:** under the observed source, a provider call or warning cycle that does not end holds the response no longer than 2.5 s after the source starts, and `S3Source::new` keeps its waits. Checked by `tests/domestic/full_response.rs`.
- **WARNINGS:** the collector offers its zone state after fetching and before publishing, and also when nothing needs a sync once the first two steps have run. A request stops waiting for the cycle at the offer and answers from memory, including right after the cycle clears memory. A state offered during an S3 read replaces that read's result. Checked by `tests/warnings/collector.rs`, `recovery.rs` and `tests/domestic/full_response.rs`.
- **IMAGES:** under the observed source a request does not wait for a missing image acquisition, and a later request reads what it stored. `AirInputs::new` keeps its wait. Checked by `tests/domestic/air_forecast_s3.rs`.
- **SHORTEST:** with no ultra-short forecast, `short` and `dailyData` still reach their client format. Checked by `tests/domestic/full_response.rs`.
- **MEASURED:** the evidence document records the scenarios of the first measurement with this binary.
- **PLACEMENT:** the placement gate passes against the single declaration, and the artifact policy passes on outgoing commits.

Failure paths: a cycle that fails before offering leaves the S3 read within the section, and a failed publication keeps the offered state until the next cycle retries it.
