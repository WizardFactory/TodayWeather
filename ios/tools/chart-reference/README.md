# Chart references (IN-05, #2954)

The native hourly and daily charts are compared with the charts of the Cordova 1.1.1 iOS build itself, captured on iOS Simulators. What the references hold and how the tests use them is in [`ios/README.md`, "Charts"](../../README.md#charts). These tools read `client/` to build a test input; the Xcode build never uses them.

| File | Role |
| --- | --- |
| `build-cordova.sh` | Builds the Cordova simulator app from `client/` at `HEAD` in a temporary directory, with the local fixture server as server URL, a Firebase configuration of a project that does not exist and Google's test ad units (the IN-03 upgrade-test recipe). Writes `<out>/TodayWeather.app` and `<out>/build-cordova.json`. |
| `capture.py` | `run <udid> <app>`: starts the fixture server on `127.0.0.1:18453`, erases one of the owned capture simulators, sets ko-KR, grants location, installs a copy of the app with `capture.js` injected, records the scenes and screenshots and uninstalls the app. `provenance <app>`: writes `ios/provenance/chart-captures.json` and the test manifest. |
| `capture.js` | Injected first script of the copy: sends requests for other hosts to the local server, loads each fixture through the app's own request path (`WeatherUtil.getWeatherByGeoInfo`, then `convertWeatherData`), shows it on the hourly and daily tabs, posts the scenes and asks for the screenshots at the opening position and both scroll ends. |
| `pngtool.swift` | Finds the calibration marker in a simulator screenshot and crops the chart wrapper, written as sRGB. |

Owned simulators (iOS 26.5): `tw_cap_se3` (375×667 pt, scale 2), `tw_cap_16` (393×852 pt, scale 3), `tw_cap_16promax` (440×956 pt, scale 3). `capture.py` refuses any other simulator.

Data: the corpus fixtures of `ios/Core/Tests/TWDomainTests/Corpus/conversion` (the copy of the AN-02 corpus), served for `GET /weather/v000903/coord/…`; the set is the Android one (`kma-seoul` with screenshots and `vc-london` at every size, eleven fixtures at 393×852; `kma-seoul-sharp` is `kma-seoul` with `current.liveTime` `"2400"`). A run fails when a request for a TodayWeather host or an API path left the Mac, when a weather request did not use `/weather/v000903/coord/`, or when the display, theme or language differs. The Maps JavaScript API's `gen_204` probe is sent to the local server instead and listed in the run's `requests.json`.

The WebView's position on the screen can change between launches (the hourly chart at 393×852 was drawn 54 pt lower in some runs), so the page draws a 20 px marker outside the chart for each screenshot and the crop is computed from it.

Run outputs and the Cordova build go to the ignored `ios/build/chart-reference/`. Delete it after a capture; the Cordova build also leaves an Xcode DerivedData folder `App-*` under `~/Library/Developer/Xcode/DerivedData/`.
