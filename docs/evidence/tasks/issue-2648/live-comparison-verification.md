# Independent verification: live observation comparison

Date: 2026-10-01. Verifier: non-builder Codex agent `qa_asos`. Scope: local correction for PR #2656 comment `5921592245`, including late cache-read success handling. No external writes, merge or production execution were performed by this verifier.

Observed base: `e076464b9775131518c9286421da9f49126840c6`.

| Verified file | SHA-256 |
| --- | --- |
| `server/lib/history/observations.js` | `4cf30adbe28680a7432a05e6dc6e476d1403e0653ca00183a37b7ea3a152f5e9` |
| `server/lib/history/readCache.js` | `0c02cb77dbdc2edc100d5d7471cabf7cd7c0479a50df2027426f6c1b1245f21c` |
| `server/test/offline/historical-fallback.test.js` | `b88f76f2d81b9aeec364e898c2077619ea0ae84f5990dd3ac5428cc2d0e4b958` |
| `server/test/offline/history-read-cache.test.js` | `d4dbae111b3d9c421fb44d4d9e05f7ecd485dcfb9d93eead298958447e8842c1` |
| `server/test/offline/history-integration-smoke.js` | `962724232ca9cc81602c56e1cb1c807978f279f4d612c8e1ce2158e09fe3d4a8` |

## Verdict

**PASS for these local corrections.** No unresolved mandatory finding was found. This verification does not substitute for external reviewer resolution, current CI checks or the main agent's merge decision.

Live current observations can now retain the existing comparison against the selected same-town grid observation from the preceding day's same hour. The source minute is validated and floored to its hour; that hour must equal the current row's slot, and the selected yesterday slot must be exactly 24 hours earlier. Thus live `21°C` at `19:27` versus grid `19°C` at the preceding day's `19:00` retains `+2`. A pair of live observations also requires the same valid station ID and matching row hours separated by 24 hours. Different-station, ASOS/live, invalid-minute, wrong-hour and missing/sentinel-temperature pairs remain blocked, with the yesterday projection omitting temperature to protect unchanged legacy clients.

Cache success arriving after the read deadline warms only the original entry while that exact entry remains mapped to the key. It cannot overwrite a replacement entry or settle detached callers again. Late completion is handled once. This extends warming behavior without extending the caller wait or changing the bounded entry/failure retention settings.

## Independently executed checks

Environment: Linux, Node `v22.22.2`; integrated smoke uses `TZ=UTC` and already provisioned dependencies. No authenticated provider requests or production service startup.

| Command | Result |
| --- | --- |
| `node server/test/offline/historical-fallback.test.js` | Exit 0, 13 scenarios. Executes actual minute middleware followed by each yesterday selector, checks live/grid `+2`, same-station live eligibility, station/ASOS mismatch rejection, invalid current temperature, wrong hour/minute rejection and the existing legacy client/midnight protections. |
| `node server/test/offline/history-read-cache.test.js` | Exit 0, 7 checks. Adds late success after read deadline and late result isolation from a replacement entry to existing coalescing/wait/failure/capacity checks. |
| `NODE_PATH=/tmp/tw-2585-mongo/node_modules:/tmp/issue-2560-offline/node_modules TZ=UTC node server/test/offline/history-integration-smoke.js` | Exit 0. Real isolated MongoDB and loopback provider fixture: 175 records and 5 recovery requests; 16 existing serialized response/client coverage scenarios plus 4 live/grid scenarios across DB formats 1.0/2.0 and C/F. Actual legacy client displays `+2˚ than yesterday` in both Celsius cases and a positive converted difference in both Fahrenheit cases. The response adds no fixture provider request. Storage readback/idempotency/lease and wrong-date/bounded-retry checks remain green. |
| `git diff --check` | Exit 0. |

The first restricted fallback-test attempt ran the behavioral scenarios successfully but could not spawn the UTC prerequisite child (`EPERM`). Its permitted local rerun completed all 13 scenarios. The failed setup attempt was not counted as a passing complete run.

## Limits

The legacy timestamp prerequisite is explicitly **UTC ingestion**: the child test pins `TZ=UTC` when parsing the historical wall-clock format. This does not prove that legacy storage written under another host timezone is correct or repaired. The cache deadline does not cancel underlying driver/database work; entry identity prevents late stale replacement, while caller wait remains separately bounded.

Live/grid compatibility preserves the requested historical display behavior; it is not a claim that station and grid measurements are spatially equivalent. No terrain correction, same-day ASOS provider, quota redesign, production latency measurement, native build or deployment was verified. Earlier [comparison correction evidence](review-correction-verification.md) remains historical; this report records the subsequently requested live/grid exception.
