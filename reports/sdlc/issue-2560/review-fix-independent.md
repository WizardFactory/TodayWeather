# Independent verification of PR #2561 review correction

**Final verdict: PASS.** The original short-RSS fallback regression is repaired in the tested candidate. One additional mandatory precipitation finding discovered during this verification was corrected and independently retested; no unresolved Must Fix finding remains.

This is local independent verification in a separate same-provider context, **not cross-provider PR approval**. Compared the uncommitted correction against HEAD `95fe711eee09f021c266303195badb1d4c612ad5`. Read the review assessment under `../review-2561-5302701507/assessment.md` and the correction plan. Verification executed on 2026-09-24 around 10:14–10:18 UTC. No production application startup, provider request, DB connection, collector timer, `/gather` call, remote mutation or source edit was performed by this verifier.

## Inspected behavior

`getShortRss` validates the RSS publication independently and records scalar fields only when they were actually accepted at a matching slot. The request-local `_dailyShortRss` snapshot contains its own publication, dates and copied values, not references to the later-mutated hourly rows. A valid fresh primary retains the existing precedence path. Missing, expired and future primary publications permit independently fresh RSS contributions without granting its publication to untouched primary fields. Daily fallback applies the RSS publication's 24-hour age and publication-day +4 target limits.

The fallback converts midnight to the existing previous-day 24:00 convention, validates source fields before summary and requires actual complete weather/extrema. It does not borrow stale primary temperatures, later `adjustShort` extrema or default weather. The snapshot remains request-local and is absent from the public response. The repaired path explicitly omits daily rain/snow accumulations because the snapshot contains overlapping raw six-hour amounts; hourly presentation remains on its existing adjustment path.

## Finding and correction

### RF-IV-1: overlapping raw six-hour amounts were summed as daily totals

**Severity:** HIGH. **Category:** precipitation semantics. **Location:** `controllerTown.js`, `_dailyShortRss` fallback before `mergeMidWithShort` summary. **Confidence:** high. **Final disposition:** closed after correction and retest.

The first candidate snapshotted `r06`/`s06` before `adjustShort` distributed them across hourly slots. Fallback then fed those raw amounts directly to the daily sum. Independent actual-router reproduction used synthetic tomorrow RSS at 06/09/12/15/18/21/24 KST, every row `r06:6`, `s06:2`, `pty:1`, RSS publication `202609241400`; both storage formats were exercised.

| Primary publication | Daily rain/snow before correction | Sum of corresponding public short rain/snow |
| --- | --- | --- |
| Fresh `202609240500` | 24 / 80 | 24 / 80 |
| Expired `202609161400` | **42 / 140** | 24 / 80 |

The snow figures include the existing final response unit conversion. The public hourly slots were identical between these two runs. The difference came from double-counting overlapping raw periods, not new provider data. This was reported immediately to the author as a Must Fix.

The corrected fallback removes `r06` and `s06` before daily normalization. It therefore emits neither a guessed daily sum nor zero, while leaving adjusted public hourly amounts unchanged. The author added a nonzero rain/snow full-route scenario for both DB versions and C/F. Independent retest verified daily amounts absent and hourly sums still 24/80. This is the documented conservative missing-data contract; it does not claim a newly verified provider accumulation contract.

## Executed checks

Environment: Node `v22.22.2`; `NODE_PATH=/tmp/issue-2560-offline/node_modules`, with Mocha 2.5.3, xml2js 0.4.23, async 2.6.4, Mongoose 5.1.2, sprintf 0.1.5, Express 4.13.4. Full-route smoke uses `TZ=UTC` to satisfy the existing collector fixture's documented timezone prerequisite. All added fixtures are synthetic.

| Command | Final result |
| --- | --- |
| `TZ=UTC NODE_PATH=/tmp/issue-2560-offline/node_modules node server/test/offline/run.js` | Exit 0: **212 regression checks** (103 legacy Mocha +22 daily +44 short-RSS daily +43 RSS/wind), plus gather functional smoke. |
| `TZ=UTC NODE_PATH=/tmp/issue-2560-offline/node_modules node server/test/offline/daily-response-smoke.js` | Exit 0: **36 actual v000903 middleware scenarios passed**, including missing/stale primary, partial/unmatched RSS and nonzero rain fallback, both DB versions and C/F. |
| `TZ=UTC NODE_PATH=/tmp/issue-2560-offline/node_modules TW_SMOKE_OUTPUT_DIR=/tmp/review-fix-original-smoke node server/test/offline/rss-response-smoke.js` | Exit 0: **36 original RSS route compatibility scenarios passed**. |
| `TZ=UTC NODE_PATH=/tmp/issue-2560-offline/node_modules node /tmp/review-fix-independent-probe.js` | Exit 0 after correction: independently constructed nonzero precipitation probes across **8 full-route executions** (two DB versions × two midnight spellings × fresh/expired primary). |
| `TZ=UTC NODE_PATH=/tmp/issue-2560-offline/node_modules node /tmp/review-fix-incomplete-probe.js` | Exit 0: **10 independent expectations**, covering individually absent min, max, sky and precipitation-type fields in both DB versions, plus two midnight equivalence comparisons. |
| `git diff --check` | Exit 0. |

The independent incomplete-field probes keep valid-looking stale primary extrema (30/40, hourly temperature 35), then individually invalidate RSS `tmn`, `tmx`, `sky` or `pty`. Tomorrow is absent in each case, proving the remaining stale field cannot complete the RSS-only daily row. This extends the builder's all-temperature-missing and wind-only cases. The midnight probes encode the identical RSS endpoint once as `202609252400` and once as `202609260000`; resulting calendar dates, daily quantities and public hourly sums are equal in both DB versions.

Earlier execution of the 32-scenario daily smoke without `TZ=UTC` failed because it violated the documented harness prerequisite; rerunning with UTC passed. This setup error is not counted as a product regression or a passing check. All final full-route results above use UTC.

## Final candidate identity

| File | SHA-256 |
| --- | --- |
| `server/controllers/controllerTown.js` | `fd66ce806e19cdec9805f0cdc0852c231a4bc377866eaded3aafe79def4d2ed9` |
| `server/test/offline/short-rss-daily.test.js` | `373a98f922924cf1868f260517b7383d9c26e040d1b37965bc0e4d2e49a4d28b` |
| `server/test/offline/daily-response-smoke.js` | `2593fb1d6111e9b3068c2ddcaebe36acf2e96440a179d92fb33a94c31b0a0222` |
| `server/test/offline/rss-response-smoke.js` | `07fd8ed54652c1530fa292cc2a21ed846dfb94e8df6929d08148020ca8e139db` |
| `server/test/offline/run.js` | `e6dd06a0a4f1768f2cf250770061dca7c4e3b9abddbcf76e5b9c150ed6fd1f76` |

## Limits

The result establishes isolated implementation behavior, not actual provider freshness, nationwide service recovery, native-client builds or deployed-code parity. Missing explicit RSS extrema leave the date unavailable by design. RSS-only daily rain/snow totals are omitted because overlapping periods cannot safely be summed by this path. Main owns documentation/diagram final receipts, committing/pushing the authorized correction and actual PR checks. Merge and deployment are not authorized by this verification.
