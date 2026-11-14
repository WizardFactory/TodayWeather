# Spec: iOS tracking-permission row and page notice with a Settings shortcut (#2990)

Source: [intent](../intent/issue-2990.md), [issue #2990](https://github.com/WizardFactory/TodayWeather/issues/2990),
master `312ae970`, the [#2945 spec](issue-2945.md), and Apple's
[User Privacy and Data Use](https://developer.apple.com/app-store/user-privacy-and-data-use/) read on 2026-11-15.

## Problem and outcome

The Cordova iOS app shows the tracking choice nowhere after the one system prompt. After this change the menu shows the
choice, and the three weather pages show a notice while tracking is off. Both open the app's page in iOS Settings.
Android and the native apps do not change.

## Behaviour that stays

- App code never requests ATT permission. UMP owns the explainer and the system prompt (#2945 R1).
- The request rule, the consent order, the `request_policy` console line and the measurement of #2945.
- Every file under `client/www`, `client/scss` and `client/bower.json`. The Android parity references record hashes of
  `index.html`, the tab templates, `ko.json`, `en.json` and the controllers, and
  `android/tools/emulator/check-sources.mjs` fails on any change to them.

## Design: an iOS-only overlay applied by the build hook

The feature lives outside `client/www` and is merged into `platforms/ios/www` by an `after_prepare` hook, in the same
way `client/scripts/ios-ad-privacy.js` patches the generated plugin source. `cordova prepare` rewrites
`platforms/ios/www` from `client/www` each time, so the hook always starts from a clean copy.

| Part | Path | Content |
| --- | --- | --- |
| Overlay script | `client/resources/ios/tracking-settings/tracking-settings.js` | Two directives of the app's Angular module, the status reader and the visibility rule |
| Overlay styles | `client/resources/ios/tracking-settings/tracking-settings.css` | Styles of the notice |
| Overlay texts | `client/resources/ios/tracking-settings/strings.json` | Five keys for each of the six locales |
| Hook | `client/scripts/ios-tracking-settings.js`, registered in `client/config.xml` | Copies and inserts the parts into `platforms/ios/www` |

Rejected: editing `client/www/index.html`, the templates and the locale files. It needs a full recapture of the 45
Android reference sets from one APK (several hours and about 640 changed files in PR #2949) for a feature Android never
shows, and it ships the markup in the Android bundle.

## Requirements

### R1. Status for the UI (AC1, AC2, AC4)

1. The overlay reads the status with the existing read-only plugin action `twAdPrivacyState`
   (`cordova.exec(..., 'emiAdmobPlugin', 'twAdPrivacyState', [])`). It adds no native code and calls no ATT request.
2. It reads at start, on resume, when the app becomes active again (the iOS tracking prompt closing makes it active),
   after each banner load or failure, when one of the three pages is entered and when the side menu opens. iOS ends
   the app when the switch changes in Settings, so the next launch reads the new value. The answer to the prompt
   therefore shows on the current page whether or not an ad loads (review finding C1-02).
3. A failed or unknown answer counts as `unavailable`. Before the first answer both elements are absent.

### R2. Visibility rule (AC1, AC2)

One pure function decides both elements, so a test can run every case.

| ATT status | Menu row | Page notice |
| --- | --- | --- |
| `authorized` | shown, state "allowed" | absent |
| `denied` | shown, state "not allowed" | shown on the hourly, daily and air pages |
| `restricted`, `not_determined`, `unavailable`, unknown | absent | absent |

The notice has no close control and stores no "hidden" state. It leaves only when the status is no longer `denied`.

### R3. Placement (AC2)

- Menu row: directly after the `openAdPrivacy()` button in the side menu, in the same button style as its neighbours.
- Notice: the last element inside `ion-content` of `tab-forecast.html`, `tab-dailyforecast.html` and `tab-air.html`,
  after the data-source credits. It scrolls with the page. It uses no `$ionicPopup`, `$ionicModal`, alert or backdrop.
- Both call `cordova.plugins.diagnostic.switchToSettings`, which the app already uses for location and notifications.
  If the call fails, nothing else happens and one `console.warn` line reports it.

### R4. Texts (AC3)

Keys: `LOC_TRACKING_PERMISSION`, `LOC_TRACKING_ALLOWED`, `LOC_TRACKING_NOT_ALLOWED`, `LOC_TRACKING_NOTICE`,
`LOC_TRACKING_OPEN_SETTINGS`. The hook adds them to the six locale files of the iOS bundle, so the app's own language
choice and English fallback apply. AK set the Korean notice and button on 2026-11-15; the other texts translate it:

| Locale | Row label · states | Notice | Button |
| --- | --- | --- | --- |
| ko | 추적 허용 설정 · 허용됨 / 허용 안 함 | TodayWeather는 광고 수익으로 운영됩니다. 관심사에 맞는 광고를 원하면 iOS 설정에서 추적을 허용할 수 있습니다. 기능은 어느 쪽이든 같습니다. | 설정 열기 |
| en | Tracking permission · Allowed / Not allowed | TodayWeather is funded by ads. If you prefer ads based on your interests, you can allow tracking in iOS Settings. All features work the same either way. | Open Settings |
| ja | トラッキングの許可 · 許可 / 許可しない | TodayWeatherは広告収入で運営されています。興味に合った広告をご希望の場合は、iOSの設定でトラッキングを許可できます。どちらを選んでも機能は同じです。 | 設定を開く |
| zh-CN | 跟踪权限 · 已允许 / 未允许 | TodayWeather 依靠广告收入运营。如果希望看到符合兴趣的广告，可以在 iOS 设置中允许跟踪。无论如何选择，功能都相同。 | 打开设置 |
| zh-TW | 追蹤權限 · 已允許 / 未允許 | TodayWeather 依靠廣告收入營運。如果希望看到符合興趣的廣告，可以在 iOS 設定中允許追蹤。無論如何選擇，功能都相同。 | 打開設定 |
| de | Tracking-Berechtigung · Erlaubt / Nicht erlaubt | TodayWeather finanziert sich durch Werbung. Wenn Sie Werbung nach Ihren Interessen bevorzugen, können Sie das Tracking in den iOS-Einstellungen erlauben. Alle Funktionen bleiben in beiden Fällen gleich. | Einstellungen öffnen |

The texts state a choice and its effect. They promise no personalized ads, because in the EEA that also needs the
stored consent.

### R5. Hook and build guard (AC4, AC5)

1. The hook runs only for the iOS platform. It copies the script and styles into `platforms/ios/www`, adds their tags
   to `index.html`, inserts the row after the `openAdPrivacy()` button, inserts the notice before the closing
   `ion-content` tag of the three templates and adds the five keys to the six locale files.
2. Each insertion uses one exact anchor. A missing or repeated anchor, a missing locale file, a missing or empty text
   or a key that a `client/www` locale file already defines stops the build and names the file and the cause.
3. Running the hook twice gives the same result as running it once. `cordova prepare` copies a file again only when
   its source is newer, so the hook replaces its own earlier insertion (between markers) instead of adding another.
4. `cordova prepare android` leaves `platforms/android` without any of the overlay.

### R6. Documents (AC6)

- `docs/user/cordova-ios/`: add the row and the notice with iPhone screenshots; rebuild and check the PDF.
- `docs/operations/cordova-store-release.md` and `store-privacy-review.md`: describe the notice and give the App Review
  note that explains it.
- `docs/architecture/mobile-api.md` and the Cordova advertising diagram: add the UI's read of the ATT status if the
  diagram shows the status flow; otherwise record why not.
- Dated device evidence in `docs/evidence/tasks/issue-2990/`.

## Probe results (2026-11-15)

- Device-wide "Allow Apps to Request to Track" off (simulator): the app reports `denied` and shows the notice; the
  TodayWeather switch stays listed and enabled in Settings > Privacy & Security > Tracking, and turning it on gives
  `authorized`. The texts need no change for this case.
- The banner does not cover the end of the scrolled page: the iOS banner shrinks the web view (`isOverlapping: false`).
- The theme's `.card` rules outrank a single class, so the notice keeps its spacing on an inner block.
- Evidence: [#2990 record](../docs/evidence/tasks/issue-2990/README.md).
