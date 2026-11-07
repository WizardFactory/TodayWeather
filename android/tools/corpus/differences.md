# Behavior differences for the AN-06 decisions (#2885)

Cases where `packages/weather-core` (the web rewrite) or a documented anomaly (`docs/rewrite/decisions-and-open-questions.md`) suggests behavior other than the Cordova app's. The Kotlin core keeps the Cordova behavior until AN-06 decides; the corpus pins that behavior.

Status uses the recommended defaults that AK accepted on 2026-11-08 for this run (`intent/android-native.md`): keep the Cordova behavior unless the recommendation is a fix. AN-06 records the final decisions in #2877.

| ID | Behavior in Cordova (corpus evidence) | Other behavior | Source | Status |
| --- | --- | --- | --- | --- |
| A01 | A weather response is applied to the place selected when it completes, not the place that requested it: Seoul's data lands on London (`weather-info.json`, V09). | Tie each response to the requesting place. | A01 | Fix (recommended); implemented in AN-08 (data layer). The corpus keeps the Cordova record. |
| A02 | `updateCity` keeps older air data when a response omits it. | Replace air data with the response's. | A02 | Keep. |
| A03 | The converted place weather has no `units` object (`vc-no-units`, all cases). | Keep units with the data. | A03, weather-core `parseUnits` | Keep; the data layer requests in the current units. |
| A05 | Latitude 0 fails the coordinate branch (truthiness). | Check for a number. | A05 | Keep (no Korean or common overseas place at latitude 0). |
| A49 | The hourly chart's tablet check compares `NaN < 640`, so every width scrolls to one column before the current hour (`todayPosition`). | Do not scroll on wide screens. | A49 | Keep; `ChartPosition` documents it. |
| C1 | KMA data without a `currentIndex` flag gives `timeChart[1].currentIndex` = -9; the chart then opens at offset 0 (`kma-no-current-index`). World data falls back to the last row (`vc-no-current-index`). | weather-core marks no current row. | corpus | Keep. |
| C2 | An unknown `source` is parsed as overseas data without a `source` value (`unknown-source`); an HTML or empty body returns null (`html-error-body`, `empty-object`). | weather-core rejects responses that are neither KMA nor VC. | weather-core `normalizeWeather` | Keep. |
| C3 | KMA data without `current`, `short` or `midData` still converts with empty parts (`kma-missing-*`); overseas data without `daily` or `thisTime` returns null. | weather-core requires current weather. | weather-core | Keep. |
| C4 | Sentinels and negative values (`t1h` -50, `pop`/`reh` -1) pass through; string numbers count like numbers (`"0"` is truthy) (`kma-sentinels`, `kma-string-values`). | weather-core turns invalid or negative values into null. | weather-core `numberValue`; V05 | Keep; screens show what the Cordova screens show. |
| C5 | `getShortenAddress` joins with a comma: `서울시,명동`. | weather-core joins with a space. | weather-core `shortenAddress` | Keep. |
| C6 | `rainSnowFall` returns the raw value below 10 (a string stays a string) and `Math.round` from 10. | — | corpus | Keep. |
