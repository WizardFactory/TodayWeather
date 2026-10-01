# Cordova / PWA device comparison

Observed 2026-10-01 for #2649. This compares the existing installed Cordova application with the production PWA candidate. No native token integration or personal-device app replacement was performed. Synthetic PWA weather isolates rendering from live-provider differences. Native weather content is the user's existing screen; private captures remain local and are excluded from committed documentation.

## Scale definitions

| Platform | System baseline / comparison | PWA display setting | Meaning |
| --- | --- | --- | --- |
| iPhone12 Pro Max | UIKit Large17pt / XXXL23pt | 100%, independently130% | 23/17 =135.3%; accepted nearest iOS system step, not exact130% |
| Android15 API35 emulator, Pixel7 profile | `font_scale`1.0 /1.3 | 100% /130% | AK-authorized fallback after GalaxyS21+ stayed unauthorized; OS and PWA controls are separate inputs |

AK accepted approximately135% for iOS and requested the difference be recorded. iOS Settings' slider labels are normalized slider percentages, not text-scale multipliers. The original50% slider corresponded to Large17pt; the100% slider corresponded to XXXL23pt. The PWA control remains exactly1.3.

## iOS observations

A standalone signed XCTest runner served the static PWA over phone loopback with a synthetic revision4 weather snapshot. Safari displayed the PWA at its100% and130% controls. The system comparison separately kept the PWA control at100%, changed UIKit17pt to23pt, captured the weather/chart screen and restored the original system step. Installed Cordova1.1.0 (build1) remained in place.

The PWA chart's filled temperature values, separate legend/readout and chart-only horizontal scrolling were visible on the physical screen. The installed Cordova chart and detail text stayed visually similar across system steps, consistent with its fixed CSS sizing; no Web Inspector numeric CSS measurement was obtained on iOS. Captures that missed the chart were rejected as chart evidence. A later coordinate-based capture shows the lower hourly chart and overlapping native legend. This is a comparison observation about the installed native build, not a new native fix in #2649.

Device system restoration is checked explicitly; a later runner's first restoration landed on an adjacent step, so a separate restoration check was required. The separate restoration check confirmed50% and UIKit Large17pt. The retained local execution records identify each run and exact observed slider/category. Raw native screenshots are not distributed because they include personal location data.

## Android observations

The early physical GalaxyS21+ run observed Cordova body14px/root16px at OS1.0 and1.3 and PWA17px/22.1px with its100%/130% setting. A later physical candidate run remained17px at both settings and was rejected as final130% proof. The final physical retries stopped at ADB `unauthorized` before changing device state. AK authorized an Android emulator fallback; physical Galaxy coverage remains unverified.

The final fallback used a real Android15 API35 arm64 Google APIs emulator, Pixel7 profile, with Chrome and WebView124.0.6367.219. The existing debug Cordova1.1.0(100090) APK was installed only in that isolated emulator; it is an older comparison baseline, not a current native build. Both surfaces received the repository synthetic Seoul fixture; external networking was disabled. Native normalization ran through WeatherUtil/WeatherInfo; the PWA used its real revision4 IndexedDB offline snapshot path.

At system1.0/1.3, Cordova body14px/root16px and chart15px stayed fixed. PWA body17px/root16px at its100% control became22.1px/root20.8px at130%. No page overflow was measured. Actual emulator chart captures were inspected: PWA values remain legible, the readout wraps, and scrolling stays inside the chart. OS1.3 and PWA D2=1.3 are separate applied inputs; this is not proof that OS-only scaling changes PWA text. Original OS1.0 and test-origin storage were restored.

Selected synthetic [100% PWA](../evidence/2026-10-01-pwa-design/android-emulator-pwa-100.png), [130% PWA](../evidence/2026-10-01-pwa-design/android-emulator-pwa-130.png), [100% Cordova](../evidence/2026-10-01-pwa-design/android-emulator-cordova-100.png) and [130% Cordova](../evidence/2026-10-01-pwa-design/android-emulator-cordova-130.png) captures and APK/image digests are retained in the [sanitized observation record](../evidence/2026-10-01-pwa-design/physical-observations.json). Earlier captures of the wrong foreground tab were rejected. No personal native screenshots are published.

## Reproduction and boundary

`node scripts/verification/pwa-android-d3.mjs <adb-serial> <ignored-output-directory>` requires an already authorized connected Android device, installed Cordova app with a debuggable WebView, Chrome and Playwright. It saves/restores system font scale and local test-origin storage, blocks external PWA requests, removes its forwarding/reverse rules, and preserves installed applications and data. `--emulator` permits synthetic seeding only after verifying an emulator serial and `ro.kernel.qemu=1`; use a disposable isolated AVD with external networking disabled and an existing debug native APK. This is a running Android runtime, not Playwright device emulation, and is labelled separately from physical coverage.

iOS reproduction requires the paired device, a separately signed XCTest runner, installed Cordova and Safari. Observe and back up the original system text category; compare17pt/23pt, inspect actual screens and verify restoration. Never replace the installed app or clear browser/app data to obtain a test result. Home-screen installation, physical OS zoom and full native adoption are not established by this comparison.
