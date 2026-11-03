# Acceptance for the KMA full response

- **HISTORY:** an observed-history body keeps every past date. A slot or half with measured precipitation evidence never reads PTY 0 or a dry text or icon. An untyped half loses its PTY, SKY and text and is listed in `missingDailyDates`. Checked by `tests/domestic/observed_history.rs` and `tests/domestic/full_response.rs`.
- **RULES:** R1b, D1 and R2s behave as the contract states, including their limits on season, QC, codes and closure. W1 and R2 have no effect. Checked by `tests/domestic/asos.rs`.
- **PRECEDENCE:** derived hourly values stay in the record's `inferred` field and fill only missing fields, and a recorded type stays. Checked by the `policy.rs` unit test.
- **STATION:** the rule holds on both the history and current-weather paths under ASOS-primary only. A rule test over the whole town list fixes 16 moved and 9 unserved towns. Legacy replay is unchanged. Checked by `representative.rs` and `tests/domestic/stations.rs`.
- **CLIENT:** legacy bodies pass the eval, and assembled bodies of every in-use version pass in legacy and ASOS-primary modes. Checked by `tools/verification/test_kma_client_eval.py` and `tests/legacy_versions/client_eval.rs`.
- **RESPONSE:** response-first writing keeps its response, durability and replay contracts. Checked by `tests/response_first.rs`.
- **PLACEMENT:** the placement gate passes against the single declaration, and the artifact policy passes on outgoing commits.

Failure paths: a town without a fitting station reports `station-unrepresentative` and has no ASOS values, and a town without an official coordinate keeps its nearest station.
