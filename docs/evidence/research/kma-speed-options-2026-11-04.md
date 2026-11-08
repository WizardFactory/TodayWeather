# KMA request speed: causes and options

Investigated on 2026-11-04 at master `0e6ad85d`, after PR #2861 merged. Nothing in the runtime changed, and no provider or AWS call was made. AK requires at most 3 s of request waiting and a measured cold p95 of at most 2.5 s for cutover ([plan](../../../plans/issue-2614.md), [gate](../../architecture/server2.md)). The merged ASOS-primary path has an 8 s budget.

**Until the [EC2 measurement of 2026-11-05](#measured-on-ec2-against-real-providers-and-s3) the merged path had never been timed end to end against real providers, on any host, and that measurement replaces the modeled first-request figures below.** Figures below are labelled *modeled* (the real code with injected delays), *measured* (with its environment), *counted* from the code, or *calculated*. No modeled or calculated figure is a production latency claim.

**Note added 2026-11-07.** "Passes" and "both validators" in this record mean the wire-shape check (`kma_client_eval.py`) and the forecast and history checks of `kma_full_response_contract.py`. They are not client validation as AK defined it on 2026-11-07: a body must give the client everything the production answer for the same path and publications gives, except parts whose provider is slow. That check is [`kma_client_validation.py`](../../../server2/tools/verification/kma_client_validation.py).

## Measured on EC2 against real providers and S3

Measured on 2026-11-05 and 2026-11-06 on one t3.small Spot host in ap-northeast-2d, with the CI-verified musl binaries, real providers and a new bucket in the same region. `Before` is `478232c9`, the head merged as `0e6ad85d`. `After` is `558db418` in the first window and `29243e6e` in the second, so the two windows are not the same code: the review corrections between them include an absent RSS that overlaps stored reads. Times are from a loopback client and include geocoding, with no network to a real client. Each process served its requests in order and stopped.

| Request | Before, 22:40 KST | After, 22:40 KST | Before, 00:20 KST | After, 00:20 KST |
| --- | ---: | ---: | ---: | ---: |
| Empty store, first request | 5,089 | 4,232 and 4,479 | 6,616 | 4,903, 4,976 (Busan) and 3,641 (Jeju) |
| Same cell again, same process | 1,731 | 576 and 578 | 1,741 | 482 |
| New cell, same process | 1,385 | 1,391 and 1,407 | 1,381 | 1,581 |
| Restart, stored cell | 5,795 | 5,828 | 5,184 | 3,777 |
| Restart, another stored cell | 3,097 | 611 | 531 | 3,105 |
| Restart, new cell | 2,672 | 1,506 | 1,379 | 3,109 |

These are single runs, so read them as ranges and not as a percentile. AK's 3 s is not met on the first request of a process, with or without this change.

**What this change delivered.** The first response of an empty store now carries the whole forecast: 17 or 18 daily rows and `healthy: true`, where before it had 11 or 12 rows and `healthy: false` with `temperature-unavailable`. A request repeating a cell fell from about 1.7 s to about 0.5 s. Every response was 200. On every "After" body `kma_client_eval.py` reports no violation and the forecast part of `kma_full_response_contract.py` passes. Its history part was not judged, because this run gave it no hourly evidence, so the tool exits non-zero; `historyStatus` reports the gaps listed below.

**Why the model was wrong.** It gave 1,402 ms for the empty store because its warning cycle and AirKorea fixtures cost nothing. The real first request is held by two things, and in the run examined everything else had finished by about 1.9 s:

- **Warnings.** The first cycle fetches and then publishes up to ten days, 55 or more S3 operations, and took 4.2 to 6.1 s. A request waits 3 s for it and then replays what S3 holds so far, which adds up to 1 s. The waits add up, so this path alone exceeds 3 s.
- **AirKorea forecast images.** Each GIF took 1.1 to 1.8 s to fetch and its upload about 1.5 s, one after another, and every request that arrives during that acquisition waits up to 3 s. That explains the 3,097, 3,105 and 3,109 ms rows above: those requests joined a running acquisition, and the others found the images stored. It is not a difference between the binaries.

Real latency, from the process logs of one run: S3 operations p50 32 ms, p90 40 ms. Provider acquisitions p50 46 ms, p90 308 ms, largest 1,755 ms. A process that served three requests used about 80 KASI calls.

**Other real-data findings.**

- At 22:46 KST the AirKorea call answered 429 on each attempt with the three keys, which production shares, so `current.arpltn` was absent. At 00:18 KST it was present, which points to the daily quota. The 429 left air data out and nothing else.
- `kma_client_eval.py` flagged `current.arpltn.pm10Index` and `pm25Index` as numbers on the first real air data. Legacy sets them from measured values (`server/controllers/kecoController.js:47`) and the corpus recorded only null, so the corpus was too narrow. The contract now lists them under `wire_additions`.
- The computed sunrise on a first response differed from KASI's by 2 minutes in Seoul (07:02 against 07:00), which is the case AK approved on 2026-11-05.
- From 1 November, `historyStatus.missingHourlySlots` lists the off-cycle winter hours, 55 on this date, because a winter hour without a mark has no precipitation type under the approved rules. On 3 November a half-day with an unknown type shows as `wfPm: "구름적고 "` with a trailing space, and that date is reported in `missingDailyDates`.

No credential left the workstation except provider keys passed to the process by SSH standard input. Logs fetched from the host were scanned for those keys, without printing them, and none was found. The instance used a role limited to its own bucket.

### With one bound on the request

The same scenarios ran on 2026-11-06 at 04:26 to 04:29 KST with the CI binary of `435a96cc` (PR #2863): one wait for what the request started, the warning zone state offered before its publications, no wait for image acquisitions, and the geocoder's newer province names mapped to the listed ones. The "Without" column is `29243e6e`, at 00:20 KST and, for Gangneung, at 02:25 KST.

| Request | Without | With |
| --- | ---: | ---: |
| Empty store, first request, Seoul | 4,903 | 2,788 |
| Same cell again, same process | 482 | 1,413 |
| New cell, same process | 1,581 | 1,255 |
| Restart, stored cell | 3,777 | 2,516 |
| Restart, another stored cell | 3,105 | 613 |
| Restart, new cell | 3,109 | 1,351 |
| Empty store, first request, Busan, Jeju, Daejeon | 4,976, 3,641, not run | 2,819, 2,818, 2,820 |
| Empty store, first request, Gangneung | 6,590 | 2,826 |
| Empty store, first request, Jeonju, Yeosu, Gwangju | not run | 2,814, 2,782, 2,783 |

Single runs again. Every response was 200, `kma_client_eval.py` reports no violation, and the forecast part of the full-response check passes. Each first response has 17 daily rows, `healthy: true` and `current.arpltn`. The Jeju first response carried its two active warnings, which the run without this change left out: it read warnings from S3 while they were still being published.

**Province names.** The geocoder answers `강원특별자치도`, `전북특별자치도` and, for every town in Jeonnam and Gwangju, `전남광주통합특별시`. The town list and region table keep the earlier names and legacy's lookups are exact, so before this change those towns had no mid forecast on any response (`land-unavailable`, `temperature-unavailable`), and Gangneung's first request took 6.6 to 8.0 s. The handler now maps them to the listed names. Daegu's `군위군` also misses the list but stays under Daegu, because its air and food-poisoning regions are Daegu's; in a run of fifteen more towns it was the only one left unhealthy (`invalid-daily-row`, `forecast-gap`), which is not investigated here. Incheon, Bucheon and Hwaseong's new districts miss the list too and take the lookup path, within the bound and healthy.

**What is left.** AK's 3 s holds in every run, but the 2.5 s cold gate does not: first requests end at about 2.8 s because they wait to the bound. At night the life arm holds them, the UV call walking four earlier slots at 1.1 to 1.7 s each. Stopping the optional arms when the required ones finish would answer at about 2.2 s, calculated from the traces and not measured, and would leave out air and life data not ready by then. A repeated cell takes about 1.4 s because it decodes the stored images, about 1.2 s on this host. A restart's warning cycle ran 14 s with over 300 S3 operations, republishing days it holds. It no longer holds a request (KMA-SR-06 of #2862).

The host, its bucket, role, profile and security group were removed after these runs, and their absence was read back.

## Result of the change

These figures are modeled, and the [measurement above](#measured-on-ec2-against-real-providers-and-s3) shows what they left out. AK approved the recommended order on 2026-11-05, with a computed sunrise allowed while stored KASI is not fully read. Options C, E, F, H, I and K and the wait part of J are implemented, along with one stored KASI fold. Same harness, same model: real code with injected provider and S3 delays on an Apple M4, not a production measurement. Response p50 in ms at 20 ms per S3 read:

| Stored before the request | Before | After | S3 reads before the response |
| --- | ---: | ---: | --- |
| Nothing | 3,059 | 1,402 | 1,125 to 31 |
| Everything for this cell | 3,025 | 589 | 1,143 to 107 |
| Shared data only, a new cell | 3,025 | 1,361 | 1,137 to 59 |
| Everything except SHRT | 3,025 | 1,367 | 1,157 to 106 |
| Everything except ASOS | 3,022 | 1,045 | 1,137 to 101 |
| ODAM until 08:00 only for today, no VSRT or SHRT | 3,025 | 1,368 | 1,154 to 86 |
| Nine days of this cell's publications, no latest | 3,693 | 1,397 | 1,762 to 269 |
| KASI for 10 of 102 areas | 3,049 | 1,387 | 1,309 to 309 |
| KASI for all areas, no stored fold | 3,211 | 1,389 | 1,447 to 298 |
| KASI for all areas with a stored fold | not measured | 1,385 | 33 |
| 46 days of warnings, no stored state | 3,058 | 1,384 | 1,132 to 169 |
| 266 days of warnings, no stored state | 7,532 | 5,922 | 2,038 to 829 |
| 266 days of warnings with a stored state | not measured | 1,364 | 40 |
| New cell, shared data, all KASI, 46 days of warnings, no folds | 3,112 | 1,368 | 1,432 to 464 |
| New cell, shared data, all KASI and 266 days of warnings, with folds | not measured | 1,374 | 70 |

The empty store now follows SHRT rather than S3:

| S3 delay per read | Empty store before | Empty store after | New cell with folds, after |
| ---: | ---: | ---: | ---: |
| 5 ms | 1,359 | 1,377 | not measured |
| 20 ms | 3,059 | 1,402 | 1,374 |
| 40 ms | 5,093 | 1,427 | 1,390 |
| 80 ms | 7,736 | 1,462 | 1,657 |

Every response was 200, and both validators passed, now including the forecast check. All 18 daily rows and `healthy: true` hold in every state, including the first response of an empty store. The empty-store body equals the fully stored body exactly, as do the bodies of the partial grid and ASOS states. Stored history changes only past `uuu` and `vvv` and `current.yesterday`, within the read window. With a stored KASI fold, the first response carries KASI values; at 80 ms per read the fold did not arrive within the 500 ms wait, so that response used computed values.

What remains:

- **Warnings before the first stored state.** The collector writes `zone-state` only after its sixty-day bootstrap. Until then a cold process replays up to 60 days: about 1.4 s at 20 ms per read and 2.1 s for the 46-day case at 40 ms, outside the 3 s bound. The 266-day rows without a stored state show the growth if the collector never ran.
- **Warm refresh.** A warm process re-reads the warning days every 5 minutes, and requests wait for it although valid memory exists. This comes from reading the code and was not measured.
- **Options not taken yet.** A (stop waiting for air and life), B (3 s budget), D (VSRT guard) and G (packaged AirKorea list) are untouched. Air and life still wait up to 3 s for their providers, whose real latency is unknown. SHRT sets the floor.
- **Limits of the model.** No real provider or S3, no geocoder, one town, 10:50 KST, an S3 gate per store in the harness where production shares one, and no publication with only some pages stored.

## Target case: S3 holds no data at all

This section records the investigation before the change. This is the case AK is optimizing: a request that finds nothing in S3 must still produce a response that passes client validation. The populated-S3 section below concerns stored inputs and does not apply here.

The agreed flow for this case is: collect from providers, assemble, respond to the client, and only then store to S3. Past days cannot be collected from ODAM, VSRT or SHRT, so ASOS supplies them. That is the normal path, not a failure.

**Main finding: providers plus assembly take about 1.36 s in the model, with SHRT last. The current code does not respond then, because S3 reads that cannot find anything on an empty store still hold the response.** S3 writes follow the agreed flow. The response left at 3.04 s at 20 ms per S3 read, and it followed S3 latency up to 7.74 s at 80 ms.

**Second finding: these responses lack D+4 to D+10, although both validators pass them.** See [reference data](#reference-data-on-an-empty-store).

**Third finding: the key layout already answers "is anything stored?" with one LIST.** A temporary prototype that asks this way cut reads before the response from 1,125 to 29 and held the response at 1.36-1.44 s from 5 to 80 ms, with an identical body. See [existence checks](#existence-checks).

**Fourth finding: one LIST is not enough when only part of the data exists.** It covers most partial states, but a cell with nine days of history took 2.65 s, slower than an empty one, and stored KASI and long warning histories still hold the response. See [partially stored data](#partially-stored-data).

### How this was modeled

The real source and gateway code ran through the `full_response` integration test on a release build, with an empty loopback S3 peer, two async workers and 12 S3 requests in flight. Each stubbed provider call slept for a delay taken from the October laptop evidence: SHRT 1,300 ms, ODAM 80 ms, VSRT 110 ms, mid outlook 320 ms, mid land 33 ms, mid temperature 37 ms, RSS 60 ms, ASOS hourly 421 ms, ASOS daily 206 ms. AWS and city pages use an assumed 200 ms. Each S3 GET and LIST sleeps for the stated delay, and the loopback peer adds about 8 ms. Clock 10:50 KST, `/weather/v000903/coord/37.58,126.97`, three runs per case. The temporary test and timing edits were reverted.

"Passes" means `kma_client_eval.py` reports no violation, and `kma_full_response_contract.py` reports no daily gap, with `historyStatus` listing no missing hour or day.

**Note added 2026-11-07.** These passes are the wire-shape and forecast checks, not client validation as AK defined it on 2026-11-07; see [`kma_client_validation.py`](../../../server2/tools/verification/kma_client_validation.py).

### The normal path without S3 delay

No provider call failed in this run. S3 reads still ran against the loopback peer, without injected delay, and the response did not wait for warnings, air or life.

| Step | Done at |
| --- | ---: |
| RSS | 65 ms |
| VSRT | 229 ms |
| Forecast zones and mid forecasts | 329 ms |
| ODAM, including today's elapsed hours | 419 ms |
| Stations, then ASOS for the past 7 days | 869 ms |
| SHRT | 1,318 ms |
| Response, after assembly | 1,355 ms |

The steps run concurrently, so the slowest one decides. The response passes both validators with no missing past hour or day. It still lacks D+4 to D+10.

### Where S3 appears in this case

Writes follow the agreed flow: no S3 write happened before the response, and `response_first` releases persistence when the HTTP body completes. Reads do not. The code cannot know S3 is empty, so it looks first, and for warnings and KASI the request waits only for S3 reads while provider collection runs in the background.

Reads before the response at 20 ms:

| Path | S3 reads | What they do |
| --- | ---: | --- |
| KASI | 820 | Hold the response up to 3 s |
| Warnings | 240 | Hold the response up to `section` |
| Weather data | 41 | Look for stored data before provider calls |
| Air and life inputs | 17 | Look for stored data before provider calls |

The S3 figures below therefore show how far the current code departs from the agreed flow. S3 speed is not a target in itself.

### Results

At 20 ms per S3 read:

| Variant | Response p50 | Weather data ready | Validation |
| --- | ---: | ---: | --- |
| Current code | 3,042 ms | 1,348 ms | Passes |
| KASI not waited | 2,987 ms | 1,345 ms | Passes |
| Current code, AirKorea takes 5 s | 3,322 ms | 1,340 ms | Passes |
| **Auxiliary data not waited, AirKorea takes 5 s** | **1,379 ms** | 1,346 ms | **Passes** |
| Auxiliary data not waited, S3 without delay | 1,355 ms | 1,320 ms | Passes |
| Auxiliary data not waited, SHRT takes 2.5 s | 2,582 ms | 2,548 ms | Passes |

The "not waited" variants gave the arms a temporary zero wait, and their work continued in the background. The bodies of the current code and of the not-waited variant are identical, because the test supplies no air, life or warning data.

The current code follows S3 read latency, because the warning arm is not under the 3 s bound:

| S3 delay per read | Response p50 | Weather data ready | Warning arm | Validation |
| --- | ---: | ---: | ---: | --- |
| 5 ms | 1,360 ms | 1,327 ms | 582 ms | Passes |
| 20 ms | 3,042 ms | 1,345 ms | 2,983 ms | Passes |
| 40 ms | 5,127 ms | 1,532 ms | 5,085 ms | Passes |
| 80 ms | 7,738 ms | 2,061 ms | 7,697 ms, stopped by `section` | Passes |

EC2-to-S3 latency has never been measured. The only real figure in the evidence is the laptop GET p50 of about 36 ms, which is close to the 40 ms row.

Arm completion in the current code at 20 ms: RSS 88 ms, VSRT 261 ms, air 264 ms, ODAM 444 ms, zones and mids 621 ms, stations and ASOS 1,231 ms, SHRT 1,340 ms, warning state 2,834 ms, life and KASI 3,001 ms. A later run gave 2,983 ms for warning state.

What holds the response:

| Arm | Work on an empty S3 | Wait bound | What the wait can deliver |
| --- | --- | --- | --- |
| Warning state | One seed day, 57 year LISTs (1970-2026) one after another, then 60 recent days in waves of 8 with 4 read slots, each day GET, LIST, GET: 240 S3 operations. At 20 ms: seed 84 ms, years 1,585 ms, days 1,314 ms | `section`, 7.7 s under the 8 s budget. Not `WAITER_BOUND` | Nothing, unless the background cycle publishes during the walk. The walk reads S3 only; the provider cycle is started but not waited for |
| KASI, in the life arm | 102 areas, each listing 2 window months and then 9 history months: 1,122 LISTs, 820-847 of them before the response | 3 s `WAITER_BOUND`; the LISTs continue | Nothing. It reads S3 only. `sunrise` and `sunset` are still present, because `fill_missing_rise_set` computes them with NOAA equations |
| Life provider flights | UV, pollen and food-poisoning inputs | 3 s | Provider data if it answers in time. Not modeled |
| Air | Owned AirKorea acquisition | 3 s plus reads: 3,282 ms with a 5 s provider | Provider data if it answers in time. Its latency is not in the evidence |

Removing only one of them does not help, because the arms are joined. All of this used 1,118 S3 operations before the response at 20 ms.

### Existence checks

Where data would be stored is already decided in advance: `index/v2/{source}/{kind}/{key_hash}/{partition}.json` and `raw/v2/{source}/{kind}/{YYYY}/{MM}/{DD}/...`. S3 LIST is strongly consistent, so one LIST of a prefix covering everything answers whether anything is stored. The code instead asks in smaller units:

| Walk | Asks by | Reads now | With one LIST |
| --- | --- | ---: | ---: |
| KASI, `restore_kasi` | 102 areas, 11 months each | 1,122 | 1 |
| Warning zones, `zone_state` | 57 years, then 60 days at GET, LIST, GET | 237 | 1 |
| Forecast zones, `zone_lists` | 9 months | 9 | 1 |
| Mid temperature, `mid_answer_by` | 9 months | 9 | 1 |
| KMA station import, `read_seed` | 9 months | 9 | 1 |
| AirKorea station list, `station_fold` | 9 months | 9 | 1 |

The month walks start at `HISTORY_START_MONTH` (202601), so each gains one LIST per month, and KASI gains 102.

A temporary prototype replaced these walks with one LIST and read only the days that LIST showed. Same harness, three runs per case:

| S3 delay per read | Response now | Response, prototype | S3 reads before the response |
| ---: | ---: | ---: | --- |
| 5 ms | 1,359 ms | 1,359 ms | 1,416 to 30 |
| 20 ms | 3,043 ms | 1,376 ms | 1,125 to 29 |
| 40 ms | 5,093 ms | 1,381 ms | 1,115 to 29 |
| 80 ms | 7,736 ms | 1,443 ms | 903 to 30 |

Every prototype body equals the earlier baseline body, and both validators pass.

With eight concurrent requests at 20 ms, responses took 3.04-4.87 s now and 1.38-1.41 s with the prototype. `refresh_zones` and `station_fold` hold a mutex across their month walks, which is the likely cause; the share of each was not measured.

The remaining 29 reads are about one per data kind, and most run concurrently. Only one LIST precedes the SHRT call, so S3 now adds about one round trip to the response. Existence checks have little more to give after this; the next limit is provider time.

A per-grid head or day locator, deferred in the [data design](../../architecture/server2-kma-data-design.md#s3-layout-and-ownership), would not help this case. It is a hint and cannot prove absence, so an empty answer would still need the LIST. It could only shorten reads when data exists.

The prototype is not an implementation: its LIST loops are unbounded. With it enabled, the warnings suite (31 tests, including orphan repair) and the domestic suite (205 tests) passed as they do without it.

### Partially stored data

The same harness first stored the listed data at full speed, then answered the request from a fresh process model with provider and S3 delays. Response p50 in ms at 20 ms per S3 read, two or three runs per case. "One LIST" is option C. The nine-day rows hold 446 publications. "Plus three" adds a read limit of two days for stored grid publications, a fetch of a latest publication that LIST shows absent without waiting for stored reads, and no wait for KASI.

| Stored before the request | Now | One LIST | Plus three | Provider calls |
| --- | ---: | ---: | ---: | ---: |
| Nothing | 3,059 | 1,397 | 1,395 | 25 |
| Everything for this cell | 3,025 | 583 | 572 | 1 |
| Shared data only, a new cell | 3,025 | 1,363 | 1,362 | 17 |
| Everything except SHRT | 3,025 | 1,364 | 1,372 | 2 |
| Everything except ASOS | 3,022 | 1,056 | 1,042 | 3 |
| ODAM until 08:00 only for today, no VSRT or SHRT | 3,025 | 1,371 | 1,364 | 8 |
| KASI for 10 of 102 areas | 3,049 | 1,395 | 1,436 | 25 |
| 5 days of warnings | 3,060 | 1,391 | 1,395 | 25 |
| 46 days of warnings | 3,058 | 1,399 | 1,401 | 25 |
| **Nine days of this cell's publications, no latest** | 3,693 | **2,647** | 1,401 | 7 |
| **KASI for all 102 areas** | 3,211 | **3,042** | 1,441 | 25 |
| **New cell, shared data, all KASI, 46 days of warnings** | 3,112 | **3,021** | 1,370 | 17 |
| **266 days of warnings** | 7,532 | **5,878** | 5,940 | 25 |

At 40 ms per read:

| Stored before the request | Now | One LIST | Plus three |
| --- | ---: | ---: | ---: |
| Shared data only, a new cell | 5,085 | 1,389 | 1,389 |
| Nine days of this cell's publications, no latest | 6,370 | 4,328 | 1,410 |
| New cell, shared data, all KASI, 46 days of warnings | 5,363 | 3,023 | 2,136 |

Every response was 200 and passed both validators. An early run returned 502 in one state while the test peer capped connections at 16; it did not recur once that cap was lifted, and these tables come from the later runs.

What this shows:

- **Stored history can make a cell slower than an empty one.** With nine days stored, ODAM reads alone took 2.68 s, because the arm reads every stored publication before anything else, and SHRT's provider call waits for its reads (2.47 s). This is the populated-store cost of [the section below](#populated-s3), now measured. Fetching the absent latest early took SHRT to 1.45 s; limiting reads to two days took ODAM to 0.80 s.
- **The KASI wait delivers nothing once all areas are stored.** Ten areas took 540 reads, so all areas take 5,508 (*calculated*). About 1,250 had run when the 3 s wait ended, and `kasi()` stays empty until every read finishes. Background reads still appear to crowd the S3 gate: at 40 ms the stations and ASOS arm went from 872 to 2,110 ms.
- **Warning replay grows with stored days,** about 22 ms per day at 20 ms per read, outside the 3 s bound. `zone-seed` has only a one-time import as its writer, so nothing bounds the replay after cutover. This applies to the first request of a process. A warm process re-reads 60 days every 5 minutes (`zone_refresh`), and requests wait for that refresh although valid memory exists; this comes from reading the code and was not measured.
- **Partial grid and ASOS storage did not change the response.** Bodies from "Shared data only" through "ODAM until 08:00", and the combined row, equal the fully stored body exactly. Stored history did change it: past slots gained stored `uuu` and `vvv`, and `current.yesterday` changed. With the two-day limit, slots older than two days return to the values of a cell without history. The KASI and warning seeds add no visible value in this fixture, so their rows say nothing about those fields.

Tests with each prototype enabled:

| Prototype | Warnings and domestic suites |
| --- | --- |
| One LIST | All pass |
| Early fetch of an absent latest | No failure in the combined run |
| Two-day read limit | Fails `served_requests_record_complete_grid_days_and_late_revisions` and `grid_documents_read_from_s3_equal_the_legacy_oracle`. The prototype applied the limit to every path, and the first test shows daily summaries of older days depend on these reads |
| No KASI wait | Fails `first_request_restores_stored_kasi_without_acquirer_or_warmup`, an existing requirement that the first request reads stored KASI |

Not measured: a publication with only some pages stored, a warm process, other cells and an S3 gate shared across all stores. The harness gives the source and the warning store 12 slots each, while production shares 12, so real contention can be higher.

### Reference data on an empty store

**Correction: the earlier "passes" results hid a missing week of forecast.** Every empty-store body above reports `midData.dailyStatus` with `healthy: false`, `temperature-unavailable` and `future-mid-unavailable`. D+4 to D+10 are absent, leaving 11 daily rows instead of 18. Neither validator checks this.

`collected` (`source/mod.rs:1763`) requests mid temperature only when the runtime forecast-zone list contains the region. An empty store has no such list, so the request never calls `getMidTa`. The list is acquired in the background and reaches later requests only.

The build already carries the official list of 176 zones, `data/kma_forecast_land_zones.csv`. The [data design](../../architecture/server2-kma-data-design.md#grid-source-plan) also says to package the public reference snapshot with the release, and that part was deferred.

When the model supplied the zone list without S3, the response had 18 daily rows and `healthy: true` at the same speed: 1,374 ms at 20 ms. The rest of the body did not change, apart from those rows and their status.

The AirKorea station list has the same shape. With no stored list, `AirInputs::stations` waits for its acquisition and then repeats the month walk. This comes from reading the code; this model has no AirKorea provider.

### Side finding: injected call failures

This is outside the normal path and does not concern past data. Each provider's calls in this request were failed on purpose to see which inputs the response cannot do without:

| Failed | Client eval violations | Daily gaps | Missing hours / days | `short` slots / daily rows | Reading |
| --- | ---: | ---: | --- | --- | --- |
| None | 0 | 0 | 0 / 0 | 41 / 11 | Passes |
| VSRT | **85** | 28 | 1 / 0 | 41 / 11 | **Fails.** `short[].time` stays a string and `skyAm`/`skyPm` stay numbers; `tmn` and `tmx` go missing |
| ASOS hourly | 0 | **26** | **167 / 7** | 41 / 11 | **Fails** the history check |
| SHRT | 0 | 0 | 0 / 0 | **28 / 8** | Passes both validators, although forecast days are gone. **This is a validator gap** |
| ODAM, RSS, zones, mids, ASOS daily, AWS, city | 0 | 0 | 0 / 0 | 41 / 11 | Pass, though values can differ; for example `current.t1h` changes without the AWS minute page |

So the required set today is the current SHRT and VSRT calls and ASOS hourly.

The VSRT failure is one defect, not 85 missing values. `convert_units_mw` loops over `shortest` without a guard (`present.rs:660`), as legacy does (`controllerTown24h.js:1864`). The exception is caught and the rest of the conversion is skipped, so `short` and `dailyData` keep their internal shape. Only a failed VSRT was run; a late one is expected to take the same path.

Validators do not check the auxiliary fields, so "passes validation" does not prove they were delivered:

| Source | Response fields |
| --- | --- |
| Warnings | `current.specialInfo` and the warning item of the summary sentence |
| Air | `current.arpltn`, `airInfo` or `airInfoList`, `dailyData[].dustForecast` |
| Life | UV, pollen and food-poisoning values and grades |
| KASI | `sunrise` and `sunset`. A computed value replaces it, so these stay present |

### Options for this case

| # | Option | Effect | Notes |
| --- | --- | --- | --- |
| A | Respond once the required data is ready. Air, life and warning work continues in the background and reaches later responses | Modeled 3,042 to 1,379 ms at 20 ms. After C it matters only for air and life providers slower than SHRT | Extends AK's omit-late rule to air and life data that would have arrived within 3 s. The gateway sets `max-age` on successes and the weather Lambda observed on 2026-09-20 used 300 s, so an omitted part can stay cached until it expires |
| B | Return the budget from 8 s to 3 s | `until` 2.5 s and `section` 2.7 s stop every arm. *Calculated* worst case about 2.75 s at any S3 latency | Follows AK's 3 s rule and bounds the tail. Needs D first, because required data can then be cut |
| C | Ask each existence question with one LIST, using the existing key layout | **Prototype in the model:** reads 1,125 to 29, response 3,043 to 1,376 ms at 20 ms, 1.36-1.44 s from 5 to 80 ms, identical body | Trades no data. Needs bounded paging, the existing repair and warning tests, and a populated-store check |
| D | Guard the `shortest` loop in `convert_units_mw` | A failed VSRT no longer breaks the client format. Expected, not run | Small, and a deliberate difference from the legacy failure path |
| E | Make validation check `short` slots, daily rows and `dailyStatus.healthy` | Closes the SHRT gap and the hidden missing week | Legacy model-error bodies have fewer slots, so the rule belongs in the full-response check |
| F | Decide mid temperature from the packaged land-zone list when the runtime list is absent | **Model:** 18 daily rows, `healthy: true`, no added time | Needs a check that `row.city_code` gives the right region outside Seoul, because the test covers one town |
| G | Package an AirKorea station-list snapshot with the release | Removes the list wait and its second walk. Not modeled | A new data asset with provenance. Capturing it needs one provider call |
| H | Fetch a latest publication that LIST shows absent without waiting for stored reads | SHRT arm 2,470 to 1,448 ms with nine days stored | No test failed |
| I | Limit stored grid reads to what the response uses, here two days | With H, nine-day cell 2,647 to 1,401 ms at 20 ms and 4,328 to 1,410 ms at 40 ms | Same as option 1 under populated S3. Must not cut the daily summaries that depend on older days, and must apply to the observed path only |
| J | Do not hold the response for KASI, then restore it from one stored fold object | No wait: 3,042 to 1,441 ms, identical body in this fixture. Fold object not modeled | No wait changes an existing tested requirement, so AK decides. The first response can then carry a computed sunrise where a small store would have supplied KASI |
| K | Have the server rewrite `zone-seed` periodically | Bounds warning replay. Not modeled | The read path already replays from the seed's sync |

Recommended order: C, F and E together, because they take S3 out of the response and restore the missing week without trading data. Then H, I and K for stored history and warnings, and J after AK's decision. Then G. Then measure air and life provider latency on EC2 and decide A from that, because A trades data for time. B needs D first.

ODAM rounds are not the bottleneck: at this clock five rounds end at 444 ms, and the nine rounds at 23:xx would end at about 0.8 s (*calculated*). SHRT sets the floor. The injected 1,300 ms is a laptop figure, and an earlier experiment saw 1.45-1.67 s from job start, including validation and quota work. Whether its own time can shrink, for example through its paging, was not examined. Stations and ASOS follow at 0.87 s without S3 delay and 1.2 s at 20 ms.

### Not covered by this model

- Real provider and S3 latency, and their tails. SHRT evidence is a handful of laptop samples.
- The geocoder on coordinate requests. Unversioned `/weather/coord/...` alone carried 70.72% of product API requests in the [recorded window](../aws/api-traffic-2026-09-22.md). It sits in front of all of this and has an empty cache in this case. The test uses a fixed geocoder.
- Provider calls of warnings, life and most air flows, so nothing here says how often option A would drop air or life data.
- Versions other than v000903, late-evening clocks, other grids, a fresh process's station registry geocoding and concurrent cold requests.
- CPU on the production host class.
- Options A to K themselves. None is implemented. The not-waited variants used a temporary zero wait, and C, F, H, I and J used temporary prototypes.

## Populated S3

The rest of this document concerns cells that already have stored inputs. It does not apply to the empty case.

### Main finding

The largest cost is not provider waits. It is that every request re-reads and re-folds nine to fifteen days of stored forecast inputs, although ASOS now supplies completed days.

The busier a cell is, the slower it gets, and the reads stop fitting the budget. A cell does not need heavy traffic to reach that state, because a single late-evening request stores up to 24 current-observation publications.

### Where the time goes

#### Stored inputs, on every request

Counted from `lookback_ms`, `RSS_LOOKBACK_MS` and `mid_answer` in `server2/src/domestic/kma/source/mod.rs`. There is no memory cache for grid, RSS or mid inputs. One lookup takes about three GETs in sequence.

| Input | Window now | Lookups at most | Two-day window | Today only |
| --- | --- | ---: | ---: | ---: |
| Current (ODAM) | 217 h | 217 | 48 | 25 |
| Shortest (VSRT) | 247 h | 247 | 54 | 31 |
| Short (SHRT) | 361 h | 121 | 18 | 10 |
| RSS | 312 h | 104 | 18 | 10 |
| Mid, three regions | Newest month | 186 | 186 unless changed | 186 unless changed |
| **Total** | | **875** | **324** | **262** |
| GETs | | about 2,625 | about 972 | about 786 |

The S3 gate allows 12 requests in flight across the process.

*Calculated* floor for reads alone, at the laptop-measured GET p50 of about 36 ms ([control 32.93 ms, raw 38.88 ms](kma-response-first-measurement-2026-10-24.md)), and at an assumed 10 ms because EC2-to-S3 latency has never been measured:

| Reads | 36 ms per GET | 10 ms per GET |
| --- | ---: | ---: |
| 2,625 GETs, now | 7.9 s | 2.2 s |
| 972 GETs, two-day window | 2.9 s | 0.8 s |
| 432 GETs, two-day window with mid reduced to six lookups | 1.3 s | 0.36 s |

The same arithmetic gives capacity: at 36 ms the gate serves about 333 GETs per second, so a cell at the ceiling costs enough for only about 0.13 requests per second across the whole process. Average product traffic is about 0.085 requests per second ([traffic report](../aws/api-traffic-2026-09-22.md)).

A read that exceeds its bound fails the request instead of omitting data: the snapshot build propagates the error (`current?`), which ends in `SourceAnswer::Failed` and a 502. This contradicts the omit-late rule. It has no production effect today because server2 is not live.

#### CPU on the request path

*Measured:* Apple M4, release build, one thread, valid synthetic inputs of realistic size, no I/O. t3.small will be slower; the ratio was not measured.

| Work | Window now | Two-day window | Today only |
| --- | ---: | ---: | ---: |
| Fold and identity, Short | 480.1 ms (14.9 MB) | 71.8 ms | 40.8 ms |
| Fold and identity, Shortest | 47.0 ms (2.2 MB) | 10.5 ms | 6.6 ms |
| Fold and identity, Current | 6.9 ms | 1.2 ms | 0.6 ms |
| **Total** | **534.0 ms** | **83.5 ms** | **48.0 ms** |

| Other work | Measured |
| --- | --- |
| `replay_observed`, one 31-day acquisition | p50 44.66 ms |
| `replay_observed`, four overlapping 31-day acquisitions | p50 102.05 ms |
| Assembly and encoding, legacy oracle inputs | mean 3.82 ms, p99 4.99 ms |
| `representative::verdict` | 0.01 ms after a 1.09 ms first call |

The process defaults to two async workers (`server2/src/lib.rs`). Fold and replay run on them, and `join!` polls the arms of a request in one task, so one fold stalls all arms of that request.

*Counted* repeated work: ASOS replay parses each page three times per request, and the recorder replays daily pages before its filter. Observed mode still computes the unused backfill list. The dust forecast fold has no memo, unlike its neighbours.

#### Provider waits, on a cold cell

| Call | Measured on a laptop in October, on older code |
| --- | --- |
| SHRT | 1,205–1,345 ms wire; job 1,454–1,667 ms |
| All other forecast calls | provider p50 60–83 ms |
| ASOS hourly, daily | 421.5 ms, 205.7 ms wire, one sample each |
| Whole cold batch with ASOS, including durable publication | 2.347 s, one sample, not a client timing |

Today's ODAM runs as the latest call, then up to eight rounds of three. *Calculated:* nine rounds of 60–156 ms is about 0.5–1.4 s at 23:00, in parallel with SHRT. An earlier estimate of 4.6 s used a figure that includes durable publication, which response-first no longer waits for. So a cold cell in a warm process may already fit 3 s; this is unmeasured.

Quota accounting is not a per-call cost. Its S3 reads and writes happen once per leased block (`server2/src/budget/store.rs`).

### Options

| # | Option | Effect | Effort and risk |
| --- | --- | --- | --- |
| 1 | Read only the window ASOS-primary uses | Reads −63% to −84% by count; fold −84% measured | Small. Removes leftover forecast values from past slots, which matches AK's "no historical SHRT" decision. The response axis does not depend on old publications: a probe of the cold path returned all 41 slots. Keep yesterday, because ASOS for D-1 arrives after 11:00 KST |
| 2 | Enforce 3 s and omit instead of failing | Bounds the wait and removes the 502 | Medium. Needs AK's decision that a first cold response may lack late parts. Foreground rounds not yet started must continue in the background; today they do not |
| 3 | Cheap CPU fixes | Tens of ms per request and less worker stall | Small. One ASOS store per station and input set, skip the backfill list, filter before recorder work, dust memo, folds on the blocking pool |
| 4 | Read mid newest-first and stop early | Up to 180 fewer lookups | Small, but needs checking against `MidDoc::save`, which may merge across saves |
| 5 | View or partition cache (#2841, #2852, #2851) | Warm requests with no forecast I/O: 0.068 s on t3.small on the older path | Large. All three conflict with master and have not been measured on this path. #2841's `Writer` loses master's RAM overlay, and `Fetched` lacks `raw_ids`. Decide after option 1 is measured; a smaller memo over immutable closed partitions may be enough |
| 6 | Raise foreground concurrency | Up to about 1 s late in the day | Small, but provider rate limits are unknown and SHRT still sets the floor |
| 7 | Load shared S3 state at startup | Removes the first-request flood after a restart (422 index LISTs in one sample) | Medium. S3 reads only, so not provider pre-collection, but confirm with AK |
| 8 | Warm active cells (`CaptureRunner` exists, unused) | Avoids cold cells | Needs per-location traffic, which is not in the traffic report, and quota budgeting at 56 units per cell per day (estimate) |
| 9 | Larger host | Unknown | `c7g.large` and `c6i.large` unmeasured. On t3.small the older path took 4.6 s even at 0 ms S3 |

Not recommended now: raising the S3 gate, since it speeds a read that should not happen, and is shared with other traffic. Pack Range reads (#2707) target bodies, not the control reads that remain.

### Recommended order

1. Implement options 1 and 3, and check 4. Verify with a before-and-after local run over a populated cell.
2. Measure on EC2 with real S3 and providers: cold cell, populated cell, restart, concurrency. This needs AK's authorization for AWS and quota. It decides options 5, 7 and 9.
3. Implement option 2 and set the budget to 3 s once the measurement shows how often data would be omitted.

### Never measured

- Any end-to-end timing of the merged path, and EC2-to-S3 latency.
- The `/weather/coord` route, which carries 70.72% of requests, with its geocoder and CloudFront or Lambda hops. Every live sample used `/v000903/kma/addr`.
- Requests per location, so hot-cell share and warm hit rate are unknown.
- Late-evening cold requests, pre-11:00 ASOS and non-Seoul grids.
- CPU on the production host class.

The "2.7 s restore" figures in the October evidence cluster at the old 3 s budget's cutoff (`until` + 200 ms), so they are probably ceilings rather than restore costs. This is an inference; no document states it.

## Sources

Measurement evidence: [response-first](kma-response-first-measurement-2026-10-24.md), [validation](kma-validation-measurement-2026-10-24.md), [full-response reassessment](kma-full-response-reassessment-2026-10-25.md). Design: [data design](../../architecture/server2-kma-data-design.md). Open work: PR #2841, #2851, #2852, issues #2849, #2850. Local bench outputs, including the empty-S3 matrix, variants, S3 sensitivity, the lookup prototype, the partial-storage runs (`partial-s3-v3`, with its `prototype.diff`) and the result runs (`partial-s3-after`), are ignored evidence under `reports/kma-speed-20261104/`. The bench and test edits were temporary and were not committed.
