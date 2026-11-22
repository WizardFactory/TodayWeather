# Native Daily chart text reuse on iPhone, 19 November 2026

The Daily forecast Canvas builds weekday and date headers and renders temperature, precipitation and probability labels on each redraw. Reusing Core Text lines and measured header ascents reduced median draw time by about 8 ms per draw on a Seoul forecast. Each live chart owns its own 256-entry FIFO cache. Text, run order, size and foreground color determine reuse.

## Device comparison

A development-signed arm64 Release build based on the Hourly candidate at `b4ef2b18` switched between the original and cached Daily paths on the same iPhone 12 Pro Max running iOS 26.0.1. All batches used Xcode 27.2, Korean text, a separate fixture app identifier and a 324,517-byte Seoul response containing 17 daily records. The response SHA-256 was `1945adf31948ff8dfbd4aba283d597f1a6a8d1ca802d5f4e518fcb31b974c088`. A1/B1/B2/A2 reversed the change in a single binary. Two further batches exercised the production chart sources with the same fixture and timing probe.

Each batch opened Daily, rehearsed one left/right pair and measured ten pairs. The test checked the selected tab, city, chart visibility and movement in both directions. The device clock timed full content Canvas draws contained within each swipe. Median and p95 describe individual draws. OS hitch counts describe whole pairs, including drag and deceleration.

| Build and batch | Measured draws | Median draw | p95 draw | Pairs with an OS hitch | Total OS hitch time |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original A1 | 100 | 9.58 ms | 11.31 ms | 0/10 | 0.00 ms |
| Cache experiment B1 | 100 | 1.46 ms | 1.65 ms | 0/10 | 0.00 ms |
| Cache experiment B2 | 100 | 1.41 ms | 1.52 ms | 0/10 | 0.00 ms |
| Original A2 | 100 | 9.54 ms | 10.91 ms | 1/10 | 16.69 ms |
| Product B1 | 100 | 1.29 ms | 1.61 ms | 0/10 | 0.00 ms |
| Product B2 | 100 | 1.28 ms | 1.55 ms | 0/10 | 0.00 ms |

The four experimental batches and two product batches produced byte-identical opening-chart PNGs. The 40-pair experiment recorded one 16.69 ms hitch on the original path and zero on the cached path. The sample supports a reduction in rendering cost. The change in the frequency of visible hitches remains inconclusive. [Per-pair OS metrics](daily-text-trials.csv) · [Measured draw durations](daily-text-draws.csv)

A separate Release run on `master` at `b3b31011` measured the original Daily chart and the parent page with pull-to-refresh. The 60 Hz phone reported horizontal motion during both drag and deceleration for all 80 measured gestures across two walks. The longest moving main-thread display callback was 16.680 ms during drag and 16.813 ms during deceleration. In two further ten-pair batches, separate XCTest drag and deceleration metrics each recorded zero hitches. Instruments could not sustain a Daily display-swap trace, so the maximum displayed-frame interval remains unknown.
