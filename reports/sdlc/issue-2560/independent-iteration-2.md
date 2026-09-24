## Iteration 2: corrections and extended challenge

Executed 2026-09-24 at approximately 08:51–08:54 UTC. Verdict: **CHANGES_REQUIRED**, with the original IV-1 and IV-2 findings **closed** and one newly isolated missing-value case, IV-5, open. Same local scope and dependency/runtime versions apply.

The weather validator now matches supported formatter strings, preventing unknown-only collection success. Short overlays require recognized AM/PM weather, remove unavailable sum/lightning values, gate source publication at 24 hours, and cap targets at publication day +4. The v2 mid read explicitly sorts descending publication; inspected temperature schemas omit former sentinel defaults.

Reexecuted:

- `NODE_PATH=/tmp/issue-2560-offline/node_modules node --test server/test/offline/daily-forecast.test.js server/test/offline/rss-wind.test.js`: exit 0, **62/62 passed** (19 daily and 43 existing RSS/wind tests).
- `NODE_PATH=/tmp/issue-2560-offline/node_modules node server/test/offline/daily-response-smoke.js`: exit 0, **16/16 scenarios passed**. Inspected its imported harness: actual Express middleware runs in memory without an HTTP socket; provider/model/timer boundaries are replaced before module evaluation. Both DB versions and Celsius/Fahrenheit responses cover captured, stale, missing-text and missing-temperature paths; correct date gap, current short data and seven-day observation history persist.
- Updated the independent IV-2 and IV-4 requests with `shortPubDate:'202609241400'`, so the new freshness guard does not simply bypass the behavior under test. `/tmp/issue-2560-independent-checks.js` initially passed IV-1 through IV-4. After adding IV-5, the same command exited 1 with **4 passed, 1 failed**.

### IV-5 — Missing short source temperatures become a plausible daily mean

**Severity:** MEDIUM (requirement violation, Must Fix). **Category:** missing temperature/response validity. **Location:** `controllerTown.js`, short-summary numeric cleanup and `_getDaySummaryListByShort`. **Confidence:** high. **Disposition:** open.

Synthetic reproduction: fresh `shortPubDate:'202609241400'`, empty mid daily list, two slots dated `20260925` at `0900`/`1500`; both have `tmn:10`, `tmx:24`, `t3h:-50`, `reh:50`, `sky:1`, `pty:0`, and `pop/r06/s06/wsd/lgt:-1`. Actual `mergeMidWithShort` returns a otherwise usable daily row with `t1d:-1`. Legacy `_average` returns `-1` after all sentinel source temperatures are removed. The new cleanup intentionally permits negative `t1d` and therefore exposes that fallback as a plausible temperature reading.

Issue A's missing-data contract prohibits sentinel-as-real temperature values. Omit `t1d` when there is no valid source temperature for the date, or compute it only from validated temperatures; preserve legitimate negative temperatures, including a real mean of -1. The IV-5 check asserts absent mean for sentinel-only input and preserves real -1 in its second fixture. It currently fails at the first assertion (`-1 !== undefined`). This is distinct from, and does not reopen, the repaired weather/precipitation overwrite reproduction in IV-2.

