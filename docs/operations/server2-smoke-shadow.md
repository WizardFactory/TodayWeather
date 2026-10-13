# server2 integrated smoke, paired replay and rollback rehearsal

S19 adds one repeatable local verification path per server2 family. This first increment covers the gateway/geocode family. Every check runs the actual release binary against task-owned loopback peers: recorded Kakao/Google providers, a frozen legacy origin (legacy geocoder plus weather backends) and the S03 local S3-compatible peer. Nothing reads an operator `.env`, calls a live provider, creates AWS resources, deploys or mirrors traffic.

See the [server2 contract](../architecture/server2.md), the [gateway guide](server2-gateway.md), the [S19 specification](../../specs/issue-2704.md) and the [path declaration](../../server2/config/tasks/S19.json).

## Run everything

Build the release binary, then run the integrated smoke from the repository root:

```sh
cd server2 && cargo build --locked --release && cd ..
bash server2/deploy/smoke.sh --binary server2/target/release/server2
```

| Option | Effect |
| --- | --- |
| `--binary PATH` | Release binary. The default is `target/release/server2` under `server2/`. A missing binary exits 2. |
| `--out DIR` | Report directory. The default is `reports/server2-smoke/<UTC stamp>`, which Git ignores. |
| `--family NAME` | Family to verify; repeatable. The default is every ready family (currently `gateway`). |
| `--skip-reused` | Skip the existing foundation (`tools/smoke.py`) and S10 (`tools/gateway_smoke.py`) smokes. CI uses this because it already runs them. |
| `--skip-deadlines` | Skip the stalled-dependency deadline probes (about 30s) in the rollback rehearsal. |

`SERVER2_PYTHON` selects the Python interpreter (default `python3`). The script runs these stages in order and stops at the first failure: reused smokes, family scenarios, paired replay with a self-check, then the rollback rehearsal. It writes `smoke.log`, `scenarios.json`, `replay-<family>.json` and `rollback-<family>.json`. Each stage can also run alone:

```sh
cd server2
python3 tools/shadow/smoke.py --binary target/release/server2 --report ../reports/s19/scenarios.json
python3 tools/shadow/replay.py --binary target/release/server2 --self-check --report ../reports/s19/replay.json
python3 tools/shadow/rollback.py --binary target/release/server2 --report ../reports/s19/rollback.json
python3 tests/integration/test_shadow.py
```

## Metrics the smoke asserts

The loopback metrics listener (`/internal/metrics`) now appends aggregate gateway and geocoder counters to the foundation counters. The counters never contain a path, coordinate, address, locale, key or provider text.

| Counter (prefix `server2_`) | Meaning |
| --- | --- |
| `gateway_requests_total` | Requests that entered the gateway |
| `gateway_responses_ok_total`, `..._not_modified_total`, `..._client_error_total`, `..._dependency_error_total`, `..._unavailable_total` | Completed responses by class: 2xx, 304, 4xx, other 5xx (501), 503 |
| `gateway_abandoned_total` | The client left before a response was produced; owned work continues |
| `gateway_owned_inflight` | Gauge of gateway owners whose work has not ended |
| `gateway_backend_attempts_total`, `gateway_legacy_geocode_attempts_total` | Legacy HTTP attempts |
| `geocoder_cache_hits_total`, `geocoder_joined_total`, `geocoder_flights_total` | RAM hits, waiters that joined a flight, owned acquisitions |
| `geocoder_kakao_attempts_total`, `geocoder_google_attempts_total` | Provider HTTP attempts |
| `geocoder_quota_rejections_total`, `geocoder_capacity_rejections_total` | Fail-closed quota and owner-capacity rejections |

Each scenario compares these deltas with independent peer counters. The S3 peer counts every request it receives, and the gateway family must send none.

## Gateway family scenarios

| ID | What it proves |
| --- | --- |
| GW-COLD-WARM | Cold: one owned flight, one Kakao call, one backend hop. Warm: RAM hits, no provider work, byte-identical body and ETag. |
| GW-EMPTY-RESTORE | Each restart re-acquires one reverse and one address lookup. Nothing reaches S3: precise results are RAM-only, and `S3AddressStore` is not wired in the process (S10a decides). |
| GW-SINGLE-FLIGHT | 16 same-key cold callers share one flight and one Kakao call. |
| GW-CANCEL | A disconnected initiator does not cancel or duplicate the owned lookup or backend work; a later waiter joins. |
| GW-OUTAGE | Provider HTTP 500 gives 501 no-store, one attempt per key, and the failure is not cached. Backend 500 gives exactly three attempts and 501. An S3 outage has no gateway impact. With an unreachable legacy origin, both routes fail fast in legacy mode; native mode still serves geocode. |
| GW-BUDGET | 16 dummy Kakao keys plus Google reserve 17 units per Korean lookup, so the fixed 10,000-unit mock quota funds exactly 588 lookups. The next lookup fails closed with no provider request. Warm keys still serve. RSS growth stays below 64 MiB. |
| GW-PRESSURE | 48 concurrent slow requests: the 40-slot admission serves 40 and rejects 8 with 503, `Retry-After: 5` and no-store. Rejected requests do no work. |
| GW-DRAIN | SIGTERM during an in-flight request: the request completes with 200, the process exits 0 within the 5s drain, and no retry occurs. |

Partial group publication, publication hashes and summary/state cases require S3 publication. The gateway family does not publish to S3, so those cases belong to the weather-family modules (S13, S11, S12 and later) when they are added.

