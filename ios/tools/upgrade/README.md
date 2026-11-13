# Upgrade test tools (IN-03)

Simulator test of the update from the Cordova 1.1.1 app to the native app. The procedure, the checks and their limits are in [`ios/README.md`, "Upgrade test (simulator)"](../../README.md#upgrade-test-simulator). These tools read `client/` to build a test input; the Xcode build never uses them.

| File | Role |
| --- | --- |
| `build-cordova.sh` | Builds the Cordova 1.1.1 simulator app from `client/` at `HEAD` in a temporary directory, with the recorder as server URL and a Firebase configuration of a project that does not exist. |
| `run-upgrade-test.sh` | Erases a `tw_*` simulator, seeds the Cordova app, installs the native app over it and runs the checks (`localStorage` or `suite` state). |
| `seed-cordova.js` | Injected first script of the Cordova copy: guards and reports the page's requests, seeds the state through the app's services and posts it to the recorder. |
| `recorder.py` | Local HTTP server on `127.0.0.1`: the Cordova build's server, the seed's report target, the request log. |
| `check_upgrade.py` | Host checks of the simulator containers, the Firebase SDK files, the request log and the result bundles (the five `CordovaUpgradeTests` must have passed, not been skipped); writes `summary.json`. Also writes the dummy Firebase configuration. |
| `make_fixtures.py` | Writes the synthetic storage fixtures of `TWStorageTests`. |

Outputs belong under the ignored `ios/build/`.
