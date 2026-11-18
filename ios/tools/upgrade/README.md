# Upgrade test tools (IN-03, IN-04, IN-17)

Simulator tests of the update from the Cordova 1.1.1 app to the native app, and of the rollback hand-back to a fallback Cordova build. The procedures, the checks and their limits are in [`ios/README.md`, "Upgrade test (simulator)"](../../README.md#upgrade-test-simulator) and ["Rollback hand-back to a Cordova build (IN-17)"](../../README.md#rollback-hand-back-to-a-cordova-build-in-17). These tools read `client/` to build a test input; the Xcode build never uses them.

| File | Role |
| --- | --- |
| `build-cordova.sh` | Builds a Cordova simulator app from `client/` at `HEAD` (or a given commit, such as the 1.1.1 release 07dbb370) in a temporary directory, with the recorder as server URL, a Firebase configuration of a project that does not exist and, for a fallback build, another `config.xml` version. |
| `run-upgrade-test.sh` | Erases a `tw_*` simulator, seeds the Cordova app, installs the native app over it and runs the checks (`localStorage` or `suite` state; FCM token `token-a` or `token-b` for the push re-registration). |
| `seed-cordova.js` | Injected first script of the Cordova copy: guards and reports the page's requests, seeds the state through the app's services, has the Cordova app send its token and push list once (the reference requests) and posts the state to the recorder. |
| `recorder.py` | Local HTTP server on `127.0.0.1`: the Cordova build's and the push test's server, the seed's report target, the request log (with headers and bodies of push requests). |
| `check_upgrade.py` | Host checks of the simulator containers, the Firebase SDK files, the request log and the result bundles (the five `CordovaUpgradeTests` and, in each push run, `PushUpgradeTests` must have passed, not been skipped; the `push` stage compares the native push requests with the seeded records and the Cordova reference requests); writes `summary.json`. Also writes the dummy Firebase configuration. |
| `make_fixtures.py` | Writes the synthetic storage fixtures of `TWStorageTests`. |
| `run-handback-test.sh` | IN-17: Cordova 1.1.1 → native (edits) → fallback build (check, edits) → native (adoption) → fallback build (check, withdrawal) → native, on a `tw_*`/`twios_*` simulator. |
| `handback-cordova.js` | IN-17: injected first script of a fallback build copy: guards the page's requests like the seed and checks, edits or withdraws through the app's services, reporting to the recorder. |
| `check_handback.py` | IN-17: host checks of the hand-back run (the suite, the fallback build's reports, crash reports, the SDK's event counters and console, the result bundles, the requests); writes `summary.json`. |

Outputs belong under the ignored `ios/build/`.
