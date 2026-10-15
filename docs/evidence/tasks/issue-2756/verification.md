# AirKorea image forecast diagnosis and local verification

Issue: [#2756](https://github.com/WizardFactory/TodayWeather/issues/2756).
Date: 2026-10-15. Runtime source base: `1ed4fbf156b9dac2d3e9b8bb8c945a8fb3b63ed4`
plus the scoped local candidate; deployed gather Git base was `c9220de3` with
private changes. This is dated evidence, not a deployment claim.

## Read-only runtime observation

At 03:53–03:55 UTC, the gather Node process was running in gather mode. Its private
image config expected 820×830; no image environment override was found in the
initial process environment or `.env`. Config mtime preceded process start.
Current stderr contained repeated `Invalid Image size : 820 820`, image-load
failure and `INVALID_IMAGE` lines. These lines have no embedded timestamps; the
current log file was sampled, not a deduplicated invocation history.

Mongo read at 03:55:06 UTC: exact image-hourly count 0, six original PM10/PM25/O3
today/tomorrow records at `2026-10-15 11시 발표`, and latest station/province
observations at `2026-10-15 12:00` KST. Required PM10/PM25 GIF URLs were present.
Separate KAQ data was stale (latest forecast 2019-09-18); it was not repaired.

The deployed AirKorea parser and both image controllers matched the investigation
checkout byte-for-byte. SSH was explicitly authorized; only selected nonsecret
configuration, source and bounded logs were read. Temporary authentication files
were deleted. No production collector, restart, deployment or write was performed.

## Current provider replay inputs

Downloaded at 03:59 UTC; binaries remain local and are not redistributed in Git.
Both animations are 820×820, 48 frames. Visual inspection of first and last frames
confirmed `OCT 15 2026 00:00 KST` and `OCT 16 2026 23:00 KST`.

| Pollutant | Public source | SHA-256 |
| --- | --- | --- |
| PM10 | [NIER animation](https://www.airkorea.or.kr/dustImage/2026/10/14/23/09km/AQF.20261014.NIER_09_01.PM10.2days.ani.gif) | `d2193d6812dd275537f4b91af57a37eb4405e97b51bd403418a6251163cd9135` |
| PM2.5 | [NIER animation](https://www.airkorea.or.kr/dustImage/2026/10/14/23/09km/AQF.20261014.NIER_09_01.PM2P5.2days.ani.gif) | `26dba4f51751af5ebd3e9b74da291791a9e03d75e6802e090a5a25993380ea9b` |

Current interior map x=77..662/y=75..793 and the two 36-band numeric legends were
inspected. PM10 frame 14 has green 122 instead of nominal 118; the bounded palette
allowance is four levels. The deployed geographic extent was retained as an
approximation; the provider projection was not independently certified.

## Verification record

Regression: `server/test/offline/airkorea-image.test.js`, using synthetic pixels
and memory models. The intended baseline failure included config height `0`
versus expected `820`; after implementation the current-layout storage/readback
path and rejection/date/override cases pass. The explicit-830 case reproduces
production's rejection. No production dependencies are reachable from the harness.

Additional functional smoke: `server/test/offline/airkorea-image-smoke.js` with
actual `get-pixels` decoding of the two hash-bound GIFs, production image/hourly
controllers and AQI grading, and memory storage/readback. Four geographic
reference points (Seoul, Daejeon, Busan, Jeju) each produced 48 rows per pollutant:
384 stored/read rows, first `2026-10-15 00:00` KST / `2026-10-14T15:00:00Z`, last
`2026-10-16 23:00` KST, all concentrations finite and nonnegative.

Independent review recommended stronger path-test isolation, explicit paired-image failure documentation and removal of dead guards/helper. All three were applied: each invalid-path case now has a valid counterpart, both missing-path cases assert zero writes, and size overrides are documented as limited to the characterized canvas. An isolated mutation removing the pollutant comparison fails exactly the two mirrored mismatch tests (23 pass, 2 fail), confirming that those tests exercise the intended check.

Final checks:

| Check | Result |
| --- | --- |
| Image regression, Node 16.20.2 / UTC | 25 passed |
| Image regression, Node 24.19.0 / America/Los_Angeles | 25 passed |
| Existing AirKorea collection/key endpoints, data.go.kr key config, gather policy (Node 16) | All four test files passed |
| Real GIF decoder/controller/AQI + memory store/readback, Node 16 / Asia/Seoul | 384 rows, PASS |
| Earlier current-GIF replay, UTC and Asia/Seoul | 384 rows each, PASS |
| Archify artifact validate/deliver/provenance check | Passed |
| Archify automated browser check | Passed on retry outside the sandbox; initial Chrome pipe failure was environmental |
| Archify captures and manual visual inspection | Light/dark, 1440×900 and 2048×1320; main diagram readable, no node/edge overlaps observed |
| Artifact policy on the proposed files | Passed using a private temporary index/object store; actual user index unchanged |
| `git diff --check` | Passed |

Reproduction commands are in the test guide. Raw runs remain under ignored
reports; these maintained conclusions do not depend on those files. The collection
figure's topology/source citations stay pinned to its existing committed baseline;
#2756 is explicitly a local candidate overlay, not evidence of code at that commit.

## Limits and handoff

Only the observed 23-cycle is supported; an unvalidated 11-cycle is rejected.
Quantized lower thresholds are estimates. No provider-projection certification,
physical device build/test, public API recovery, real Mongo write or production
rollout was performed. The private 830-height calibration still needs reconciliation
under a separately authorized deployment. See [operations](../../../operations/airkorea-image-forecast.md).
