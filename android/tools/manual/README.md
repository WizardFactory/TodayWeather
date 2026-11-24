# Native user-manual captures

`capture.sh` drives the actual debug app through `ManualFirstLaunchTest` and
`ManualCaptureTest`. It captures full device screenshots and checks the associated
state changes. It is an explicit **online** operation, separate from offline
reference/parity capture. It does not run automatically in CI.

Build `assembleDebug assembleDebugAndroidTest` from `android/` with the private
inputs described in [the Android README](../../README.md#private-build-inputs):
`TW_SERVER_URL`, `TW_WEATHER_PHOTOS_URL`, `TW_PLACES_API_KEY_ANDROID` and the existing
Firebase configuration. Debug builds use Google's sample advertising IDs. Never
commit private inputs or the resulting APKs. Set the capture emulator's system
language to Korean and timezone to Asia/Seoul; the runner also sets the app language.

Use only an emulator owned by this task, with API 33+ and Google Play services:

```sh
ANDROID_SERIAL=emulator-5574 android/tools/manual/capture.sh /tmp/tw-native-manual
# A focused retry, after the previous run has ended and cleaned up:
ANDROID_SERIAL=emulator-5574 android/tools/manual/capture.sh /tmp/tw-native-manual-settings settings
# Ad-free (manual and store screenshots, #3122):
ANDROID_SERIAL=emulator-5574 android/tools/manual/capture.sh --no-ads /tmp/tw-native-manual-no-ads
```

`--no-ads` passes `-e ads off`: the test application replaces Google's consent and
Ads SDK platform with `NoAdsPlatform` (androidTest only). No consent request is made,
the SDK never starts and no ad loads; every capture asserts that the SDK was not
started and that no native ad card is on screen, and records `"ads": "off"`. The app
APK is the same debug build; neither it nor a release build has a switch that turns
ads off. In Korea the 광고 개인정보 선택 response (no form required) is the same with
or without ads.

The script installs both APKs, clears app state before each section, sets an
emulated Seoul City Hall location, and uninstalls both packages on **every exit**.
If removal cannot be confirmed, the shared emulator cleanup disables networking
and fails. It refuses a physical-device serial. The selected emulator must not be
shared with another run. Screenshot pulling on failure is diagnostic evidence;
a section passes only when instrumentation reports exactly one successful test.

The sections are `firstLaunch`, `weatherAndAir`, `places`, `alarms`, `settings`,
`nation`, `privacyAndShare` and `analyticsOptIn` (run with `-e analyticsRegion DE`: the consent
popup of an opt-in region). Places/units are seeded for later sections; all
weather, geocoding and nationwide data is read from the configured service, and
search predictions come from the configured Places SDK. Photo feed access is
opted in only by the joint `manual=true`, `weather=production`, `photos=feed`
arguments; other device tests retain their empty photo-feed URL.

Product push requests are intercepted by `TestTodayWeatherApp`, and no FCM token
argument is supplied. The test application's analytics SDK sends nothing (`SilentAnalyticsSdk`,
checked at every capture); the menu shows the region's usage analytics default. The
alarm-edit flow discards its edits; the share flow stops at Android's chooser.
Google SDKs (Places, test ads, consent, Firebase installation/configuration and
messaging) may contact their services. This is not a claim that all SDK traffic is
HTTP GET or that the device is offline. No actual notification delivery is tested.

Review every capture for private information and label accuracy before placing
selected images in `docs/user/android-app/`. Keep raw logs, APKs, rendered QA pages
and unsuccessful runs under ignored `reports/`. The manual's JSON is editable;
rebuild instructions and capture provenance accompany its published PDF.

## Verifier regression checks

Run `"$MANUAL_PYTHON" android/tools/manual/test_verify.py` from the repository root,
using the manual dependency environment described in the user-manual README.
These disposable-copy checks reject a changed screenshot with a stale PDF, retain
hash checks under Python `-O`, and accept the current published edition.
