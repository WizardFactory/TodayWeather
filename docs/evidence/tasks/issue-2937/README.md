# iOS first-launch investigation and origin recovery — 2026-11-12 KST

Repository baseline `e20c6547e2d90cb52cf018e3f02fec924fac3cd3`; submitted source
`97b57689`, iOS **1.1.1 (1)**. Requirements and authorized pre-merge scope:
[#2937](https://github.com/WizardFactory/TodayWeather/issues/2937).
AK separately approved restoring the existing service EIP in this task.

**Current public access was repaired. Native preset/search/location journeys,
HTTP fault/retry and real offline/same-city recovery passed.** No client/backend source, API contract, consent,
DNS, CloudFront behavior, store submission or AdMob setting changed. Policy clearance
and ad fill remain in #2871. This observation does not establish the capture date,
city, version or cause of the historical review screenshots.

## Supported current failure boundary

Public Tokyo/Seoul coordinate weather, geocoding and `/health` timed out. TLS
completed; a GitHub HTTP 200 control excluded a general Internet outage on the Mac.
Current CloudFront weather/geocode behaviors targeted `tw-svc-spot.wizardfactory.net`.
Its Route53 A record, TTL 300, pointed to allocated EIP `13.124.25.12`, which had no
association. The running service at its automatically assigned address answered
health and the identical Tokyo weather request with 200 (`source: VC`).

Japanese archive web assets in the isolated WKWebView reproduced
`天気情報を取得できませんでした` on the public path. At 15.5 seconds, loading was
hidden, pending HTTP requests were empty and there were no WebView errors. The same
StartCtrl/WeatherUtil code through a local proxy to the healthy origin converted the
response and opened weather. This separates current origin reachability from a
locale/encoding, converter or transition hypothesis for the tested preset path.
Presets carry numeric coordinates and bypass address geocoding.

After explicit AK approval, `AssociateAddress` attached the existing allocation
`eipalloc-05ca71894c8db2c0c` to running service `i-0fd9f349294ae57ad`, with
`AllowReassociation=false`. Readback matched association
`eipassoc-033986b8454bf46e1`; public health, Tokyo and Seoul weather returned 200.
See [the operation record](production-restoration.json). No historical detachment
time was established; a bounded CloudTrail DisassociateAddress lookup returned no
events. Do not infer that this caused the earlier AdMob screenshots.

| Before recovery | After recovery |
| --- | --- |
| [Japanese public-path timeout in custom WKWebView](wk-ja-public-timeout-before.png) | [Japanese Tokyo on physical iOS, isolated re-signed archive](native-ja-tokyo-after.png) |

These are different execution environments, not pixel-comparable before/after
release screenshots. Their exact differences are recorded below.

## Artifact identity and isolation

The submitted IPA SHA-256 is
`307f6c5b02127e3168c075385fd7e9d1f371fbaf9896c95be713dcdd11b2a8fb`.
[Archive/WK identity](artifact-identity.json) and
[physical-device identity](device-artifact-identity.json) preserve core file hashes,
execution differences and signing/isolation limits.

The main native matrix used **iPhone 12 Pro Max / iOS 26.0.1**; the USB offline
continuation used **iPhone 8 / iOS 16.7.16**. Both used an isolated re-signed copy
of the submitted archive. Native code was not rebuilt; the Mach-O UUID matches.
`controller.start.js` and `service.weatherutil.js` are byte-identical to the archive.
The bundle ID, preferences suite, signing entitlements and Google test-ad settings
were changed for isolation. Only the clone's localStorage clears each launch; its
preferences suite is independent and changes each launch. No original app-group
entitlement or suite reference is present. Consent logic is retained.

The existing installed app, its data/shared preferences and its location permission
were not changed. Language was selected through clone-scoped launch arguments, not
by changing the device language. These runs are not the unmodified distribution
IPA executing under its original signing identity.

## Scenario matrix and evidence layers

| Layer / path | Cases and observed result | Limits |
| --- | --- | --- |
| Archive-JS custom WKWebView, healthy-origin local proxy | **156/156** preset handlers: 26 × ja/ko/en/de/zh-CN/zh-TW; weather data and forecast transition; 0 WebView errors | Translation switching/controller recreation; no native bridge; 17 phone presets plus nine via a test-only screen-height override; not tablet/tap coverage |
| Physical isolated native archive, restored public path | **17/17** Japanese displayed presets, each from empty clone favorites; weather visible and picker closed | The phone displays 17 of the 26 size-dependent presets |
| Physical native locale controls | **5/5** Tokyo selections: ko/en/de/zh-Hans/zh-Hant | Representative native controls; all presets in each language are covered at WK handler layer |
| Physical native location allowed | Weather visible after the real system permission grant | Actual current coordinates/address omitted from selected evidence |
| Physical native location denied | Japanese denial dialog; Close then alternate Tokyo opens weather | Only clone authorization reset; [dialog](native-ja-location-denied.png) |
| Physical typed search and selection | Actual Google suggestions, Tokyo result selected, weather visible and picker closed; independent rerun passed | [Search weather](native-ja-search-weather.png); the first attempt lost testmanagerd after the preceding radio-off test and is not a product failure |
| Physical real offline/recovery, USB iPhone 8 | **Passed**: Wi-Fi and cellular data off; Japanese error, dismissed/usable picker; both restored; same Tokyo opens forecast | USB WDA survived disconnection; original Wi-Fi1/cellular1/airplane0 independently reverified. Earlier wireless iPhone 12 test lost transport before weather interaction and is retained as a setup failure |
| Physical native HTTP fault/retry | Japanese error, released loading overlay and same-city weather recovery all passed | Clone-only unavailable TCP endpoint, restored after 22 seconds; real iOS HTTP I/O, configuration fault injection, **not** successful radio-off coverage |
| Existing focused permission regression | `node --test client/test/location-permission.test.cjs`: **17/17** | Mocked checks; separate from actual native permission runs |

Selected structured records: [WK matrix](wk-preset-matrix.json),
[native preset results](native-preset-results.json),
[native location results](native-location-results.json),
[native search result](native-search-results.json),
[offline transport/restoration](native-offline-transport.json), and
[native network fault/retry](native-network-fault-results.json).
The [injected error](native-ja-injected-failure.png) and
[same-city recovery](native-ja-retry-recovery.png) are actual physical-device screenshots.
The first exploratory matrix misidentified the asynchronous access notice as a
weather failure; its timing/dismissal was repaired before the final matrix. A
preliminary Korean locale switch reused captured Japanese controller strings; it
is not a Korean error-dialog result. Final locale matrices recreated controllers.

## Reproduction and limits

Follow the [operations procedure](../../../operations/ios-first-launch-weather.md).
Record the exact bundled API base and artifact before testing. Use task-owned state,
test ads and a development profile already authorized for the test device. Do not
share original preferences or reset global privacy settings. Use stable USB for
radio-off testing; an active wireless test connection is not independent of Wi-Fi.

The recovery is an approved infrastructure correction, with actual failing-before
public-path observations and passing-after HTTP/native checks. No speculative
client fix or new binary was produced. Restore of an EIP is not undone by a source
rollback, and the replaced ephemeral public IP is not guaranteed recoverable.

The USB continuation closes the previously unobserved disconnected-network journey.
See the [actual offline error](native-usb-ja-offline-error.png),
[settled picker](native-usb-ja-offline-settled.png) and
[same-city recovery](native-usb-ja-offline-recovery.png). The first Settings locator
matched the application instead of its back button; after correcting that harness,
the real test ran. Its restoration navigation needed a separate cellular-state
continuation; both original data switches were independently reverified afterward.
`system_profiler` returned an empty USB inventory, but IORegistry/libimobiledevice
found the already paired phone; the earlier no-USB conclusion was incorrect.
The compatibility driver was a task-local re-signed Appium WDA prebuilt, without
changing the submitted native executable. Configuration fault injection remains
a separate HTTP error/retry check. No stock-IPA equivalence or AdMob clearance is
claimed; PR review and CI determine pre-merge readiness. Essential selected records and
images live here; raw Xcode results, temporary signing material and exploratory
logs remain ignored local output under `reports/sdlc/issue-2937/`.
