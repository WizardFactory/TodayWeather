# Native Hourly chart text reuse on iPhone, 18 November 2026

Eight hitches in the moving phases of the Hourly chart on an iPhone 12 Pro Max each included repeated Core Text line construction or font measurement on the main thread. The median app update took 20.26 ms, over the 16.67 ms period of the 60 Hz display. For each affected frame, the nearest preceding completed non-hitch update in the same gesture and phase took a median of 1.98 ms. Median GPU times were 0.71 and 0.66 ms. The Instruments Animation Hitches pass covered 40 horizontal gestures and 40 vertical controls on the 2.0.0 (1) baseline. Eight hitches affected six horizontal gestures. No app-attributed hitch started during the vertical controls. [Eight frame pairs and running main-thread samples](chart-cause-frames.csv)

The scrolling Hourly Canvas now retains up to 256 lines per live view, using the ordered strings, font sizes and foreground color as the key. Repeated headers also reuse the measured ascent, including fallback-font metrics. The cache evicts the oldest insertion on overflow.

## Candidate verification

Two development-signed arm64 Release builds used the same local weather fixture, profile app ID, timing probe and test driver. The baseline was master at `4afc6d2a`. The candidate differed by the three production chart files in this change. Each used the same iPhone 12 Pro Max on iOS 26.0.1, Xcode 27.2, default Large text and a seeded Seoul forecast. The 324,517-byte response included 41 short forecast rows and 18 air stations. Its SHA-256 was `1945adf31948ff8dfbd4aba283d597f1a6a8d1ca802d5f4e518fcb31b974c088`.

Each batch opened Hourly, rehearsed one left/right pair, then performed ten measured pairs. Each pair required a changed chart image in both directions and the same selected city. The device monotonic clock timed the scrolling content Canvas closure, counting draws that started and finished within each swipe. XCTest supplied the OS hitch count and frame rate for each pair. A1/A2 used the original binary, B1/B2 the candidate. The draw percentiles cover individual draws, and the hitch counts cover pairs.

| Batch in execution order | Content draws | Median draw (ms) | p95 draw (ms) | Pairs with an OS hitch |
| --- | ---: | ---: | ---: | ---: |
| A1 | 101 | 11.30 | 14.64 | 3/10 |
| B1 | 100 | 2.39 | 2.93 | 0/10 |
| B2 | 99 | 2.41 | 3.02 | 0/10 |
| A2 | 100 | 11.12 | 13.32 | 1/10 |

The median content draw fell in both candidate batches and increased again on returning to the original binary. These four runs measure the CPU reduction for this specific fixture and device. Hitch counts vary between batches and do not establish a shipping incidence rate. [Per-pair OS metrics](hourly-product-trials.csv) · [Individual draw durations](hourly-product-draws.csv)

The Release simulator run passed the cache key and eviction tests, chart reference-image checks at three sizes, initial scroll positioning, weather re-apply and expansion. The native device walk additionally captured the chart at opening, after the first forward gesture and after its return.

All four opening-chart PNGs were byte-identical. The stopping offset of a synthetic fling can vary, so the displaced captures check visible movement and are not treated as full-image equality at a fixed scroll offset.
