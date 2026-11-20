# Physical keyboard and alarm trials

Use the baseline worktree and development-signed **profile app** described in the [parent guide](../README.md). Both tests address only `net.wizardfactory.todayweather.profile3029`. They assume portrait, 428 × 926 points, a seeded native Seoul forecast and the English software keyboard. The chart studies used a separate driver.

1. In the disposable baseline worktree, run `git apply ios/tools/responsiveness/iphone/fixture.patch`. Copy `CloseoutProbe.swift` into `ios/TodayWeather/` and `CloseoutTests.swift` into `ios/TodayWeatherUITests/`. The two Xcode groups synchronize those paths. The patch restricts weather to the bundled fixture, routes saved-place posts to the event ledger and instruments the native text and alarm controls.
2. Generate the dense fixture with `server.py` from the parent directory. Pass a controls file containing `{"size":"dense"}` and fetch `/weather/v000903/coord/37.567,126.978` from its loopback port into `ios/TodayWeather/DeviceSeoul.json`. Verify SHA-256 `1945adf31948ff8dfbd4aba283d597f1a6a8d1ca802d5f4e518fcb31b974c088`. In the profile project's signing configuration omit the shipping App Group and push capabilities, use a distinct UI runner ID, and set the weather base to `https://fixture.invalid` with private SDK settings empty. Install and seed the stopped profile container as described in the parent guide.
3. Build for testing with the TodayWeatherUITests scheme, Release configuration and generic iOS destination. Set the test scheme’s system attachment lifetime to keep always and its capture format to screen recording, or set `SystemAttachmentLifetime` to `keepAlways` in the generated xctestrun. Use that file for both batches. Each command below needs a fresh result bundle and log. Replace the selector with `testAlarm` for the alarm pair.

```sh
xcodebuild test-without-building -xctestrun "$PROFILE_XCTESTRUN" \
  -destination "platform=iOS,id=$IPHONE_UDID" -parallel-testing-enabled NO \
  -only-testing:TodayWeatherUITests/CloseoutTests/testKey -resultBundlePath "$RESULT" > "$LOG" 2>&1
xcrun xcresulttool export attachments --path "$RESULT" --output-path "$ATTACHMENTS"
python3 ios/tools/responsiveness/iphone/echo.py "$ATTACHMENTS" "$LOG" A
```

For alarms, copy `Documents/iphone-closeout.csv` from the profile app's data container with `xcrun devicectl device copy from`. Run `python3 ios/tools/responsiveness/iphone/alarm.py EVENTS.csv ALARM_LOG A` and repeat with the second log and batch B. The runner and app use device uptime. The first interaction in each process is rehearsal. Review the recorded field/key coordinates and the two screen states before interpreting pixels on other devices. Full device recordings and XCTest bundles stay local.
