# Window and font fit verification

The JVM fit suites run with `./gradlew test`. They render Korean and English screens at font scale 1.3 in phone portrait/landscape, small windows, tablet portrait/landscape, open/closed foldable portrait/landscape and split-sized windows. Existing normal-font screenshot tests remain unchanged. These simulated window sizes do not prove Android multi-window lifecycle behavior.

## Actual window transitions

Build `./gradlew assembleDebug assembleDebugAndroidTest`, then use an API 36 task-owned AVD whose name begins with `tw_`:

```sh
ANDROID_SERIAL=emulator-5570 sh tools/large-screen/run-window-fit.sh /tmp/tw-window-fit
```

The runner refuses a physical device or another AVD name. It takes the emulator offline before installing either package. The test application records push requests and uses an invalid weather host; forecast content comes from the checked-in Seoul fixture written through the production cache. Nationwide pages exercise offline responses; their populated maps and warnings are covered by `NationFitTest` on the JVM. No production server or SDK data is needed.

Each run starts with empty saved state, then seeds one place. It checks gesture navigation at font scales 1.0 and 1.3 and three-button navigation at 1.3. Korean app locale is the default so the Korean-only nationwide menu rows exist. The test enters **actual split screen** alongside Android Settings, rotates, restores full screen and, on foldable AVDs, closes, rotates and reopens the device. It asserts `isInMultiWindowMode`, current versus maximum window bounds and requested font scale. The saved place must survive those transitions.

In each window it visits forecast/air cards, saved places, alarm settings and time picker, four settings screens, nationwide offline screens, the start page, menu and exit question. The access notice is checked on its first appearance in that app open. Full-display PNGs and `sizes.txt` accompany assertions. `SCREENS=false` runs a narrower shell-only diagnostic; it is not full-screen coverage evidence.

The runner grants notification permission only on the owned emulator, restores font/navigation settings and display overrides, and removes both packages before restoring network access. Do not use an AVD containing app data you need: installation starts by uninstalling the app. Host GPU rendering avoids the System UI ANR observed with the API 36 foldable's software renderer; record any infrastructure failure separately from product fit failures.

## Oracle and limits

`ShellFit` checks text layout overflow, unintended ellipsis, horizontal safe-area bounds and clipping by fixed ancestors, including parents inside scrollable content. Only clipping along a scroll viewport’s own axis is allowed (with a one-device-pixel line-box rounding tolerance for Chrome-compatible text metrics); page-specific journeys scroll to cards/actions, and dialog tests require the whole action bounds to be visible. `FitAssertionTest` qualifies the ancestor-clipping assertion with deliberately clipped text inside and outside vertical/horizontal scroll containers, plus normal partial and offscreen content. `WindowMetricsTest` distinguishes current and maximum bounds, including the application display size on API 24.

The S05 gauge bands and nationwide mode labels retain documented intentional ellipsis. Canvas chart geometry and accepted map-label overlap retain their existing specialized tests. System-owned permission, sharing and Google UMP surfaces are not app-layout assertions. This task verifies fit, not Cordova pixel equivalence; AN-18 PR 3 owns screenshot parity and PR 4 owns the native manual.
