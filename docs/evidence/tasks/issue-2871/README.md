# AdMob eligibility investigation (#2871), 2026-11-07 KST

Base revision `d5ba8a09`. These are dated observations. Store, AdMob, policy-review
and release outcomes are recorded in [#2871](https://github.com/WizardFactory/TodayWeather/issues/2871),
not here. Account IDs, revenue and raw console data are omitted.

## Developer website and app-ads.txt

| Observation (read-only HTTP/DNS unless noted) | Result |
| --- | --- |
| `https://todayweather.wizardfactory.net/app-ads.txt` | 404 from the legacy Express app behind the CloudFront default behaviour |
| `wizardfactory.net` apex | No A record; `www.wizardfactory.net` is HTTP-only GitHub Pages, and the crawler skips `www.` |
| `https://todayweather.ai/app-ads.txt` before upload | 403 (object absent, private S3 origin) |
| Upload (authorized by AK) | One `app-ads.txt` object in the landing bucket, `text/plain; charset=utf-8`, plus an invalidation of that path |
| After upload | HTTPS 200 and HTTP→HTTPS 200; the body is byte-identical to `npm run store:app-ads` output (59 bytes, one `google.com, pub-…, DIRECT, f08c47fec0942fa0` line); the landing root is unchanged |

AdMob looks for the file on the store developer-website host and at most one domain
level above it ([AdMob help](https://support.google.com/admob/answer/9363762)). Both
store listings must therefore point to `https://todayweather.ai` before AdMob can
authorize the apps. Changing the listings and checking AdMob are AK actions.

## Android journeys with test ads

Emulator: Android 16 (API 36) Google APIs image. Builds: the installed 1.1.0
development APK, which uses Google's sample app ID, and debug candidates built
from this branch with Google's test ad units.

| Journey | Before | After |
| --- | --- | --- |
| Start → "Use your current location" → deny | Spinner never ends; the screen cannot be used ([before](start-denied-spinner-before.png)) | "Access to Location Services has been denied" with Close/OK ([after](start-denied-dialog-after.png)) |
| Search → "Find by location" → deny → OK | Same code defect (unit check) | Dialog; OK asks again |
| Offline → find by location → reconnect → OK | — | "We failed to obtain your location information", then recovery on retry |
| Fresh install → Seoul → weather | No banner for the whole first session; the Ads SDK never starts ([before](first-session-no-banner-before.png)) | Test banner loads and records an impression ([after](first-session-banner-after.png)) |
| Second launch (before the fix) | SDK starts from cached consent; test banner shows | — |
| Select a search result → weather → Back | Navigates; Back does not trap the user | — |

Causes:

- `cordova.plugins.diagnostic` 7.4.0 has no `permissionStatus.DENIED`. Android reports
  `DENIED_ONCE`/`DENIED_ALWAYS` and iOS `denied_always`/`restricted`. No branch in the
  start, search and tab location flows handled those values, so the request never
  settled. iOS shows the same unsettled path in source. It was not run (see the limits).
- `emi-indo-cordova-plugin-admob` 3.0.4 on Android calls back from `initialize` at
  once, before the asynchronous UMP update. The app's single re-initialization ran
  from that callback, 1 s later. That was before consent was cached, so the SDK did
  not start until the next launch.

## Identifier and personalization configuration

- Android: the merged manifest of the installed 1.1.0 development build and the
  candidate debug APK both declare `com.google.android.gms.permission.AD_ID`. The Ads
  SDK adds it, even though the plugin variable is `ADD_AD_ID=false`. The plugin hook
  reads that variable only from `config.xml`, so changing it would not alter the
  build. The release AAB was not inspected.
- iOS: `client/scripts/ios-no-tracking.js` adds `npa=1` to every request and removes
  the ATT purpose string. Non-personalized iOS traffic is therefore expected and
  matches the #2660 decision. UMP or Analytics consent does not change it.

## Recorded, not changed

- The banner sits directly below the bottom tab bar with no gap. The active tab icon
  is also a reload button. This placement is a plausible accidental-click or
  navigation concern, but no AdMob statement ties it to the restriction.
- The banner is requested before Remote Config is ready and ignores the kill switch;
  it is only shown once the policy allows. With the current `true`/`0` defaults, this
  affects at most the 12-second config wait.
- The start-screen permission notice still mentions "Call information" for ad
  safety. The app does not request that permission.

## Checks and limits

`node --test client/test/*.test.cjs` and the regression tests named in the PR. No iOS
run: `xcrun simctl` did not respond on the build host. The current-position city path
in the tab view is covered by unit checks only. Real ad units, store builds, AdMob
reporting and policy review were not exercised.
