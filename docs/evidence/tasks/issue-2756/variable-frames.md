# AirKorea variable-frame characterization (#2756)

Date: 2026-10-15. Scope: local provider-image characterization and the follow-up
candidate for [#2756](https://github.com/WizardFactory/TodayWeather/issues/2756).
Source base: `91c77fcb0c61cf5bc69291f0b28566ce1d27f1cd` plus the scoped
variable-frame candidate.
The [follow-up comment](https://github.com/WizardFactory/TodayWeather/issues/2756#issuecomment-6190004112)
reports a 17-cycle rejection after PR #2757 and a separate original-publication
acquisition timeout. This investigation did not independently recheck that
production report or perform a production collection, restart, deployment or
Mongo write. The [initial verification](verification.md) remains a valid account
of the earlier 23-cycle replay; its one-cycle coverage was insufficient.

## Actual provider inputs

Both pollutants use an 820×820 canvas. Frame counts were read with `omggif`
`GifReader`; the 17-cycle pair was additionally decoded by production `get-pixels`
to `[54,820,820,4]`. The first and final timestamp labels of both pollutants were
visually inspected for every cycle. Intermediate labels were not exhaustively
OCR-verified. The one-hour cadence is the characterized format contract, not a
measurement of GIF display delays.

| Image date / cycle | Frames per pollutant | First label (KST) | Final label (KST) |
| --- | --- | --- | --- |
| 2026-10-14 / 23 | 48 | 2026-10-15 00:00 | 2026-10-16 23:00 |
| 2026-10-15 / 05 | 42 | 2026-10-15 06:00 | 2026-10-16 23:00 |
| 2026-10-15 / 11 | 36 | 2026-10-15 12:00 | 2026-10-16 23:00 |
| 2026-10-15 / 17 | 54 | 2026-10-15 18:00 | 2026-10-17 23:00 |

The 23-cycle pair was downloaded at 03:59 UTC. The 05/11 pairs were downloaded
at 10:34 UTC; the 17 pair was retained from the same day's cycle investigation.
Hashes identify the observed bytes even if a provider URL later changes or
expires. GIF binaries remain local and are not redistributed in Git.

| Input | SHA-256 |
| --- | --- |
| [2026/10/14 / 23 / PM10](https://www.airkorea.or.kr/dustImage/2026/10/14/23/09km/AQF.20261014.NIER_09_01.PM10.2days.ani.gif) | `d2193d6812dd275537f4b91af57a37eb4405e97b51bd403418a6251163cd9135` |
| [2026/10/14 / 23 / PM2P5](https://www.airkorea.or.kr/dustImage/2026/10/14/23/09km/AQF.20261014.NIER_09_01.PM2P5.2days.ani.gif) | `26dba4f51751af5ebd3e9b74da291791a9e03d75e6802e090a5a25993380ea9b` |
| [2026/10/15 / 05 / PM10](https://www.airkorea.or.kr/dustImage/2026/10/15/05/09km/AQF.20261015.NIER_09_01.PM10.2days.ani.gif) | `e6ac7723ca92cb5168567bacea83fc4233edead6a295c73008879a5602596d34` |
| [2026/10/15 / 05 / PM2P5](https://www.airkorea.or.kr/dustImage/2026/10/15/05/09km/AQF.20261015.NIER_09_01.PM2P5.2days.ani.gif) | `5dc0f1984a4ec5077f727f7468ea5810db2f95915209c380ec8f03a4df49cc6e` |
| [2026/10/15 / 11 / PM10](https://www.airkorea.or.kr/dustImage/2026/10/15/11/09km/AQF.20261015.NIER_09_01.PM10.2days.ani.gif) | `c7eca42e87b49e4bfb3916a9930894391e31be73b931809b7702a2abbfbae4cd` |
| [2026/10/15 / 11 / PM2P5](https://www.airkorea.or.kr/dustImage/2026/10/15/11/09km/AQF.20261015.NIER_09_01.PM2P5.2days.ani.gif) | `38bf6112b0ffc5b509b7e4ad0bb3e4829c65227271ef55ab4f1b460031942c9f` |
| [2026/10/15 / 17 / PM10](https://www.airkorea.or.kr/dustImage/2026/10/15/17/09km/AQF.20261015.NIER_09_01.PM10.2days.ani.gif) | `638105c136da0df823c6cc675c2ecdb7254cfc4af8d1e0cd1b2c017bf4ee7a46` |
| [2026/10/15 / 17 / PM2P5](https://www.airkorea.or.kr/dustImage/2026/10/15/17/09km/AQF.20261015.NIER_09_01.PM2P5.2days.ani.gif) | `2fdc6c7c1e8c7ef87ccaa0b7a7554de7f6f4d8474fb95e2b7027d74e65d145a0` |

## Why the first fix rejected these images

The initial implementation independently rejected non-23 paths before decoding,
required exactly 48 decoded frames and used 48-frame loops for legend and
station extraction. Relaxing only the path or only the shape check would leave
the other rejection or truncate data. Its next-day-midnight start also mislabels
the 17-cycle start by six hours if the path restriction alone is removed.

Actual frame palettes also exceed the old per-channel rounding allowance of
four. The 17-cycle PM10 frame 5 / band 11 has `[106,106,0]` against nominal
`[100,100,0]` (difference 6); 05-cycle PM2.5 reaches difference 7. The palette
contract therefore needs a derived acceptance boundary, not only longer loops.

## Candidate behavior

[`airkoreaImageLayout`](../../../../server/lib/airkoreaImageLayout.js) accepts a
positive integer decoded frame count instead of a cycle-to-count lookup. Both
pollutants keep their own decoded lengths. Legend validation and station
extraction visit all frames. The characterized six-hour cycle schedule
05/11/17/23 supplies the first hour as cycle plus one; the path's calendar date
must match the AQF model date. UTC calendar arithmetic handles KST wall-clock
rollover without depending on the host timezone or original publication time.

The 820×820 geometry, map calibration and 36 numeric lower thresholds remain
characterized constants. Each nominal legend band has a strict, non-overlapping
RGB neighbourhood derived from half the distance to its nearest other band
using the largest per-channel difference. Every frame's band sequence must pass
that validation before its own palette is used for station colours. Ambiguous
colour matches are not assigned a concentration. Both images must validate
before station writes; separate storage upserts remain nontransactional.

The radius varies by band: its nominal maximum is 24.5 RGB levels, and the
comparison is strictly less than that radius. This is not a uniform seven-level
rounding cap. Station matching derives radii from the actual frame palette;
colour quantization can change those radii. A wider band can recognize pixels
from antialiasing or coloured overlays even when they do not represent a model
concentration. Unique nearest-band assignment does not establish numeric ground
truth. No arbitrary global colour cap was added.

These boundaries allow variable data length and observed GIF palette rounding
while rejecting unsupported geometry, invalid paths, bad legends and malformed
frame shapes. They do not infer an arbitrary future image's start time or legend
scale. See [operations](../../../operations/airkorea-image-forecast.md) for
calibration, deployment and readback requirements.

## Sampled palette comparison

A local histogram compared the old exact/±4 station-colour rule with the new
per-frame nearest-band rule on the eight hash-bound GIFs. Sampling used every
sixth frame and every second map pixel within x=77..662 / y=75..793, retaining
opaque pixels. Counts are sampled pixel occurrences, not unique colours,
stations or concentrations. This comparison isolates colour matching with the
same actual frame palette; it does not claim the old full pipeline accepted
images that its path/count/legend gates rejected.

| Cycle | Pollutant | Sampled opaque pixels | Newly matched | Old-only matches | Changed band among shared matches |
| --- | --- | --- | --- | --- | --- |
| 05 | PM10 | 738,360 | 5,682 | 0 | 0 |
| 05 | PM2.5 | 738,360 | 6,969 | 0 | 0 |
| 11 | PM10 | 632,880 | 8,186 | 0 | 0 |
| 11 | PM2.5 | 632,880 | 8,320 | 0 | 0 |
| 17 | PM10 | 949,320 | 12,211 | 0 | 0 |
| 17 | PM2.5 | 949,320 | 15,064 | 0 | 0 |
| 23 | PM10 | 843,840 | 8,984 | 0 | 0 |
| 23 | PM2.5 | 843,840 | 11,740 | 0 | 0 |

Across 6,328,800 sampled opaque pixels, 77,156 (about 1.22%) gained a match;
none lost an old match or changed bands among shared matches. Frequent newly
matched colours include `[132,188,227]` → band 34, `[99,172,235]` → band 33 and
`[107,176,236]` → band 33 (zero-based band indices). The largest sampled actual
frame-palette radius was 25, compared with the nominal maximum 24.5; both use a
strict less-than boundary. With integer RGB channels, a radius of 25 permits at
most a 24-level difference in any channel.

These results show that the rule accepts more colours than ±4. They do not
establish that every new match is a correct forecast value: antialiasing and
coloured overlays remain possible. The scan does not cover every frame or pixel,
does not classify overlay provenance and is not numeric model ground truth. The
separate full-image replay checks all frames at four city reference points.

## Verification and limits

The final isolated regression passed all **41 tests** with explicitly selected
Node 16.20.2 under `TZ=UTC` and Node 24.19.0 under
`TZ=America/Los_Angeles`. Both executions exited zero. The intended baseline had
nine failures on the old runtime. Coverage includes variable and asymmetric pollutant lengths,
a valid nonstandard 47-frame length, a one-frame image, invalid counts, every
frame's legend including the final frame, six-hour cycle dates, leap-day/year
rollover, wrong paths/model dates/pollutants, explicit calibration overrides,
unsupported geometry and missing/ambiguous colours. Observed yellow-band RGB
difference 7 is accepted; difference 8 crosses its derived boundary.

The review additions also test station-only rounding against an unchanged legend
and omission of a station pixel exactly between two legend bands. Two isolated
mutations relaxed the strict station or legend boundary to include equality;
each exited one with exactly one failed test (40 passed), confirming both
boundary assertions detect that regression. Runtime bytes are unchanged from
the first review candidate; the 17-cycle actual pair was replayed again after
the test/documentation corrections and passed with 432 stored/read rows.

Runtime-version correction: the initial 39-test companion run used bare `node`
and did not record `process.version` at execution time. A subsequent inventory
in the same worktree resolved bare `node` to `/opt/homebrew/bin/node`, version
20.20.2. This does not directly measure the earlier process; its original Node
24 label is unverified and is not accepted as Node 24 evidence. The original
receipt is retained with this correction. A subsequent explicitly selected Node
24.19.0 run passed the unchanged 39-test review snapshot, and the final pinned
run passed 41 tests. These separate executions establish Node 24 verification
without relabelling the earlier run.

The actual `get-pixels` decoder, image/hourly controllers and AQI computation
replayed all eight hash-bound files through isolated memory storage and readback.
The four reference points are Seoul, Daejeon, Busan and Jeju. Each replay checked
each pollutant's complete decoded count, first and final KST text, first BSON UTC
instant, and finite nonnegative concentrations. No production database or gather
route was invoked.

| Cycle | Frames per pollutant/reference point | Stored/read rows | First UTC instant | Replay timezone | Result |
| --- | --- | --- | --- | --- | --- |
| 05 | 42 | 336 | 2026-10-14T21:00:00Z | Asia/Seoul | PASS |
| 11 | 36 | 288 | 2026-10-15T03:00:00Z | UTC | PASS |
| 17 | 54 | 432 | 2026-10-15T09:00:00Z | Asia/Seoul | PASS |
| 23 | 48 | 384 | 2026-10-14T15:00:00Z | UTC | PASS |

The total is **1,440 stored/read rows**, with no 48-frame truncation. Replay uses
Node 16 and manifests whose count/start/end expectations come from the inspected
files and timestamp labels. Reproduction commands and manifest fields are in the
[test guide](../../../../server/test/offline/README.md#airkorea-image-hourly-forecasts-2756).
The lower-threshold values are checked for validity, not against independent
numeric model ground truth.

All four current manifests supply independently inspected `expectedFrames`,
`expectedStart` and `expectedEnd`. Legacy manifests can omit the count/end fields:
the smoke then uses the decoded length as its expected count and does not assert
a final label. Such a fallback proves decode/store/read coherence and the start
hour, not an independently characterized count or final hour.

The updated collection diagram passed Archify showcase validation, deterministic
delivery, strict provenance checking and automated browser checks. Light/dark
captures at 1440×900 and 2048×1320 were inspected: the main diagram has readable
nodes and relationship labels with no observed overlap. Detail cards continue
below the viewport through document scrolling; not every offscreen card line
was manually inspected. The initial sandbox Chrome pipe failure and a later
macOS display/timeout capture failure were environmental; the unchanged artifact
passed the subsequent browser and capture runs. Local Markdown links and
`git diff --check` passed. Raw runs, manifests and captures remain under ignored
reports; the maintained conclusions and input hashes above do not depend on
those local files.

The original-publication acquisition timeout is a separate fetch failure; this
candidate does not claim to repair it. Quantized lower thresholds and inherited
rectangular geographic calibration remain approximate. No provider projection
certification, API/device recovery, production rollout or production readback
is established by local replay. The collection diagram retains its pinned
baseline topology citations; its #2756 card is explicitly a candidate overlay.
