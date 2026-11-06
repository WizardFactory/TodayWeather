# Acceptance for the nation deadline

- **SLOW:** with every city answering after 3.5 s (paused clock), `/v000903/nation/KR` answers 200 with fifteen cities in about 3.5 s. Checked by `tests/nation/deadline.rs::cities_that_answer_after_three_seconds_still_answer_the_nation`.
- **STUCK:** with 대전광역시 never answering, the route answers the legacy 500 child error page at exactly 8 s. Checked by `tests/nation/deadline.rs::a_city_that_never_answers_is_the_legacy_child_error_at_eight_seconds`.
- **UNCHANGED:** the nation suites (`parity`, `request_edges`, `reasons`, `s3`, `averages`) and the full `cargo test` pass.
- **PLACEMENT:** the placement gate passes against the single declaration, and the artifact policy passes on outgoing commits.

Failure paths: a city that fails (status 400+) still yields its legacy child error at once; the deadline only bounds waiting.
