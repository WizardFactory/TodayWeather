# Forecast cache retention verification (#2850)

Date: 2026-10-22 KST. Base `307defeb706886217ab67ea858dc7c7b0435752f`, dependent on open PR #2841. Runtime/test/tool/declaration candidate `sha256:afffa182a520e1eb46d69cfa242e7e3dd303e198dd46182f0c5da51b3c77abc9`. Maintained docs are assessed separately. Local Darwin ARM64, Rust 1.99.0 release; this is not an EC2 or live S3 measurement.

Copied executable SHA-256 `0b352babf3efd6273b1e9e5c773da3bee3ec1d5fe07786ebfbe4ec75184b661b`; runner `9074092d251389c2a24a700b23a3baa8ce2ab476ee5aaa7522dc1bf3aa51b1c9`. Fixture manifest remains `11606b79c26365e4ba8a5a906d5801f717845f853bafc971c2f099d27b7bbe3f`; input identity digest `a83f63716e6b73c997c6ded2cca81e23c50e97b770408f0c2580a7d2241c4a00`. No runtime verification flag or dependency was added.

## Actual behavior evidence

- Per-key writer test first failed (exit 101, unrelated Current entry count 0 instead of 1), then passed after scoped fences. Current views for two towns stay pinned and returned with zero raw/parse/fold while RSS acquisition runs; actual future abort and panic both retire its fence. A held pre-write build cannot return/install across the write. Registry capacity and live identity retention are checked.
- Boundary test first failed (exit 101 at arbitrary minute), then passed for reuse through the exact next Current publication. Fixed-clock checks cover RSS, inclusive oldest-partition removal, KST month/day, future-fetched equality and rewind. All13 full-window goldens match before and after minute renewal; advancing three hours matches independent pure replay for all 13, with only the four time-dependent grid/RSS views refolded.
- Identity renewal test first failed (exit 101: no authoritative LIST), then passed with real control reads and zero raw/descriptor GET, parse or fold. Existing-partition external publication appears on the first request at 30 seconds, remaining absent before that bound. Failed LIST cannot renew.
- Restart test first failed (exit 101: one parse instead of zero), then passed with a fresh Source and disk owner. Smaller-than-working-set memory eviction also restores without raw/parse/fold. Hash damage, truncation, valid-container wrong key/revision/identity, external S3 identity change and a lowered cap rebuild byte-identical source Docs; over-cap files are evicted. Bounded codec tests preserve NaN payload, signed zero, infinity, undefined and property order and reject oversized declared growth.

The broader first peer run passed 8/9: its new external-write assertion looked for t1h at the Doc root; source stores it under currentData. The response had changed as required. The corrected assertion and unchanged implementation passed 9/9 in release. Earlier Cargo PATH/rustup sync, Python cache and test-module qualification errors are environment/compile failures, not intended Red.

## Retained 13-view measurements

| View | Serialized bytes | Restore ms |
| --- | ---: | ---: |
| `Grid(Current, 60, 127)` | 326,745 | 24.173 |
| `Grid(Shortest, 60, 127)` | 11,106,559 | 44.917 |
| `Grid(Short, 60, 127)` | 21,122,472 | 51.488 |
| `Rss(60, 127)` | 662,043 | 11.884 |
| `Mid(Forecast, "109")` | 1,618 | 0.984 |
| `Mid(Land, "11B00000")` | 3,849 | 1.157 |
| `Mid(Temp, "11B10101")` | 2,511 | 1.023 |
| `Mid(Forecast, "159")` | 1,618 | 1.038 |
| `Mid(Land, "11H20000")` | 3,849 | 1.156 |
| `Mid(Temp, "11H20201")` | 2,511 | 1.030 |
| `Mid(Forecast, "156")` | 1,618 | 1.054 |
| `Mid(Land, "11F20000")` | 3,849 | 1.108 |
| `Mid(Temp, "11F20501")` | 3,072 | 1.320 |

Total serialized payload: **33,242,314 bytes (31.70 MiB)**. Sequential restoration including hash/decode and authoritative controls: **142.333 ms**. Renewal after an arbitrary minute: **77.416 ms**. Both phases make **14 LIST + 725 catalog GET**, **0 descriptor GET / 0 raw GET / 0 raw parse / 0 fold** across the 13 views. This is an explicit control-request cost, not an ETag-only LIST check.

