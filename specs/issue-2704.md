Task: issue-2704-s19; owner: S19 builder (Claude); revision/base: ca8735cf937a634e7af57396d605e26db8bfc4ff; date: 2026-10-13.
Authority: AK authorized S19 (#2704) on 2026-10-13; endpoint pre-merge.
Criteria: SMOKE, METRICS, REPLAY, ROLLBACK, PLACEMENT.

# Specification

Intent: [S19](../intent/issue-2704.md). Paths: [S19 declaration](../server2/config/tasks/S19.json).

## Family-pluggable tooling

`server2/tools/shadow/` holds one shared harness and one module per ready family. `families.py` lists ready families (`gateway` only). A family module exposes `SCENARIOS`, `smoke()`, `REPLAY_FIXTURE`, `REPLAY_LIMITATIONS`, `replay_side()`, `oracle_cases()` and `rollback()`. The generic CLIs are `smoke.py`, `replay.py` and `rollback.py`. `server2/deploy/smoke.sh` runs, in order: the reused foundation smoke (`tools/smoke.py`) and S10 smoke (`tools/gateway_smoke.py`), unless `--skip-reused`; the family scenarios; paired replay with `--self-check`; and the rollback rehearsal. JSON reports go to an ignored `reports/` directory.

The harness accepts only `http://127.0.0.1:<port>` targets. It starts the release binary with a restricted environment (`PATH` from `os.defpath`, dummy keys, ephemeral listeners) and never reads an operator `.env`. The peers are task-owned loopback listeners: recorded providers, a frozen legacy origin and the S03 local S3-compatible peer (`server2/deploy/local/peer.py`), which is wrapped to count every received request.

## Metrics hook (additive)

`server2/src/gateway/metrics.rs` holds process-wide relaxed atomics, which are appended to the existing loopback `/internal/metrics` text. They never contain a path, coordinate, address, locale, key or provider text. Behavior and response bytes are unchanged.

| Name (prefix `server2_`) | Meaning |
| --- | --- |
| `gateway_requests_total` | Requests entering `Gateway::handle` |
| `gateway_responses_{ok,not_modified,client_error,dependency_error,unavailable}_total` | Completed response by status class: 2xx, 304, 4xx, 503, other 5xx |
| `gateway_abandoned_total` | The waiter disappeared before a response was produced |
| `gateway_owned_inflight` | Spawned owners whose work has not ended (gauge) |
| `gateway_backend_attempts_total`, `gateway_legacy_geocode_attempts_total` | Legacy HTTP attempts |
| `geocoder_{cache_hits,joined,flights}_total` | RAM hits, waiters joining a flight, owned acquisitions |
| `geocoder_{kakao,google}_attempts_total` | Provider HTTP attempts |
| `geocoder_{quota,capacity}_rejections_total` | Fail-closed reservation and owner-capacity rejections |

## Gateway family scenarios (`smoke.py`)

Each scenario asserts process-metric deltas and peer counters, and the S3 peer must receive zero requests.

- GW-COLD-WARM: cold weather = one flight, one Kakao call, one backend hop; warm weather and geocode = RAM hits, no provider work, byte-identical body/ETag.
- GW-EMPTY-RESTORE: each restart re-acquires one reverse and one address lookup. Nothing is published to S3, because precise results are RAM-only and `S3AddressStore` is not wired (S10a decides).
- GW-SINGLE-FLIGHT: 16 same-key cold callers produce one flight and one Kakao call; the other 15 join or hit.
- GW-CANCEL: a disconnected initiator does not cancel or duplicate owned lookup/backend work; a later waiter joins; owned inflight returns to 0.
- GW-OUTAGE: a provider HTTP 500 gives 501 no-store with one attempt per key, and the failure is not cached. A backend 500 gives exactly three attempts and 501. An S3 outage has no gateway impact. An unreachable legacy origin fails fast in both modes; native mode still serves geocode.
- GW-BUDGET: 16 Kakao keys plus Google reserve 17 units per Korean lookup against the fixed 10,000-unit mock quota. Exactly 588 lookups succeed and the next fails closed with no provider request. Warm keys still serve after exhaustion. RSS growth stays below 64 MiB.
- GW-PRESSURE: 48 concurrent slow requests produce 40 successes and 8 responses of 503 with `Retry-After: 5` and no-store; rejected requests do no work.
- GW-DRAIN: on SIGTERM during an in-flight request, the request completes with 200, the process exits 0 within the 5s drain, and no retry occurs.

Partial group publication, publication hashes, and summary/state cases need S3 publication, which the gateway family does not perform. They belong to the S13/S11/S12/S14+ family modules.

## Paired replay (`replay.py`)

The workload fixture `server2/tests/integration/fixtures/gateway-replay.json` contains 15 requests: aliases, versions, locales, HEAD, conditional, OPTIONS and error routes. The fixture also holds frozen legacy geocode replies derived from S02 records, which a test checks, plus provider fixture selectors, S02 backend record IDs and declared differences.

- Baseline: the release binary with `SERVER2_GEOCODER_MODE=legacy` against the frozen legacy origin. Candidate: `mock` (native geocoder) against the recorded providers and the same backend.
- Each side runs a fresh process: a cold pass, then a warm pass. The comparator checks status, body bytes, all headers and hops. Only declared header names (`D-TRANSPORT`: date/connection/keep-alive) and declared geocoder acquisition kinds (`D-ACQ-GEOCODER` for the cold pass, `D-ACQ-WARM-CACHE` for the warm pass) may differ. A difference in backend hops is always unexplained.
- Requests that name an S02 case also compare status, body and recorded headers (except transport) with the legacy record.
- `--self-check` reruns a perturbed baseline and must detect unexplained differences. This proves that the comparator is not vacuous.
- The report records the revision (commit and dirty flag), binary SHA-256, workload path/SHA-256/count, the cold and warm nearest-rank p50/p95/p99/max per side, acquisitions, metrics, declared and unexplained differences, oracle results and limitations. The command exits 1 on any unexplained difference or oracle mismatch.

## Cache-aware rollback rehearsal (`rollback.py`)

The rehearsal runs legacy -> mock -> legacy restarts against the same legacy origin. Each process has one geocoder mode, so `/weather` and `/geocode` switch as a unit. In each phase it checks:

- Cache-Control: weather `max-age=300`; geocode `max-age=2592000`; errors `no-store`.
- Geocoder source: every route uses the legacy geocoder in legacy phases, and none does in the native phase.
- Empty-memory re-acquisition cost: cold and warm peer deltas.
- An ETag from the previous phase revalidates with 304 when the bodies are identical.
- Deadlines, probed with `SERVER2_CONNECTION_SECONDS=12`: a stalled backend gives 501 no-store at about 9s after three attempts. A stalled Kakao call gives 501 at about 3s; a stalled legacy geocoder gives 501 at about 5s.

Known gap S19-GAP-1 is pinned strictly. With the default `SERVER2_CONNECTION_SECONDS=9`, the foundation connection lifetime closes the socket at about 9s, before the deadline 501 is written (`abandoned_total` +1). The rehearsal fails if this observation changes, so a fix must update the pin. The fix is an open decision (see plan).

## Safety and failure behavior

There is no live provider, AWS, deployment or mirroring. Every child process and peer is stopped in `finally` blocks. Assertion failures exit nonzero and record a `FAIL` verdict. Reports contain only fixture places, aggregate counters and hashes.

## Alternatives rejected

- A process quota environment knob for exhaustion: it would change runtime configuration. Multiple dummy keys reach exhaustion with the existing fixed mock quota.
- Per-instance metrics plumbed through `Gateway`/`Geocoder` constructors: that is a wider API change. Global aggregate atomics suit one gateway per process.
- Masking S19-GAP-1 by raising the lifetime everywhere: that would hide a default-configuration contract violation.
- Live shadow/mirroring: out of scope without operational authority.
