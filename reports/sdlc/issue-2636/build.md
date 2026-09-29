# Build
Author: primary Codex/OpenAI (paseo-codex), context human-falcon/root. Base 39a3336fb2730dfbe9920c62165a2b632874af1e. Exact source identity/file hashes: candidate.json.

- airkoreaObservation.js isolates supported HTTPS URL/auth/envelope/pagination/size/deadline handling and strict KST/number/grade normalization; errors are stable safe codes, not provider bodies. Existing observation methods use one configured key and one transient retry, with no outer retry multiplication.
- kecoRequester now handles four provinces in parallel and preserves successful provinces despite failures. It waits for station+aggregate acknowledgements and guards same-type scheduled overlap. Success timestamps go to stdout despite error-only production Winston; failures use error. Raw observation S3 archival is retained only after batch validation and remains best effort.
- kecoController adds bounded parallel DB reads and additive missing/database-error metadata without changing old two-argument callback users.
- nationAir.js + shared nation route prefer fresh stored aggregates; missing/unusable provinces call the existing shared global-air service at fixed labelled points. Whole response deadline, fanout four, once-only callbacks and immutable completed results keep optional air failures separate from weather. Client recovery never calls AirKorea.
- New fixtures/harness and 26 targeted test cases cover the acceptance/error boundaries; explicit runner/CI add them and a real local Mongo/HTTP smoke. Existing global chain/cache/budget remains unchanged.
- Architecture documents, two generated diagrams and operations.md explain provenance, runtime limits, expired key and separate rollout.

Deviations/amendments: user added nation fallback, requested city parallelism, explicitly excluded AirKorea API from request recovery, and confirmed key expiry with future renewal. No key was requested or transferred. These override the original issue's fallback exclusion. Production/device/entitlement checks are deliberately pending.

Initial intended Red: supported URL assertion failed against retired URL. Green: URL/key tests after migration. Extended cases exposed test-harness-only missing time helper and synthetic response body; fixed harness and retained results. Full offline run needed permitted loopback sockets; sandbox EPERM was not a product failure. Final source then passed green, post-refactor and separate local smoke. No prod startup/collection ran.