The13-view working set weighs 36,552,928 logical bytes; adding the one shared 1 MiB metadata reservation gives 37,601,504 bytes. Using the issue's13-view working set as one town for estimation, the 128 MiB memory limit holds **3 towns** after reserving metadata. These are logical capacities, not heap/RSS. The corpus includes nine mid views covering three regions; real towns can share region views.

With the current container header and 4 KiB allocation rounding, these view payloads require 33,259,520 bytes: an 8 GiB cap has an estimated ceiling of **258 such towns if reserved entirely for views**. The actual fill observed 37,007,360 allocated bytes across 826 files (13 views and 813 opportunistically retained raw objects); repeating that observed mix gives **232 towns**. These are capacity estimates from one workload, not a multi-town saturation test or guarantee: other datasets, incomplete raw-cache admission, retained namespaces, temporary reservations and concurrent pinned readers reduce available capacity. The root-wide configured cap remains enforced.

## Separate native HTTP smoke

| Fresh Source | Phase | HTTP | Elapsed ms | Bytes |
| --- | --- | ---: | ---: | ---: |
| Memory empty / no SSD | cold | 200 | 1817.394 | 42,549 |
| Memory empty / no SSD | warm1 | 200 | 16.148 | 42,549 |
| Memory empty / no SSD | warm2 | 200 | 15.841 | 42,549 |
| SSD configured | cold | 200 | 275.282 | 42,549 |
| SSD configured | warm1 | 200 | 15.257 | 42,549 |
| SSD configured | warm2 | 200 | 15.115 | 42,549 |

All six bodies equal the original HTTP reference SHA-256 `a6462aba8ad9ec34d8efdcab4ccd2f37b00339a301fd17caa7c1e5485d45b283`. Both fresh Sources use normal Gateway -> DirectRoutes -> KmaBackend with the unchanged 3-second request ceiling. The SSD Source restores all seven used keys with zero forecast raw/descriptor GET, parse and fold. Neither HTTP Source is primed in memory by diagnostics.

All six owned runner children exited 0 and the peer/listeners retired. Source input hashes were unchanged during execution. The original supporting zone fixture remains invalid (numOfRows 999 versus required 1000) and its repeated control/raw reads stay separately visible; no valid-zone recovery is claimed. Cold requests still invoke 196 denied observation stubs (194 web, 2 ASOS), warm adds 0. External provider/geocoder calls are 0.

## Reproduction and limits

Use the commands in the [operator guide](../../../operations/server2-domestic-cache.md), including `seed diagnostic http disk http-disk disk-boundary` on a copied release executable. `server2/tools/test_domestic_warm_cache_smoke.py` has 7 passing pure checks, including rejection of raw/descriptor/parse/fold in restore/renew while allowing control reads. The local placement gate passes the [task declaration](../../../../server2/config/tasks/ForecastRetention2850.json) against the exact base. Full current final check counts and independent review/CI readiness are recorded in the authorized PR; this selected record precedes that review.

Archify proposed workflow passed artifact validation/delivery/strict check and actual Chrome browser checks. Light 1440 and dark 2048 captures were visually inspected: no clipped nodes/labels or text collisions; long fallback routing remains visible. Original-source hook citations are frozen at the dependency revision and are explicitly design evidence. Generated sidecars/captures/recovery metadata stay ignored locally.

No live S3/provider request, deployment, shadow traffic, host performance/capacity qualification, mobile build or merge is claimed. S3 identities remain authoritative; disk loss/schema mismatch is a normal miss. No source or dependency path outside the declared server2 ownership was introduced.


Current additional checks: 15 focused library tests, 8 shared DiskCache fault/ownership
regressions, 9 cache/source integration tests and 10 S16 summary integrations passed.
All-target Clippy with warnings denied, fmt, 7 Python checker controls and the local
placement gate passed. The S16 suite includes the request's own stored acquisition
identity, complete-current-fold settlement and rejection of partial/failed reads.