## Paired replay

`replay.py` runs a frozen 15-request workload (`server2/tests/integration/fixtures/gateway-replay.json`) twice per side, first cold and then warm, each side in a fresh process:

- Baseline: `SERVER2_GEOCODER_MODE=legacy` against the frozen legacy origin. Its geocode replies are derived from S02 legacy records, and a unit test checks every derivation.
- Candidate: `SERVER2_GEOCODER_MODE=mock` (the native geocoder) against the recorded provider fixtures and the same backend bodies.

The comparator checks status, body bytes, every header and the dependency hops. A difference passes only when a declared entry names it:

| Declared difference | Scope |
| --- | --- |
| `D-TRANSPORT` | `date`, `connection`, `keep-alive` headers. These are transport observations, not functional parity. |
| `D-ACQ-GEOCODER` | Cold pass: legacy HTTP geocoder versus Kakao/Google acquisition. |
| `D-ACQ-WARM-CACHE` | Warm pass: the native side serves precise lookups from RAM; legacy mode delegates caching to the legacy origin. |

Backend hops, status, body, ETag, Cache-Control and content headers have no waiver. Requests that name an S02 case are also compared byte for byte with the recorded legacy response. `--self-check` reruns a perturbed baseline and must report unexplained differences, which proves that the comparison is not vacuous. The report records the revision and dirty flag, the binary SHA-256, the workload SHA-256 and count, cold and warm nearest-rank percentiles per side, acquisitions, metrics and every difference. Any unexplained difference or oracle mismatch exits 1.

To add a family, put a module next to `gateway_family.py` that provides the same functions and register it in `families.py`. Keep its frozen workload and declared differences under `server2/tests/integration/fixtures/`.

## Cache-aware rollback rehearsal

`rollback.py` restarts the binary legacy -> mock -> legacy against the same legacy origin. Each process has one geocoder mode, so `/weather` and `/geocode` switch together. Each phase checks:

- Cache-Control: weather `max-age=300`, geocode `max-age=2592000`, errors `no-store`.
- Geocoder source: every route uses the legacy geocoder in legacy phases, and no route does in the native phase.
- Empty-memory re-acquisition cost: cold and warm peer deltas.
- An ETag issued before the switch revalidates with 304 after it when the bodies are identical, so client and CloudFront validators stay usable.
- Deadlines, probed with `SERVER2_CONNECTION_SECONDS=12`: a stalled backend gives 501 no-store at about 9s after three attempts. A stalled Kakao call gives 501 at about 3s; a stalled legacy geocoder gives 501 at about 5s.

### Known gap S19-GAP-1 (decision pending)

With the default `SERVER2_CONNECTION_SECONDS=9`, the foundation's absolute connection lifetime closes the client socket at about 9s, just before the gateway writes its deadline `501 Not Implemented`. The client sees a closed connection, and `server2_gateway_abandoned_total` increments. The rehearsal pins this observation strictly: it fails if the behavior changes, so a fix must update the pin deliberately. Possible fixes are to raise the lifetime when the gateway is enabled, to reject gateway startup unless the lifetime exceeds 9s, or to exempt dispatched requests from the absolute lifetime. The [S19 plan](../../plans/issue-2704.md#open-decision) lists them. Until an owner decides, do not treat the default configuration as satisfying the legacy deadline contract.

## Limitations

These are local loopback fixtures. Timings, counts and RSS do not represent production latency, real Kakao/Google quotas, seven-day paired shadow or cutover evidence. The replay compares two server2 configurations plus selected S02 legacy records; it does not observe production traffic. Live shadow configuration and traffic mirroring need separate operational authority. Activation gates in the [gateway guide](server2-gateway.md#activation-and-rollback) still apply.

## Recorded local verification

The 2026-10-13 run of `smoke.sh` against the macOS release binary passed every stage. The S19 stages started at 06:21:06 UTC.

- Reused foundation and S10 smokes passed.
- All eight gateway scenarios passed. Peer totals for the scenario run were backend 52, Kakao 600, Google 2 and S3 0.
- Quota exhaustion: 588 of 589 lookups were funded, and the rejected lookup made no provider call. RSS was 7,824 KiB before and 10,592 KiB after.
- Admission pressure: 40 requests were served and 8 were rejected with 503.
- SIGTERM drain: the in-flight request completed and the process stopped after 1,205 ms.
- Paired replay over 15 requests and two passes: 0 unexplained differences and 0 S02 oracle mismatches on both sides. Observed declared differences were `D-TRANSPORT`, `D-ACQ-GEOCODER` and `D-ACQ-WARM-CACHE`. The perturbed self-check found 30 unexplained differences.
- Replay percentiles (nearest rank, n=15): cold p95 1.23 ms for the baseline and 1.29 ms for the candidate; warm p95 0.97 ms and 1.32 ms.
- Rollback: every cross-switch ETag revalidated with 304 (4/4 per switch). The stalled backend gave 501 at 9,002-9,003 ms after three attempts. Stalled Kakao gave 501 at 3,004 ms, and the stalled legacy geocoder gave 501 at 5,004 ms. S19-GAP-1 was observed as a connection closed at 9,003 ms.

The [actual terminal capture](../evidence/tasks/server2-smoke-shadow/usage.png) is rendered from that execution log; `docs/evidence/tasks/server2-smoke-shadow/manifest.json` records its hashes. These are synthetic loopback timings, not production latency.
