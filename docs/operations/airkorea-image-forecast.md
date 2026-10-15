# AirKorea image hourly forecasts (#2756)

## Status and supported input

On 2026-10-15, read-only gather inspection found an active worker repeatedly
rejecting 820×820 images against its private 820×830 setting. Original forecasts
were current but `arpltnhourlyforecasts` contained zero rows. The repository fix
has local verification only; production configuration and code were not changed.
See [evidence](../evidence/tasks/issue-2756/verification.md).

The decoder supports the characterized NIER 09km PM10/PM2P5
`2days.ani.gif`: an 820×820 RGBA canvas, 48 frames and the checked 36-band legend.
Only the observed `/dustImage/YYYY/MM/DD/23/09km/AQF.YYYYMMDD...` cycle is accepted;
its first frame is next-day 00:00 KST. A later original publication can reuse that
animation without changing its frame dates. Other cycles (including 11) fail
closed until first/last frame labels and geometry are characterized. A probe of
the candidate 11-cycle URL returned a redirect, not a validated animation.

Every frame's legend must match the characterized sequence within four RGB
levels per channel (current PM10 frame 14 contains a four-level palette change).
Station pixels use exact matches, then the same bounded rounding allowance,
searching the center before nearby pixels up to three pixels away. Unmatched
frames omit the value. Values are quantized **lower thresholds** of the displayed
legend; the top band is capped at its lowest labelled threshold and the bottom
band is zero. These estimates can understate a concentration within a band and
are not exact model values.

## Calibration

All `AIRKOREA_KOREA_IMAGE_*` environment overrides remain supported and validated.
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
recognized colours in all 48 frames, but that does not certify the provider's
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
labels. A PASS proves local decoding/storage/readback, not scheduled production
collection, public API delivery or a device display.

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
both pollutant codes, expected publication, finite nonnegative values, correct
KST text and corresponding UTC dates, and representative station coverage.
Read a coordinate request with `airForecastSource=airkorea` and check the actual
hourly response. The shared app sends `airForecastSource=kaq`, so AirKorea recovery
alone does not change its default; KAQ recovery/source selection is outside #2756.

Rollback the exact prior code and private calibration through the existing
release procedure. Preserve Mongo rows and credentials; do not automatically
delete or rewrite production forecasts. Invalid new images must not yield new
forecast upserts. Record unsupported cycles and missing station colours as gaps.
