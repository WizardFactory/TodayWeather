# AirKorea GIF contract (#2756)

## Supported input and response

Characterized input: NIER 09km PM10/PM2P5 `2days.ani.gif`, 820×820 canvas, 48 hourly RGBA frames. Current map interior is x=77..662 and y=75..793 (right/bottom exclusive 663/794). Preserve the observed deployed geographic box (north 39.3769, south 32.6942, west 123.9523, east 130.6741); it remains an approximate rectangular projection, not a newly certified geodetic transform. Explicit size/map/geographic environment variables override defaults and are validated.

Validate the complete frame shape, dimensions, geographic/map extents and the 36-band legend before deriving or writing any station values. Sample each frame's legend at x=680, y=74..774 against the characterized colour sequence with at most four RGB levels of palette rounding per channel. Use the actual frame colours for station matching; only a match within the same four-level quantization bound is accepted; unknown pixels remain missing, never negative sentinels or arbitrary nearest-colour matches. Numeric estimates use the legend's lower thresholds; the top band is capped at its lowest labelled threshold and the bottom band starts at zero. These are quantized image estimates, not exact model concentrations.

Frame dates come from the image's characterized `dustImage/YYYY/MM/DD/23/09km/` path: frames start at the next date's 00:00 KST; its AQF model date must match the directory date. This handles original publications reusing an earlier animation. Reject uncharacterized cycles (including 11), invalid paths/dates/pollutant mismatch; never base forecast dates on wall clock. Keep `dataTime` and `pubDate` display formats; AirKorea stored BSON dates must represent KST hours as UTC instants. The shared KAQ writer is unchanged.

## Failure and coexistence

Unknown canvas, frame count, legend or invalid configured geometry fails before station writes. No auto-resize, arbitrary colour approximation, or silent environment override. A missing station colour in a valid frame omits that frame's value. Existing source selection and station-keyed schema remain unchanged. The operator's private config must be reconciled on rollout; repository defaults alone do not override its 830-pixel height.

## Verification

Regress the production rejection; test explicit overrides, unsupported/malformed images, altered legends, unknown station pixels, month rollover, clock/time-zone independence and finite values. Exercise real decoder and production controller methods with isolated memory storage and public current GIF replay. No application startup or production write is part of verification. [Plan](../plans/issue-2756.md).
