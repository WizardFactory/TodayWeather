# Selected geocoder funding — local verification

2026-10-18. Base `1e31ac1ee91e916f9c36162ff474c4386b36ecd4`; independent B1
correction for [#2819](https://github.com/WizardFactory/TodayWeather/issues/2819).
This is local behavior evidence, not cutover or quota qualification. The candidate
commit is bound by the PR record; runs used the uncommitted source bytes later
committed without runtime edits.

## Regression and checks

Three new tests failed on unchanged runtime before the fix: Google exhaustion
blocked complete Kakao, unused Kakao exhaustion blocked Google address lookup,
and local Kakao key0 exhaustion prevented trying key1. Each failed the expected
success assertion; compilation and peer setup succeeded. The test filter also
selected one existing passing configured-endpoint test.

After the change: 64 gateway tests and 93 library tests passed (157 total),
including S08 funding, exact response bytes, address persistence, fallback, key
rotation, cache/single-flight, waiter cancellation and HTTP/deadline coverage.
A paused-clock funding delay test stops at the existing five-second owner
deadline and observes no late HTTP. All-target clippy `-D warnings` and Rust
format checks passed. Tests use synthetic credentials and owned peers.

Commands from `server2/` (Rust1.99.0, macOS ARM64, dev/test debug and incremental
compilation disabled for this task; shared ignored target):

```sh
cargo test --locked --offline -j2 --test gateway
cargo test --locked --offline -j2 --lib
cargo clippy --locked --offline -j2 --all-targets -- -D warnings
cargo run --locked --offline -j2 --example geocode_funding_smoke
```

## Additional integrated smoke

The [example](../../../../server2/examples/geocode_funding_smoke.rs) composes the
real Geocoder and FundedQuota with owned loopback HTTP and volatile conditional
S08 objects. Google is deliberately exhausted first using a synthetic one-unit
daily limit. A Korean lookup succeeds with the expected country/KMA projection;
the cache returns equal bytes; the foreign Google lookup is denied without HTTP.
The peer is stopped and awaited. Actual bounded report:

```json
{
  "foreign_google_denied_without_http": true,
  "google_authority_after": 1,
  "google_authority_before": 1,
  "google_http": 0,
  "kakao_authority_after": 1,
  "kakao_http": 1,
  "kma_projection_preserved": true,
  "live_provider_calls": 0,
  "production_eligible": false,
  "scope": "owned-http-volatile-budget",
  "synthetic_daily_limit": 1,
  "verdict": "PASS",
  "warm_matches_cold": true
}
```

Report SHA-256: `fc1770e4c0b4cce98c1aa3a5b989515fd10f8932a192821a60a72631da8df4a4`.
Smoke executable SHA-256: `c003789a613d5516f03351b105ce53529277989e10605e41ceb45ec2604474b7` (native macOS dev build, retained outside Cargo target).
Source maps and raw original/green/smoke output remain in ignored task evidence.
Synthetic one-unit authorities make this example's counts legible. Real S08
authority blocks can reserve multiple units; authority usage is not a wire counter.
Funding after selection is conservative and never refunded if cancellation or
deadline intervenes before send. Built-in allowance values did not change.

## Placement, docs and limits

[Funding2819 declaration](../../../../server2/config/tasks/Funding2819.json)
precedes dependent edits. Implementation remains under server2, without legacy
runtime reads, new settings or modes. Architecture, verification instructions,
plan and [illustrative contract flow](../../../architecture/diagrams/server2-geocode-funding.html)
are updated. Archify showcase artifact/browser checks pass; light1440 and
dark2048 captures were inspected separately. This is a bug correction, not a
new product feature/UI; existing PDF snapshots are not relabelled as new runs.

No live provider, production-key/account quota measurement, live S3, cloud
mutation, push send, deployment, merge or shadow run occurred. This B1 result
does not resolve B2/B3 or qualify a production/recovery release. C1 PR2820's
CI is separate; its earlier whole-run weather502 deadline failure is not
attributed to or fixed by this funding change. Current remote CI and independent
review are required before readiness.
