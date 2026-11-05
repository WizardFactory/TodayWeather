# Acceptance for one bound on a KMA request

- **BOUND:** under the observed source, a provider call, warning cycle or narrative read that does not end holds the response no longer than one instant counted from when the request reached the handler: 2.5 s for what it started, 2.7 s for air and life and 2.9 s for the narrative. A KR remap before the snapshot uses up the same wait. Stored reads keep the 8 s budget. `S3Source::new` keeps its waits. Checked by `tests/domestic/full_response.rs`.
- **WARNINGS:** the collector offers its zone state after fetching and before publishing, and also when nothing needs a sync once the first two steps have run. A request stops waiting for the cycle at the offer and answers from memory, including right after the cycle clears memory. A state offered during an S3 read replaces that read's result, even when the read fails. The collector reloads its zone state once a KST day and keeps its bootstrap progress. Checked by `tests/warnings/collector.rs`, `recovery.rs` and `tests/domestic/full_response.rs`.
- **IMAGES:** under the observed source a request does not wait for a missing image acquisition, and a later request reads what it stored. `AirInputs::new` keeps its wait. Checked by `tests/domestic/air_forecast_s3.rs`.
- **SHORTEST:** with no ultra-short forecast, `short` and `dailyData` still reach their client format. Checked by `tests/domestic/full_response.rs`.
- **TOWNS:** under the observed source a request naming `강원특별자치도`, `전북특별자치도`, `전남광주통합특별시` or Daegu's `군위군` finds the listed town, with no mid reason in `dailyStatus`, including after a KR remap, and a town outside the list starts its forecast once its lookup ends, ahead of its mid forecast and the optional arms. Checked by `tests/domestic/full_response.rs`.
- **MEASURED:** the evidence document records the scenarios of the first measurement with this binary.
- **PLACEMENT:** the placement gate passes against the single declaration, and the artifact policy passes on outgoing commits.

Failure paths: a cycle that fails before offering leaves the S3 read within the section, and a failed publication keeps the offered state until the next cycle retries it.
