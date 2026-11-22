# iOS screenshot comparison benchmark

This experiment measures PNG output and comparison costs for [#3089](https://github.com/WizardFactory/TodayWeather/issues/3089). It uses the existing nation, alarm, forecast and side-menu checks and their tolerance files. Use a dedicated, booted iOS 26.5 simulator. Run from the repository root.

```sh
xcodebuild -project ios/TodayWeather.xcodeproj -scheme TodayWeather \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$PWD/reports/issue-3089/DerivedData" \
  CODE_SIGNING_ALLOWED=NO COMPILER_INDEX_STORE_ENABLE=NO \
  COMPRESS_PNG_FILES=NO STRIP_PNG_TEXT=NO \
  TW_SERVER_URL=http://127.0.0.1:1 TW_PLACES_API_KEY_IOS= TW_WEATHER_PHOTOS_URL= \
  build-for-testing

python3 ios/tools/screenshot-benchmark/run.py \
  --device "$SIMULATOR_UDID" \
  --xctestrun "$XCTESTRUN" \
  --out reports/issue-3089/local-trial
```

Set `XCTESTRUN` to the exact `TodayWeather_*.xctestrun` file from the build products.

The runner freezes expected comparison IDs from the fixture manifests. It injects one failed height comparison, checks the two diagnostic PNGs, warms both modes, runs a control with instrumentation disabled, and measures three pairs in alternating order. Use `--smoke` for the injected failure alone. Use `--benchmark-only` after separately verifying the failure and both output PNGs. Each Xcode trial is bounded by `--timeout-seconds` (default 1800). If the forced-failure verdict, all comparison records and both PNGs decode at their expected sizes after an Xcode timeout, the runner reports verified diagnostics and records the timeout separately from the result bundle. A passing capture-all log from the same binary can supply the first warmup with `--warm-all-log`. Each trial uses its own simulator temporary directory. The original capture-all behavior is the default for normal tests.

Read `summary.json` for overall and per-suite paired savings, per-method phase deltas and repeat noise. Trial directories contain `cases.csv`, exact comparison metrics and hashes, Xcode results and phase totals. The manifest records the expected tests, point sizes and locales. The case records identify each reference and both pixel sizes. The loading indicator animates during rendering. Compare its reference, dimensions and verdict across runs, and compare its exact metrics and mask whenever the rendered bitmaps match. The mismatch directory contains both diagnostic PNGs. Run `python3 -B ios/tools/screenshot-benchmark/test_png_validation.py` on macOS to check normal output, corrupted files and wrong dimensions. The benchmark reports application test and command wall times separately. Use the application test elapsed time for the paired comparison to avoid launch-time noise.

### Local build timing

The paired experiment clocks the test workload independently from compilation,
fixture packaging, simulator startup and test-host launch. Record the build
command and any local substitutions with the evidence. Both modes must use the
same build and the exact same fixtures. Use an ordinary CI build for the
qualification run.
