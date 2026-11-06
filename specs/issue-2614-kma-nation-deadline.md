# Acceptance for the nation deadline

- **QUEUE:** with inputs that end at 2.8 s and assemblies that hold the CPU for 400 ms, four concurrent nation cities on one `KmaBackend` (two CPU permits) all answer JSON after more than 3.1 s and before 8 s. Checked by `tests/domestic/nation_city.rs::nation_cities_queued_for_the_cpu_admission_still_answer`.
- **SLOW:** with every city answering after 3.5 s (paused clock), `/v000903/nation/KR` answers 200 with fifteen cities in about 3.5 s. Checked by `tests/nation/deadline.rs::cities_that_answer_after_three_seconds_still_answer_the_nation`.
- **STUCK:** with 대전광역시 never answering, the route answers the legacy 500 child error page at exactly 8 s. Checked by `tests/nation/deadline.rs::a_city_that_never_answers_is_the_legacy_child_error_at_eight_seconds`.
- **INPUTS:** on both mounted versions, air is given three seconds and each of the fifteen cities eight; a composition that ends at 3.5 s answers at once without waiting for a pending narrative. Checked by `tests/nation/deadline.rs::air_keeps_the_input_budget_and_cities_get_the_nation_deadline` and `a_late_composition_does_not_wait_for_the_narrative`.
- **UNCHANGED:** the nation suites (`parity`, `request_edges`, `reasons`, `s3`, `averages`) and the full `cargo test` pass.
- **PLACEMENT:** the placement gate passes against the single declaration, and the artifact policy passes on outgoing commits.

Failure paths: a city that fails (status 400+) still yields its legacy child error at once; the deadline only bounds waiting.
