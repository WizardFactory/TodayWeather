# #2819 B3 — latest Short publication verification

Bounded bug fix on B2 base `0f005ecc0fee343a5cc86ec6dce541916b4305b4`, not an
integrated master release or production qualification. [Contract](../../../../specs/issue-2819-late-publication.md),
[plan](../../../../plans/issue-2819-late-publication.md),
[declaration](../../../../server2/config/tasks/LatePublication2819.json).

## Runtime contract

Latest `vilage-fcst` acquisition is demand-triggered at provision+2/+5/+10
(HH12/15/20 for existing HH00 bases provisioned at HH10). A late first request
uses only the highest elapsed slot. Usable stored data suppresses acquisition.
The source-local mutex holds the newest publication and at most 65,536 cells;
newer bases reset it, older publication/lower slots do not, and full capacity
refuses a new cell. This is not a durable fleet-wide or restart cap.

The original owned flight key, owner, response/wait deadline and completed-result
retention stay. Cancellation does not cancel the shared provider owner. Each
admitted latest attempt also leaves the existing recent-attempt memo for
historical backfill, without using that five-minute memo to suppress the next
three-minute-spaced Short slot. Other families and backfill keep their policies.
The cap counts acquisitions; B2 independently funds HTTP/page/retry work.

## Test-first and clean checks

Before runtime edits the public-source checks actually failed: HH10 was collected
before the required HH12, and the synthetic minute loop produced `[12]` rather
than `[12,15,20]`. The fixture was clarified to expire the unchanged real-time
three-second completed-result cache between due slots; the corrected Red retained
the same two assertions. No physical three-hour or 36-old-call measurement is
claimed. A late-first control passed. Additional boundary/control checks were
added after the first fix and are not claimed as separately observed Red.

The implementation review then exposed a recent-failure/backfill compatibility
gap. An initial test incorrectly expected other memoized historical keys to be
recalled and timed out; that fixture failure is retained and is **not** Red.
After correcting the fixture, the intended assertion failed with two attempts
instead of one for the recent previous-latest publication. Recording the shared
memo fixed it. The bounded three-second owner-settlement wait matches existing
backfill test practice, not a physical five-minute expiry test.

Eight clean target/filter processes passed **310 Rust checks**, with **1 ignored**:
lib 97 (including 4 policy tests), new public-source 6, history 47, budget 33, providers 50,
warnings 31, runtime-services 31 and legacy-version 15. The new 10 cases are counted
once. The source checks cover early/late demand, all three windows and a
post-window attempt after completed-cache expiry, stored usable data, recent
backfill memo and cancelled waiter/shared owner. Policy checks cover exact
boundaries, newer base/clock rollback and a full-map refusal/reset. Format and
all-target clippy with `-D warnings` pass.

**Whole domestic did not pass:** 167 passed, 1 failed, 2 ignored. The same unchanged
positive KMA three-second test failed with `Err(Provider)`; it passes alone in
2.74s and already failed on B2 and a pre-B2 C1 control. The backend, positive test
and life test bytes are unchanged, but the KMA source module intentionally changed
for B3 and is not described as byte-identical. This does not establish root cause
or fix D2. Whole failed logs are retained separately; their passing subset is not
added to the clean-target total. No positive assertion, timeout or test-thread
policy was weakened. Current Linux CI and independent review remain required.

## Separate owned functional execution

```sh
cd server2
cargo run --locked --offline --example late_publication_smoke
```

The dev executable composes real `S3Source`, owned flights, domestic acquisition
and S08 funding with owned S3/HTTP peers. Its synthetic allowance is 100 one-unit
blocks, so exhaustion does not hide excessive attempts. Historical provider work
is explicitly stubbed in this scenario; it is not historical recovery or
LiveForecast successful-publication proof. Request time advances synthetically,
with short waits for the unchanged completed-result cache; this is not an EC2
latency or real three-hour performance test.

Actual report:

```json
{
  "authority_units": 3,
  "clock": "synthetic minute advancement, not realtime three-hour performance",
  "funded_http_attempts": 3,
  "historical_provider_calls_stubbed": 7,
  "latest_http_minutes_after_base": [
    12,
    15,
    20
  ],
  "live_provider_calls": 0,
  "logical_latest_starts": 3,
  "logical_reserved_units": 3,
  "owned_provider_stopped": true,
  "owned_s3_child_reaped": true,
  "post_window_after_cache_expiry_http": 0,
  "production_eligible": false,
  "scope": "owned-S3-provider-synthetic-clock-latest-Short",
  "verdict": "PASS"
}
```

Report SHA-256: `aea6d6fc1fb5eb12eae2e60c390ac39f13e3d98fa226b9f9bc6779cb6f6f7f84`.
Dev executable SHA-256: `8f95566d24f1a2904cae6958583fa82fa0510da8e0309803a4a25ba541de3fff`.
The runner retained the executable outside Cargo, its 204-input compiled source
map, raw logs and child cleanup receipt. The source map was observed after the
run with no subsequent runtime/peer changes; no earlier hash observation or
embedded git identity is invented.

## Diagram and bounds

The [proposed sequence](../../../architecture/diagrams/server2-late-publication.html)
and [editable source](../../../architecture/diagrams/server2-late-publication.sequence.json)
passed automated artifact/provenance/browser gates. Final 1440x900 light and 2048x1320 dark
main viewports were visually inspected after layout repair. Cards below those
viewports were source-reviewed, not claimed visually inspected offscreen. The
pre-implementation base identity remains explicit; a contract diagram is not
execution evidence. No new UI/feature or PDF relabelling was introduced.

No live providers, operating allowance/account measurement, push sends, production
state or merge was authorized. #2819 D1/D2 and notification/readiness/CI/operations
items, #2704/#2705 and seven-day shadow remain open. This is a scoped latest-Short
fix, not global implementation or rollback qualification.
