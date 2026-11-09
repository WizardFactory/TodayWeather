# Acceptance for the held minute page

- **HELD:** a restarted process reads the stored 10:49 page and is asked at 10:53 with a provider that takes 3 s: the request returns within 1.5 s with the 10:49 rows, and the next page is acquired beside it. Checked by `tests/domestic/observe.rs::a_held_minute_page_answers_while_the_next_one_is_acquired`.
- **COLD:** without a held page the request waits for the page as before: `minute_pages_stay_within_the_readers_reach` and the observation suites pass unchanged.
- **UNCHANGED:** the full `cargo test` passes.
- **PLACEMENT:** the placement gate passes against the single declaration, and the artifact policy passes on outgoing commits.

Failure paths: an acquisition that fails leaves the held page until it falls out of the 20-minute reach; then a request waits for the page again.
