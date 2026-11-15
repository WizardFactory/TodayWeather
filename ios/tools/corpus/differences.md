# JavaScriptCore versus the Node corpus (IN-02, #2951)

The golden corpus (`android/tools/corpus/generate.mjs`, copied into `ios/Core/Tests/TWDomainTests/Corpus/`) records the Cordova client code's outputs under Node, that is V8. The Cordova iOS app runs the same code in JavaScriptCore. `compare_jsc.py` runs the unchanged generator in the JavaScriptCore shell and compares every case with the Node corpus. This file lists every value that differs. For those values the iOS expectation is the JavaScriptCore output until IN-06 (#2955) records a decision.

## Run

```sh
python3 ios/tools/corpus/compare_jsc.py --report reports/sdlc/ios-in-02/checks/jsc-compare-report.json
```

The run took place on 2026-11-13 from 06:25:09 to 06:25:12 UTC and exited with status 0, which means the differences it found are exactly the recorded ones. It used:

- `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc`
- JavaScriptCore.framework 21624.5.1.11.3
- macOS 26.6.2 (25G83), Apple silicon
- `LANG=en_US.UTF-8`

The generator ran once in each of three zones: Asia/Seoul, America/New_York and UTC. The generator itself set only Asia/Seoul and America/New_York.

**Result:** 2,611 cases in 51 files were compared: the 50 generated files of the core-domain corpus plus `android/core-storage/src/test/resources/corpus/push.json`. 21 values in 7 cases differ, all in `special.json`. Every other case is equal, including member order and the text of every number. The conversion, functions, units, forecast, nation, photos, requests, settings, source and weather-info files are byte-identical to the Node files in every zone. `air.json` is byte-identical in the America/New_York run and `alarms.json` in the Asia/Seoul run. In the other runs only their zone-dependent cases change, and those cases match in their own zone. `push.json` and `special.json` mix zones, so no single run reproduces either file byte for byte.

## How it runs

- `node-shim.js` provides the Node APIs that the generator uses.
- `vm.runInNewContext` gives each context its own realm (`$262.createRealm()`), as a Node vm context has its own built-ins. The context object reads and writes the realm's globals through accessors, so the generator's live changes reach the client code. The shell's own functions are hidden from the realm.
- `fs` reads with jsc's `readFile`. Directory listings and the Git commits recorded in `source.json` come from the Python driver, and written files are collected in memory.
- `crypto.createHash('sha256')` is a small JavaScript SHA-256.
- jsc takes its time zone from the `TZ` of its process, so `process.env.TZ` cannot switch zones within one run. The driver therefore runs the generator once per zone. It compares each case in the run of the zone that generated it: the case's `zone` member, the zone argument of `special.json`, or Asia/Seoul for the push and alarm-page cases, whose generator functions set it. All other cases must be equal in all three runs.
- The comparison parses both sides with member order and number texts kept. It reports every differing value, not only the first.

## Differences

All 21 values are announcement times of `parseSpecialData` (`controller.kma.special.js`). Each comes from one of the date strings below in the synthetic `special.json` cases. These are the cases `special.json[1]`, `[4]`, `[7]`, `[10]`, `[13]` and `[16]` (ko-KR, en-US, ja-JP, de-DE, zh-CN and zh-TW in Asia/Seoul) and `[19]` (en-US in America/New_York); the index of the item in each case is shown in brackets. Each line gives the result for ko-KR in Asia/Seoul. `ios/Core/Tests/TWDomainTests/JavaScriptCore/differences.json` lists all 21 values.

| Item | `announcement` | Node (V8) | JavaScriptCore | Cause |
| --- | --- | --- | --- | --- |
| `[12]` | `2026-02-30T00:00:00Z` | `2026. 3. 2. 오전 9:00:00` (rolls over to March 2) | `Invalid Date Invalid Date` | JavaScriptCore rejects a day past the end of its month. |
| `[13]` | `2026-04-31T00:00:00Z` | `2026. 5. 1. 오전 9:00:00` | `Invalid Date Invalid Date` | Same rule. |
| `[18]` | `2026-11-07T23:59:60Z` | `Invalid Date Invalid Date` | `2026. 11. 8. 오전 9:00:00` | JavaScriptCore accepts second 60 as the next minute. |

