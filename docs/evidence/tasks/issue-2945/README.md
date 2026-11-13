# Issue 2945: iOS App Tracking Transparency device evidence (2026-11-13)

Dated evidence for [#2945](https://github.com/WizardFactory/TodayWeather/issues/2945). The app change is in pull request #2949 (master `c8b7f8c8`).

## Setup

- Device: iPhone 12 Pro Max, iOS 26, Korean, paired over the network.
- Build: `client/` of PR #2949 head `853893b3`, Cordova Debug iphoneos build with the release ad configuration, re-signed with the development profile and installed in place over 1.1.1. The saved place and alarms were kept.
- AdMob Privacy & messaging: the IDFA explainer "TodayWeather iOS IDFA explainer" was published on 2026-11-13 18:22 KST for the iOS app, default language en-US plus ko, ja, zh-CN and zh-Hant, with Google's default text. AK approved the publication.
- UI steps were driven by an XCUITest runner; the app console came from `devicectl device process launch --console`.

## Results

| Step | Observation | Console extract |
| --- | --- | --- |
| Before the message was published, first launch and relaunch | No prompt. `not_determined`, `personalized: false`. First launch: two banner requests ended with code 1 (no fill). Relaunch: banner created | [01](01-before-message-first-launch.txt), [02](02-before-message-relaunch.txt) |
| Message live, about 1 minute after publishing | The Korean explainer appeared. No `request_policy` line and no banner request while it was open | - |
| Shipped-equivalent 1.1.1 build (no purpose string), message live | 2+ minutes: no explainer, no ATT prompt, no crash; adapter ready and banner created | [03](03-shipped-1.1.1-message-live.txt) |
| PR build, answer Allow | Explainer, then the system prompt with the Korean purpose string and the buttons 앱에 추적 금지 요청 and 허용. After Allow: `authorized`, `personalized: true`, banner created | [04](04-allow.txt) |
| Relaunch | `authorized`, `personalized: true` within seconds; no prompt | [05](05-relaunch-authorized.txt) |
| Settings > TodayWeather > 추적 허용 turned off, relaunch | `denied`, `personalized: false`; no prompt; four banner requests ended with code 1 | [06](06-relaunch-after-tracking-off.txt) |

System prompt text read from the device:

> ‘TodayWeather’이(가) 다른 회사의 앱 및 웹사이트에 걸친 사용자의 활동을 추적하도록 허용하겠습니까?
> TodayWeather는 기기의 광고 식별자를 사용해 맞춤 광고를 보여 주고 광고 성과를 측정합니다. 추적을 허용하지 않아도 광고는 표시되지만 맞춤 광고는 아닙니다.

Screenshots of the explainer, the prompt and the setting are in the [iOS manual](../../../user/cordova-ios/README.md).

## Limits

- The prompt was answered with Allow only. A direct "Ask App Not to Track" answer was not run; the `denied` state was reached by switching tracking off in Settings after Allow.
- No fresh install on this phone: it would delete the saved place and alarms. The run started from an updated install whose tracking status was not determined.
- The order with the European consent message, and what follows a refused consent message, were not run.
- The request mode comes from the console line of the same native function that builds the request; the network request was not captured.
- One run each; the no-fill results describe single moments, not fill rates.
- In the Allow run the prompts stayed open about 95 seconds (test start-up), and the app then showed its "cannot find current location" dialog. The app's geolocation timeout is 60 seconds. This was not seen in the other runs and was not reproduced with a quick answer.
- Another automation used the same phone during the run and brought another app to the front once; it did not change the recorded results.

The raw console logs and full-size captures stay outside the repository, because the logs contain the push token.

## Policy page upload (2026-11-13)

AK approved the upload. The three privacy policy pages changed by #2949 were uploaded from master `c8b7f8c8` to the landing site with the [runbook procedure](../../../operations/cordova-store-release.md#privacysupport-hosting-on-the-landing-site): one S3 `put-object` per file with the bucket-owner check, content type `text/html; charset=utf-8`, cache control `public, max-age=300`, then a CloudFront invalidation of the three paths, which completed.

| Public URL | Source | Source SHA-256 | Public check after the upload |
| --- | --- | --- | --- |
| https://todayweather.ai/mobile/privacy.html | `client/fastlane/privacy/privacy.html` | `8291260388a00c55bc6956b671ee26f47ca4c49d5f12a29ac3ad564efcb61904` | HTTP 200, `text/html; charset=utf-8`, body hash equal |
| https://todayweather.ai/mobile/privacy.en.html | `client/fastlane/privacy/privacy.en.html` | `2479a6be187c6c21495abeac0c82c12304f747ef4a9c3a193ae536a28974ca2a` | HTTP 200, `text/html; charset=utf-8`, body hash equal |
| https://todayweather.ai/mobile/privacy.ja.html | `client/fastlane/privacy/privacy.ja.html` | `110d2fb68019aaf52024c3f3846bd5e942ce551e580d7221fba8ff02f3718841` | HTTP 200, `text/html; charset=utf-8`, body hash equal |

- Before the upload the three public bodies differed from these sources; the terms, support and stylesheet objects already matched and were not written.
- The landing root page had the same body hash before and after.
- The previous object versions remain in the versioned bucket. Bucket, distribution and version identifiers stay in private receipts.
- Limits: checked with HTTPS requests from one network; no browser rendering check after this upload. The pages still carry their review-draft notice.
