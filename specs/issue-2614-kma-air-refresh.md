# Acceptance for the AirKorea refresh

- **REFRESH:** with 용산구 an hour behind in the first two datasets, the capture (300 ms interval in the test) acquires the hour twice more without any request (a later check, so a later key, for the second), and a later request answers 용산구 with the current hour. Checked by `tests/domestic/air_s3.rs::the_capture_acquires_the_current_hour_again_while_a_station_lags`.
- **STOP:** after the third dataset, ten further capture checks make no call in that hour, although a station three hours behind (out of service) stays in every dataset. Same test.
- **UNCHANGED:** the existing air suites pass unchanged, including the hourly capture test (one capture per hour when every station is current).
- **PLACEMENT:** the placement gate passes against the single declaration, and the artifact policy passes on outgoing commits.

Failure paths: a refresh that fails leaves the stored data and is tried again at the next check; the per-key retry throttle still applies to the hour's first acquisition.