In the other languages and zones the same three items differ in the same way. For example, in en-US in New York Node prints `3/1/2026 7:00:00 PM`, `4/30/2026 8:00:00 PM` and `Invalid Date Invalid Date`, while JavaScriptCore prints `Invalid Date Invalid Date`, `Invalid Date Invalid Date` and `11/7/2026 7:00:00 PM`. The production response `inputs/special.json` and the other synthetic dates format identically in both engines. These include the daylight-saving changes, the year end, the leap day, 24:00, minute 60, the offsets and the time value limits.

**Status:** iOS follows JavaScriptCore. The values are recorded in `differences.json`, and `GoldenCorpusDisplayTests.warningsMatchCordova` expects the JavaScriptCore output for exactly these values; the rest of every case stays on the shared corpus. `Warnings.jsDate` (TWDomain) implements the JavaScriptCore rules. The Android port keeps V8's rules, which Chromium WebViews share. The server sends ISO strings with valid dates (`inputs/special.json`), so the two apps print the same times for real announcements.

### Date strings beyond the corpus

The corpus differences led to a direct probe of JavaScriptCore and Node with `new Date(string).toISOString()`, using the same jsc and Node 24.19.0 with `TZ=Asia/Seoul`. JavaScriptCore results:

- **Day past the month's end:** invalid. This includes `2100-02-29`, which is not a leap day, and `2026-02-29T10:00`.
- **Second 60:** the next minute. Its fraction is ignored: `23:59:60.500Z` gives `00:00:00.000Z`.
- **Hour 24:** accepted only at minute 0 and second 0, but with a fraction: `24:00:00.001Z` gives `00:00:00.001Z`, which V8 rejects.

- **Local time without an offset in a daylight-saving gap:** it moves forward by the gap. With TZ=America/New_York, `2026-03-08T02:30:00` gives `07:30Z`; with TZ=Europe/Paris, `2026-03-29T02:30:00` gives `01:30Z`.
- **Local time without an offset in an overlap:** the earlier instant. New York `2026-11-01T01:30:00` gives `05:30Z`; Paris `2026-10-25T02:30:00` gives `00:30Z`.

The daylight-saving rule is ECMAScript's LocalTime→UTC rule. These local-time results were added after review finding CODEX-IN02-1 and come from the same jsc, run with the TZ of each zone.

`JavaScriptCoreDateTests` pins these 19 results and 13 local times around the New York and Paris changes. Not probed further: string forms the server does not send (non-ISO formats), years outside 0000–9999, and dates before the Gregorian calendar.

## Not compared

- **iOS branches of the Cordova code.** The generator runs the code with `ionic.Platform.isIOS()` false and an Android user agent, so it exercises the Android branches. The iOS-only branches are outside this comparison: keyboard, status bar, store link, ad unit and push type `ios`. The tasks that port them add iOS cases, as #2948 G3 asks.
- **The engine of the shipped app.** The run used the macOS shell and framework, not the WKWebView of an iOS device or simulator, whose JavaScriptCore build differs by iOS version. iOS 17 is the oldest supported release.
- **`push.json`.** It is compared with the Android file. It is not part of the iOS corpus copy, because its consumer (push registration, IN-04) is not ported yet.

## Corpus records that the native apps do not follow

- **A01:** a weather response is applied to the place selected when it completes (`weather-info.json`, V09). As on Android (AN-06 decision, `android/tools/corpus/differences.md`) and under #2948 decision 2, the native iOS app will tie each response to the place that requested it (IN-08). The corpus keeps the Cordova record, and `GoldenCorpusTests.lateResponseIsAListedDifference` checks that this list names it.
- The other behavior decisions listed in `android/tools/corpus/differences.md` apply to the iOS tasks that port those screens. IN-02 ports none of them.

## Deliberate differences from the Kotlin port

The Swift core follows JavaScript where the Kotlin port's emulation differs from it outside the corpus:

- **`Js.numberToString`:** Swift prints exponential notation below 1e-6 and from 1e21 (`1e-7`, `1e+21`), as JavaScript's `Number.prototype.toString` does. Kotlin prints these values in plain notation.
- **`AirQuality.sentimentIcon`:** a boolean grade gets the default icon, as JavaScript's strict equality gives. Kotlin converts it to a number.

No corpus case reaches these differences.
