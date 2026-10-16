# S18b-3 actual legacy warning oracle

Baseline: `82356a95d71f6c6a33b21bfc16e58ca47972b4a6`, pinned Node16.20.2,
TZ=UTC, fixed clock2026-10-16T01:02:00Z. Recorder:
`server2/tools/push/record_warnings.js` (offline only). Two independent recorder
executions produced identical JSON; gzip uses mtime0. Synthetic device/zone/state
inputs only; no real credentials, provider request or push submission.

Actual Feed, Engine.pollWarnings/eligible, registry.inside, runtime.warning and
transport.send source executed. Unused runtime Controller constructors and weather
source were replaced because node-gcm is absent; warning implementation itself is
unchanged. HTTP is a recording EventEmitter, not a network provider. Expectations
come from actual source execution, not the Rust implementation.

Coverage:13 feed series,108 localized/type/stress messages,10 published-date
conversions,13 grouping cases,50 eligible-window cases and exact urgent HTTPv1
message envelope. The serialized source maps include hashes of every directly
executed legacy module and zone data:

- `server/lib/pushCoordinator/warningFeed.js`: `5459388931daddc5277acdf5e7ea853d6b278f424543e41cedff14a7a545af1e`
- `server/lib/pushCoordinator/registry.js`: `e0df8d45ae891053d50bc98282126a035422ceb56c4c01827f83cbf20ae0ee16`
- `server/lib/pushCoordinator/engine.js`: `c9854caea60cab4a8058373e0776684518039215bf48eff9aeef33dfc79018c5`
- `server/lib/pushCoordinator/runtime.js`: `2824a01589ec932279378f65d3338c99dbac55833216912d7ef4a5de22a9fb8e`
- `server/lib/pushCoordinator/transport.js`: `566f2aa40e589d20ac48a41c37f1fde66e84eef4095b8368af428c9449e5b361`
- `server/lib/kmaWarningZones.js`: `b10f42aec4d4a77b0b2a8017f0c1688a95e82702345752d41ebd1682d0cf059f`
- `server/utils/data/kma_warning_zones.csv`: `c796c7d22d3c336b8d21172998b54788c6cf46c0c1df34ec6a66810421074ed2`

Fixture SHA256: `74b0994ca31c3efbe6e0fb78a05c97ea02cf401d783d2ac73e575876dddac210`.
