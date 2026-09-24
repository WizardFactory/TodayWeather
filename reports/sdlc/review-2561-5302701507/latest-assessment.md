# Latest PR review/comment assessment

Reviewed head: `b13dc38adece3d301765b03afea4a5feb9d02d8b`; base: `01eb787b10cc2694ea52642b8b24ad8c5426503e`. Remote and local heads agree. Scope: author's review-only adjudication of new comments, not another formal independent PR approval. No product implementation, commit/push, remote comment, live provider/DB, gather or deployment action.

Sources:
- [Review 5303256769](https://github.com/WizardFactory/TodayWeather/pull/2561#pullrequestreview-5303256769): new shower P1, day-3/health P2, three recommendations.
- [Comment 5812616522](https://github.com/WizardFactory/TodayWeather/pull/2561#issuecomment-5812616522): accepts previous short-RSS P1 correction, recommends scheduler cleanup and missing-RSS-field coverage.

The later comment's “no required changes” discusses the prior RSS correction. It does not explicitly rebut or resolve the shower/D+3 findings. Both records are comments, not approval. Current GitHub checks pass (gather18s; RSS11s/25s), but the added probes expose cases outside their assertions.

## Findings and dispositions

### P1 shower labels: accept as mandatory

`midForecastPolicy.weather` lacks `구름많고 소나기` and `흐리고 소나기`, as does `_convertKorStrToSky`. A valid envelope containing either weather string for day4/5 and clear weather for day6 retains only day6 weather. Both real storage-adapter/route configurations omit September28/29 while retaining September30. This is a valid-weather loss, not a malformed-envelope rejection.

Official [KMA mid-forecast DB documentation](https://apihub.kma.go.kr/static/html/attach/fct_medm_table.html) lists mid-land precipitation WB10 as showers. This supports recognizing the category; the specific injected strings are synthetic regression inputs from the reviewer, not newly captured live getMidLandFcst data. No provider contract-change date or deployed incidence is established.

Repair both acceptance and consumer conversion using one authoritative mapping; validate persistence and full response for both labels, both storage versions and both halves. Choose the precipitation/icon representation compatible with existing consumers; do not add a new numeric shower enum without checking them. Restoring unknown-to-clear fallback would be incorrect.

### P2 D+3 and health: underlying observations confirmed; qualify the wording

The template is fixed at41 three-hour slots from D−2 00:00 through D+3 00:00. Midnight conversion makes its final target D+2 24:00. `_mergeShortWithBasicList` intersects stored forecasts with that template. The additional route probe provides eight valid synthetic D+3 short slots at the model boundary: no D+3 survives the public hourly or daily response when mid-land starts at day4. This establishes service truncation even if a valid stored source exists. It does not establish what the production DB currently contains. The v2 save/read implementation iterates supplied records without a D+2 future cutoff; v1 retains a bounded latest64 short slots.

The same result reports `healthy:true`, `reasons:[]`, `unavailableDates:["20260927"]`. However, the implementation contract explicitly defined healthy as publication/target validity plus a usable future mid row, not continuity. Thus this boolean is following its written contract; the concern is the usefulness and naming of that contract for operational daily health. Issue2560 allowed an honest unavailable D+3, so absence alone must not be called a violation requiring invented data.

“D+3 is always missing” is too broad: both DB versions' legacy mid day3 controls return September27. The systematic gap applies to the captured day4-start shape and the limited short template.

Recommended disposition: address before declaring daily recovery. Preserve legitimately available short targets beyond the template with source publication/field validation, or at minimum expose incomplete/degraded coverage clearly and track the fill as a follow-up. Do not relabel mixed stale short records fresh or shift day4 into day3. If changing `healthy` semantics, specify internal-gap versus unavailable trailing-horizon policy and test both.

### Retired RSS scheduler: accept recommendation

`controllerManager.checkTimeAndRequestTask` still queues `midrss` on startup/putAll and at minute2. `/gather/midrss` invokes retired `mainProcessM`, logs its error and sends an empty success response. The requester performs no provider request or write. This creates misleading failed-collection logs but does not block other tasks. Remove the retired scheduler task while preserving explicitly unavailable/manual compatibility behavior. Documentation currently saying scheduled entrypoints are disabled needs this distinction.

### RSS-only humidity/extrema: reproduce humidity; explicit extrema omission is intentional

With a stale primary, fresh matching tomorrow RSS, valid temperatures/extrema/sky/precipitation type, and only `reh:-1`, both DB formats omit tomorrow's daily row. The snapshot contains usable weather but `_getDaySummaryListByShort` rejects a day whose humidity list is empty. Humidity is an unnecessarily strict prerequisite for the advertised daily weather/min-max contract.

Missing explicit tmn/tmx also leaves daily rows unavailable, but that behavior was documented and independently tested in the preceding correction. Deriving extrema solely from accepted fresh RSS t3h samples is a possible product policy; sampled extrema are not necessarily the provider's true daily minimum/maximum. Do not borrow stale primary extrema or silently pretend sample extrema are full-day predictions. Add independent missing-humidity coverage and settle sampled-extrema semantics deliberately.

### PR bulk, global list and compatibility recommendations

- Confirmed added-line counts versus base:59133 total,42483 report lines plus15720 diagram lines (58203 combined,98.4%; binary PNGs additional). Keep the compact contract, repair evidence and required architecture source; move bulky raw outputs to durable CI artifacts where possible. Repository instructions require generated architecture HTML and skill receipts locally, so trimming must preserve required handoff evidence rather than indiscriminately deleting it.
- `global.tempString` is redundant; three consumers shadow it with `midPolicy.tempFields`. Repository search finds no other reader. Removing or deriving the global is a valid small cleanup, not the current forecast-loss cause.
- Native TodayWeatherUtil.m selects midData.dailyData by dictionary key; shared JS `_parseMidTownWeather` similarly iterates dailyData. These inspected consumers do not reject the extra dailyStatus field. This is source evidence only, not native runtime/build verification or a guarantee for every shipped client. No logging/alert currently consumes dailyStatus. A sanitized degraded-health diagnostic is useful, with controlled volume.

## Executed evidence

`TZ=UTC NODE_PATH=/tmp/issue-2560-offline/node_modules node reports/sdlc/review-2561-5302701507/latest-probe.js`

Exit0; ten independent scenario expectations across DB1/2: four shower parse-to-response losses, two captured D+3 truncation/healthy cases, two legacy day3 controls and two humidity-only RSS losses. Evidence: latest-probe-results.json. Real module/parser/Express middleware executes with external/config/timer boundaries stubbed before loading; app.js is read only for declarations. All additional data synthetic. Fixed clock2026-09-24 16:27KST. Nodev22.22.2 and the existing isolated dependency set (async2.6.4, xml2js0.4.23, Mocha2.5.3, Express4.13.4, sprintf0.1.5, Mongoose5.1.2).

An initial probe incorrectly expected public hourly minimum19 after normal mixed-hourly adjustment; the existing primary slots can yield18 there. The assertion was corrected to inspect the valid RSS input for this humidity-isolation case. This harness correction is not counted as an additional product defect. Final ten-case result is the retained successful run. The existing full suites were not rerun because no implementation changed; their current-head GitHub checks were inspected.

R1 (adjudicate new comments): satisfied with source inspection and direct probes. R2 (repair scope/priorities): mandatory shower fix, bounded D+3/health clarification and source-valid fill, targeted recommendations as above. No approval/merge-ready claim; no external reviewer resolution inferred. Reuse the stable review task and its iteration counters; no new independent agent or architecture regeneration is necessary for this bounded assessment.
