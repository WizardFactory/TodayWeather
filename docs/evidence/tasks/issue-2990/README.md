# Issue 2990: iOS tracking row and page notice, device and simulator evidence (2026-11-15)

Dated evidence for [#2990](https://github.com/WizardFactory/TodayWeather/issues/2990). The behaviour is specified in
[the spec](../../../../specs/issue-2990.md); the user steps are pages 6 to 9 of the [iOS manual](../../../user/cordova-ios/README.md).

## Build

- Source: `client/` of branch `ios-tracking-settings-shortcut-2990` (commits `c0f9c6ac` and `6db6825c` on master
  `312ae970`; run 08 also includes the review fix that re-reads the status on activation, banner failure and menu open), prepared with `npx cordova prepare ios` (both hooks ran; `prepare_exit=0`).
- iPhone: Cordova Debug `iphoneos` build with the release ad configuration, re-signed with the development profile,
  installed in place over the 1.1.2 install of 2026-11-15 (city 서울, tracking not allowed). Displayed version 1.1.2.
- Simulator: Debug `iphonesimulator` build on a dedicated iPhone 16 simulator (iOS 26.5, Korean), fresh install.
- Android: `npx cordova prepare android` from the same sources left `platforms/android/.../assets/www` without any overlay
  file or `tw-tracking` / `LOC_TRACKING_*` text; its `index.html` and `ko.json` equal `client/www`.

Driven by a local XCUITest runner (not part of the product). Each file below holds the runner's notes (`#` lines) and
the app's console lines for the ad request mode, banner results and Settings shortcut failures; other console lines,
which include the push token and the place, are left out.

## iPhone 12 Pro Max, iOS 26

| File | Run | Result |
| --- | --- | --- |
| [01](01-denied-pages-and-menu.txt) | Tracking not allowed: hourly, daily and air pages scrolled to the end, then the menu | Each page ends with AK's notice and 설정 열기; menu row 추적 허용 설정 · 허용 안 함; `denied`, `personalized: false` |
| [02](02-open-settings-from-row.txt) | Tap the menu row | Settings opens on TodayWeather; 추적 허용 switch present, off |
| [03](03-open-settings-from-notice.txt) | Tap 설정 열기 at the end of the air page | Same Settings page |
| [04](04-allowed-after-switch-on.txt) | 추적 허용 turned on in Settings (confirmed with 허용), app reopened | No notice on any of the three pages; row 허용됨; `authorized`, `personalized: true` |
| [05](05-denied-after-switch-off.txt) | 추적 허용 turned off again, app reopened | Notice back on all three pages; row 허용 안 함; `denied` |

The notice did not cover weather content, and the banner area stayed separate (the web view shrinks by the banner
height). With tracking not allowed no non-personalized ad was available during these runs (`error_code` 1, no fill).
The phone was left as found: tracking not allowed.

## Simulator (iPhone 16, iOS 26.5)

The fresh install showed the explainer and the ATT prompt; "앱에 추적 금지 요청" gave `denied`. Pages and menu then
matched the iPhone run.

| File | Run | Result |
| --- | --- | --- |
| [06](06-simulator-device-wide-switch-off.txt) | Settings > 개인정보 보호 및 보안 > 추적: "앱이 추적을 요청하도록 허용" turned off with "앱이 추적을 중단하도록 요청" | App status `denied`; notice and row 허용 안 함 shown. The TodayWeather switch stays listed and enabled on that page |
| [07](07-simulator-app-switch-on-while-device-wide-off.txt) | With the device-wide switch still off, the TodayWeather switch turned on | App status `authorized`; no notice; row 허용됨 |

| [08](08-simulator-decline-in-place.txt) | Fixed candidate (review findings C1-01, C1-02): fresh install, "앱에 추적 금지 요청", then the current page scrolled and the menu opened without a page change or relaunch | Notice at the end of the current page; row 허용 안 함; `denied`. The simulator also loaded a test banner, so this run does not isolate the `active` trigger; unit tests do |

So a user whose device-wide switch is off can still remove the notice by allowing TodayWeather alone; the notice text
needs no change for that case. The device-wide switch was turned on again afterwards.

On the simulator the Settings shortcut (`UIApplicationOpenSettingsURLString` through `cordova.plugins.diagnostic`)
opened the Settings root page instead of TodayWeather's page; the iPhone opened the app's page (02, 03).

## Not covered

- The EEA consent message and a device with tracking restricted (`restricted`): source and unit tests only.
- The daily and air page ends of the iPhone run are kept locally only; the manual shows the hourly page.
