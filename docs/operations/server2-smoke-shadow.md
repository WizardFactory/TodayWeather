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
| GW-PRESSURE | 48 concurrent requests while backend replies are held: the 40-slot admission serves 40 and rejects 8 with 503, `Retry-After: 5` and no-store. Rejected requests do no work. |
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

Backend hops, status, body, ETag, Cache-Control and content headers have no waiver. A declared acquisition difference applies only when both sides match the request's exact planned counts for that pass (`acquisitions` in the fixture). Any deviation is unexplained, including extra provider calls, any warm-pass native provider call, and extra calls that both sides happen to share.

The replay also checks results against oracles that do not depend on server2:

- Requests that name an S02 case are compared byte for byte with the recorded legacy response. An unresolvable oracle ID or a wrong oracle count fails the run.
- Successful weather requests marked `merge_oracle` must equal the frozen backend body merged with the frozen legacy geocode fields. Both server2 configurations are checked, so a weather assembly regression that both share cannot pass.

`--self-check` reruns a perturbed baseline and must report unexplained differences, which proves that the comparison is not vacuous.

The report records the revision and dirty flag, the binary SHA-256, and the workload SHA-256 and count. It also records nearest-rank percentiles per side and every difference:

| Percentile group | Requests included |
| --- | --- |
| `cold_pass` | The first pass in a fresh process, which mixes cache misses, RAM hits and error routes. |
| `cold_miss` | Only first-pass requests that acquired a geocode. |
| `warm_pass` | The second pass. |

Any unexplained difference or oracle mismatch exits 1.

To add a family, put a module next to `gateway_family.py` that provides the same functions and register it in `families.py`. Keep its frozen workload and declared differences under `server2/tests/integration/fixtures/`.

## Cache-aware rollback rehearsal

`rollback.py` restarts the binary legacy -> mock -> legacy against the same legacy origin. Each process has one geocoder mode, so `/weather` and `/geocode` switch together. Each phase checks:

- Cache-Control: weather `max-age=300`, geocode `max-age=2592000`, errors `no-store`.
- Geocoder source: every route uses the legacy geocoder in legacy phases, and no route does in the native phase.
- Empty-memory re-acquisition cost: cold and warm peer deltas.
- An ETag issued before the switch revalidates with 304 after it when the bodies are identical, so client and CloudFront validators stay usable.
- Deadlines, probed with the default gateway configuration in the native and second legacy phases: a stalled backend gives the legacy 501 at about 9s after three attempts. Its status, body bytes and functional headers must match the S02 `gateway-deadline` record; only `date`, `connection` and `keep-alive` are excluded as transport headers. A stalled Kakao call gives 501 at about 3s; a stalled legacy geocoder gives 501 at about 5s.
- Lifetime refusal, checked in the first phase: the release binary with the gateway enabled and `SERVER2_CONNECTION_SECONDS=9` must exit nonzero with the configuration message before announcing its listeners.

### Closed gap S19-GAP-1

S19 found that the foundation's 9s absolute connection lifetime closed the client socket just before the gateway wrote its 9s deadline `501 Not Implemented`. AK chose the fix on 2026-10-13, and S10b ([#2730](https://github.com/WizardFactory/TodayWeather/issues/2730)) implemented it. With `SERVER2_GATEWAY_LEGACY_URL` set, the connection lifetime defaults to 12s, and a configured `SERVER2_CONNECTION_SECONDS` of 9 or less fails startup. The rehearsal no longer pins the gap; it fails if the default configuration does not deliver the legacy 501. The 501 guarantee covers a request that starts within lifetime minus 9s of the connection being accepted; a later keep-alive request on the same connection can still outlive it. The [S19 plan](../../plans/issue-2704.md#open-decision) keeps the original options as history.

## Limitations

These are local loopback fixtures. Timings, counts and RSS do not represent production latency, real Kakao/Google quotas, seven-day paired shadow or cutover evidence. The replay compares two server2 configurations plus selected S02 legacy records; it does not observe production traffic. Live shadow configuration and traffic mirroring need separate operational authority. Activation gates in the [gateway guide](server2-gateway.md#activation-and-rollback) still apply.

## Recorded local verification

The 2026-10-13 run of `smoke.sh` against the macOS release binary of the S10b change passed every stage. The S19 stages started at 09:50:54 UTC.

- Reused foundation and S10 smokes passed.
- All eight gateway scenarios passed. Peer totals for the scenario run were backend 52, Kakao 600, Google 2 and S3 0.
- Quota exhaustion: 588 of 589 lookups were funded, and the rejected lookup made no provider call. RSS was 7,792 KiB before and 10,560 KiB after.
- Admission pressure: while backend replies were held, 40 requests were admitted and 8 were rejected with 503.
- SIGTERM drain: the held in-flight request completed and the process stopped 208 ms after the signal.
- Paired replay over 15 requests and two passes: every request matched its acquisition plan. There were 0 unexplained differences. On each side, 12 S02 oracle checks and 10 weather merge-oracle checks found 0 mismatches. Observed declared differences were `D-TRANSPORT`, `D-ACQ-GEOCODER` and `D-ACQ-WARM-CACHE`. The perturbed self-check found 30 unexplained differences.
- Replay p95 (nearest rank) for the baseline and the candidate:

| Group | Baseline | Candidate |
| --- | --- | --- |
| `cold_pass` (n=15) | 1.25 ms | 2.53 ms |
| `cold_miss` | 1.25 ms (n=11) | 2.53 ms (n=4) |
| `warm_pass` (n=15) | 1.03 ms | 1.42 ms |

- Rollback: every cross-switch ETag revalidated with 304 (4/4 per switch). With the default gateway lifetime, the stalled backend gave the legacy 501 at 9,003 ms after three attempts in both the native and legacy phases. Stalled Kakao gave 501 at 3,004 ms, and the stalled legacy geocoder gave 501 at 5,004 ms. The gateway with `SERVER2_CONNECTION_SECONDS=9` exited with status 1 before binding.

The [actual terminal capture](../evidence/tasks/server2-smoke-shadow/usage.png) is rendered from that execution log; `docs/evidence/tasks/server2-smoke-shadow/manifest.json` records its hashes. These are synthetic loopback timings, not production latency.
