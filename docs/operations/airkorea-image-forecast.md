# AirKorea image hourly forecasts (#2756)

## Status and supported input

On 2026-10-15, read-only gather inspection found an active worker repeatedly
rejecting 820×820 images against its private 820×830 setting. Original forecasts
were current but `arpltnhourlyforecasts` contained zero rows. The original investigation did not change production configuration or code.
The follow-up issue comment reports deployment of PR #2757 and continued
17-cycle rejection; this later production state was not independently rechecked.
The variable-frame candidate has local verification only. See [initial evidence](../evidence/tasks/issue-2756/verification.md)
and [follow-up characterization](../evidence/tasks/issue-2756/variable-frames.md).

The decoder supports the characterized NIER 09km PM10/PM2P5
`2days.ani.gif`: an 820×820 RGBA canvas and the checked 36-band legend.
Frame count comes from each decoded pollutant image. It must be a positive
integer, but is not fixed at 48, inferred from the cycle or shared between
pollutants. Every decoded frame is validated and processed without truncation.

Image paths must use the characterized six-hour cycle schedule (05, 11, 17, 23),
with matching directory and AQF model dates and the expected pollutant. The first
frame starts one hour after the path's cycle in KST; each later frame advances
one hour. UTC calendar arithmetic carries the KST wall-clock fields across day,
month and year boundaries, independently of the host timezone. Original
publication time does not replace this image-derived start.

Actual PM10 and PM2.5 inputs characterized on 2026-10-15 have the following
ranges. These counts describe those files, not a fixed cycle-to-count table.

| Image date / cycle | Frames per pollutant | First → last label (KST) |
| --- | --- | --- |
| 2026-10-14 / 23 | 48 | Oct 15 00:00 → Oct 16 23:00 |
| 2026-10-15 / 05 | 42 | Oct 15 06:00 → Oct 16 23:00 |
| 2026-10-15 / 11 | 36 | Oct 15 12:00 → Oct 16 23:00 |
| 2026-10-15 / 17 | 54 | Oct 15 18:00 → Oct 17 23:00 |

Every frame's legend must retain the characterized band order. RGB rounding is
accepted only when a colour is uniquely inside a band's non-overlapping
neighbourhood: its largest per-channel difference must be strictly less than
half the distance to that band's nearest neighbour. This derives the boundary
from palette spacing rather than a fixed four-level allowance. Station pixels
are matched against that frame's validated palette, searching the center before
nearby pixels up to three pixels away. Ambiguous or unmatched pixels omit the
value; a malformed legend rejects the image pair before station writes.

The boundary varies by band; it is not a uniform ±4 or ±7.5 RGB allowance.
The nominal legend's largest neighbourhood radius is 24.5, with a strict
less-than comparison. Station matching recomputes the radius from each actual
frame's palette; the sampled files reach a strict radius of 25. Its bound can
vary with GIF rounding. Wider neighbourhoods
can accept antialiased pixels or coloured overlays as a concentration band.
They establish a unique colour match, not independent numeric model accuracy.
The [sampled palette comparison](../evidence/tasks/issue-2756/variable-frames.md#sampled-palette-comparison)
records the observed effect and its limits.

Values are quantized **lower thresholds** of the displayed 36-band legend; the
top band is capped at its lowest labelled threshold and the bottom band is zero.
These estimates can understate a concentration within a band and are not exact
model values. See the [variable-frame characterization](../evidence/tasks/issue-2756/variable-frames.md)
for input hashes, the prior fixed-frame failure and verification limits.

Both PM10 and PM2.5 paths are required for each collection attempt. A missing or
invalid path rejects the pair before station writes, so even the available
pollutant has a coverage gap until a later scheduled attempt has both supported
images. This deliberately replaces the old missing-path partial collection.
Existing stored rows are retained; this does not make separate Mongo upserts
transactional or guarantee rollback after a storage failure.

## Calibration

Map and geographic `AIRKOREA_KOREA_IMAGE_*` overrides are honored and validated.
Size overrides must equal the characterized 820×820 canvas; another size fails
closed even if the image matches the override. A new canvas needs decoder and
legend recharacterization, not just a size setting.
The repository defaults are:

| Suffix | Default |
| --- | --- |
| `SIZE_WIDTH` / `SIZE_HEIGHT` | `820` / `820` |
| `MAP_LEFT` / `MAP_RIGHT` | `77` / `663` (right exclusive) |
| `MAP_TOP` / `MAP_BOTTOM` | `75` / `794` (bottom exclusive) |
| `COORDI_TOP_LAT` / `COORDI_BOTTOM_LAT` | `39.3769` / `32.6942` |
| `COORDI_LEFT_LON` / `COORDI_RIGHT_LON` | `123.9523` / `130.6741` |

The geographic box is inherited from the observed deployed decoder; it remains
an approximate rectangular projection. Four city reference points produced
recognized colours in every frame of all eight characterized GIFs (1,440
stored/read rows). This does not certify the provider's
coordinate system or exact station/model alignment. Map bounds are characterized
from the current raster. A label-only legend change cannot be discovered through
colour checks alone; recharacterize any provider format/scale change.

AirKorea `dataTime`/`pubDate` keep their existing KST display strings. New BSON
`date` values represent those KST hours as UTC instants; the KAQ writer is unchanged.
No migration or deletion of existing production rows is part of this fix.

## Local verification

Use the isolated regression and local-GIF smoke documented in the
[test guide](../../server/test/offline/README.md#airkorea-image-hourly-forecasts-2756).
Capture SHA-256 and public URL for each local GIF and inspect first/last frame
labels. Replay all four characterized cycles with both pollutants and verify
that each pollutant keeps its own decoded length and expected final hour. A PASS
proves local decoding/storage/readback, not scheduled production
collection, public API delivery or a device display.

Current characterization manifests supply `expectedFrames`, `expectedStart`
and `expectedEnd` independently from the inspected image. A legacy manifest
without `expectedFrames` falls back to the decoded count; without `expectedEnd`
it omits the final-label assertion. That fallback checks decode/readback
coherence and the start hour, not an independent count or final hour. Do not use
it as equivalent evidence for a new cycle.

## Authorized rollout and readback

After a separately authorized deployment, reconcile the operator's private
`config/config.js` as well as the checked-in code. In particular its hardcoded
height `830` must be replaced or explicitly overridden with
`AIRKOREA_KOREA_IMAGE_SIZE_HEIGHT=820`. Reconcile all map defaults in the table;
copying only the parser/controller preserves the wrong private calibration.
Deploy `lib/airkoreaImageLayout.js`, the image parser/controllers and config
together. Preserve existing credentials and unrelated private settings.

Observe the next scheduled `kecoForecast` job; never trigger `/gather/*` as a health
probe. Read image-specific errors and inspect new `arpltnhourlyforecasts` rows:
both pollutant codes, expected publication, each image's complete time range,
finite nonnegative values, correct KST text and corresponding UTC dates, and
representative station coverage. Compare the first and final hours against the
actual image labels rather than assuming 48 rows. Check image decoding separately
from original-forecast acquisition: a provider timeout before images are obtained
is a separate failure and is not repaired by variable frame handling.
Read a coordinate request with `airForecastSource=airkorea` and check the actual
hourly response. The shared app sends `airForecastSource=kaq`, so AirKorea recovery
alone does not change its default; KAQ recovery/source selection is outside #2756.

Rollback the exact prior code and private calibration through the existing
release procedure. Preserve Mongo rows and credentials; do not automatically
delete or rewrite production forecasts. Invalid new images must not yield new
forecast upserts. Record unsupported cycles and missing station colours as gaps.
