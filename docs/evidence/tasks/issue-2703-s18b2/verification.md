# S18b-2 conditional alerts: selected verification

2026-10-16, local macOS arm64. This record is retained because it binds the conditional
worker's compatibility and no-resend evidence to maintained reproduction inputs. Source
commit: `7b3584760994a93e4c7f6b5dd0449e2079c9c484`; stacked task base:
`9fed989e806408f3502867c01e111caca1188326` (S18b-1). Review/CI receipts belong on the PR
at its exact final head; they are not claimed by this self-verification record.

## Authority and source

AK authorized S18 delivery, no automatic resend after failure/unknown/restart, direct server2
implementation and independent review. This slice excludes deployment and all live
FCM/OAuth/APNs submissions. It does not start a scheduler in the process.

- Legacy collector/assembly chain: `server/controllers/alert.push.controller.js`
  `_makeRequestUrl` (56-106), `_getCurrentWeather` (128-149), `_parseWeatherAirData` (156-382),
  `_updateAlertPush` (402-471), `_compareWithLastInfo` (480-534), `_convertToNotification`
  (543-664), `_sendAlertPush` (699-763), `start` (858-870).
- Selection and persistence: `server/lib/pushStore/mongo.js:getAlertsByTime`,
  `updateAlertState`, `disableAlertsByFcm`; schema `server/models/alert.push.model.js`.
- Provider documentation checked read-only on 2026-10-16:
  [FCM HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk),
  [error classes](https://firebase.google.com/docs/cloud-messaging/error-codes).
- Weather provider availability evidence is reused from the completed S13/S15b live collection
  checks. No new weather-provider call is needed for the local conditional-assembly port.

The [fixture provenance](../../../../server2/tests/delivery/fixtures/alerts-PROVENANCE.md)
includes the pinned offline driver and all loaded source hashes. Node v16.20.2, TZ=UTC,
Mongoose 5.1.2, i18n 0.8.3 and sprintf 0.1.5 executed the actual legacy methods twice with
identical outputs. All weather/push/network dependencies were synthetic doubles.

## Executed checks

Commands ran from the repository root, with Cargo 1.99.0, CARGO_INCREMENTAL=0,
CARGO_PROFILE_DEV_DEBUG=0, CARGO_PROFILE_TEST_DEBUG=0, jobs=2, task-local target directory.

| Check | Observed result |
| --- | --- |
| Red parity test before module | Missing feature import failed; subsequent parity exposed missing-locale handling and was corrected |
| `cargo test --locked --test delivery` | 33 passed, 0 failed; old alarm and new conditional regressions together |
| Legacy conditional oracle | 133 cases plus 6 URL cases match; successful parse/decision/state/message JSON compared byte for byte |
| `cargo test --locked --workspace` | 712 passed, 0 failed, 2 ignored across 22 result groups including doc test |
| `cargo clippy --locked --workspace --all-targets -- -D warnings` | Passed |
| `cargo fmt --all -- --check` | Passed |
| `cargo run --locked --example conditional_alert_smoke` | Passed: one real loopback weather GET, one loopback FCM submission, zero restart resends, zero external calls |
| Placement gate with S18b-2 declaration and exact base | Passed; manual dependency/path review found no runtime legacy read |
| Artifact policy, source commit | Passed; final docs/index check is renewed before commit |

The first worker test attempt inside the restricted sandbox could not bind a loopback socket;
that was a permission failure, not a product failure. The authorized loopback run passed.
The concurrent-update regression initially omitted the HTTP Content-Length/location fields;
correcting the test request exercised the actual registration route and preserved the newer
user edit without submitting the stale notification.

The subsequent scheduler clock-jump regression first failed on the missed :07 cycle; waking
with a fresh clock reading passes and claims only the observed :35 cycle. Focused delivery
verification after this fix covers 34 tests. The earlier full-suite 712 count is preserved
as executed evidence; the additional regression is not relabeled as a full-suite run.

Meaningful failure coverage: refused cycle claim, refused alert-state journal, rejected FCM,
connection reset, hanging provider, durable cooldown after restored state, stale user update
during weather preparation, unregistered token disabling alerts only, no-change state update,
normal/overnight inclusive windows and either category's six-hour gate.

## Functional result capture

![Actual local smoke stdout, rendered](conditional-smoke.png)

This is a rendered capture of actual CLI stdout, not a native-device screenshot. The example
creates synthetic local service-account files with the public RFC 7515 A.2 RSA key. It reads
no real credential or device token. Provider acceptance, live credential validity and device
delivery were not verified. No release/LTO build was repeated locally; release checks remain
CI's responsibility to avoid unnecessary disk use.

## Documentation and visuals

The [editable guide](../../../operations/server2-push-delivery.md) and
[PDF](../../../operations/server2-push-delivery.pdf) cover the local scenario and deployment
boundary. The two-page PDF was rendered with PyMuPDF because Poppler was absent; both pages
were inspected visually for clipping, legibility and page breaks. The
[Archify JSON](../../../architecture/diagrams/server2-push-delivery.json) pins actual committed
source; generated HTML passed showcase validation, delivery, provenance and real-browser
checks. Separate light/dark capture and actual visual inspection are recorded in local receipts.

## Limits and differences

This is an unwired library capability. S18b-3 warning feed and S18c notices are separate.
S20 must wire one sender and point its weather source at server2 before legacy retirement.
No legacy runtime fallback is added. The explicit intentional differences are durable state
before provider, a stale-selection guard, one preparation attempt, and no retired GCM API.
Legacy's updateAt cleanup typo remains a no-op. S18b-1's duplicate-cleanup difference applies
to alerts too. No new environment variable, runtime mode or dependency is introduced.
