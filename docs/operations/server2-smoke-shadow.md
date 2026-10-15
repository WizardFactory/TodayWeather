# server2 integrated smoke, paired replay and rollback rehearsal

S19 adds one repeatable local verification path per server2 family. This first increment covers the gateway/geocode family. Every check runs the actual release build against task-owned loopback peers: recorded Kakao/Google providers, a frozen legacy origin (legacy geocoder plus weather backends) and the S03 local S3-compatible peer. Since S10c ([#2736](https://github.com/WizardFactory/TodayWeather/issues/2736)) both sides use the real runtime configuration, and since S10e ([#2753](https://github.com/WizardFactory/TodayWeather/issues/2753)) its real names: the legacy `server/.env` names plus `SERVER2_S3_BUCKET` and the coexistence routing entries. The legacy side has no routing entry, and the native side sets `SERVER2_NATIVE_FAMILIES=geocode`. S3 and provider endpoints and the geocoder daily units are built in, not settings, so processes that need the peers run the release `loopback_server` example: the same server2 process with those values given as arguments. The configuration refusal runs the release `server2` binary. Every process runs in an empty working directory with `PORT=0`; nothing reads an operator `.env`, calls a live provider, creates AWS resources, deploys or mirrors traffic.

See the [server2 contract](../architecture/server2.md), the [gateway guide](server2-gateway.md), the [S19 specification](../../specs/issue-2704.md) and the [path declaration](../../server2/config/tasks/S19.json).

## Run everything

Build the release binary, then run the integrated smoke from the repository root:

```sh
cd server2 && cargo build --locked --release && cargo build --locked --release --example loopback_server && cd ..
bash server2/deploy/smoke.sh --binary server2/target/release/server2
```

| Option | Effect |
| --- | --- |
| `--binary PATH` | Release binary. The default is `target/release/server2` under `server2/`. A missing binary, or a missing `examples/loopback_server` beside it, exits 2. |
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

Each scenario compares these deltas with independent peer counters. The S3 peer counts every request it receives. The legacy side must send none; on the native side the peer may hold only S08 quota records under `budgets/v2/kakao/` and `budgets/v2/google/`, with no coordinate, address, result or key in any object key.

## Gateway family scenarios

| ID | What it proves |
| --- | --- |
| GW-COLD-WARM | Cold: one owned flight, one Kakao call, one backend hop. Warm: RAM hits, no provider work, byte-identical body and ETag. |
| GW-EMPTY-RESTORE | Each restart re-acquires one reverse and one address lookup. S3 holds only quota records: precise results are RAM-only, and `S3AddressStore` is not wired in the process (S10a decides). |
| GW-SINGLE-FLIGHT | 16 same-key cold callers share one flight and one Kakao call. |
| GW-CANCEL | A disconnected initiator does not cancel or duplicate the owned lookup or backend work; a later waiter joins. |
| GW-OUTAGE | Provider HTTP 500 gives 501 no-store, one attempt per key, and the failure is not cached. Backend 500 gives exactly three attempts and 501. An S3 outage does not affect warm lookups or weather backends; new native lookups fail closed once the owned quota block is spent. With an unreachable legacy origin, both routes fail fast with legacy routing; native routing still serves geocode. |
| GW-BUDGET | 16 dummy Kakao keys plus Google, each with a test daily quota of 64 units (a `loopback_server` argument; production uses the built-in limits): every Korean lookup reserves one unit of each key before HTTP, so 64 lookups are funded. The next lookup fails closed with no provider request. Warm keys still serve. RSS growth stays below 64 MiB. The scenario uses its own keys because S08 keeps one policy per quota owner and UTC day. |
| GW-PRESSURE | 48 concurrent requests while backend replies are held: the 40-slot admission serves 40 and rejects 8 with 503, `Retry-After: 5` and no-store. Rejected requests do no work. |
| GW-DRAIN | SIGTERM during an in-flight request: the request completes with 200, the process exits 0 within the 5s drain, and no retry occurs. |

Partial group publication, publication hashes and summary/state cases require S3 publication. The gateway family writes only quota records to S3, so those cases belong to the weather-family modules (S13, S11, S12 and later) when they are added.

## Paired replay

`replay.py` runs a frozen 15-request workload (`server2/tests/integration/fixtures/gateway-replay.json`) twice per side, first cold and then warm, each side in a fresh process:

- Baseline: no `SERVER2_NATIVE_FAMILIES` (legacy routing) against the frozen legacy origin. Its geocode replies are derived from S02 legacy records, and a unit test checks every derivation.
- Candidate: `SERVER2_NATIVE_FAMILIES=geocode` (the native geocoder with per-key daily quotas in the S3 peer) against the recorded provider fixtures and the same backend bodies.

The comparator checks status, body bytes, every header and the dependency hops. A difference passes only when a declared entry names it:

| Declared difference | Scope |
| --- | --- |
| `D-TRANSPORT` | `date`, `connection`, `keep-alive` headers. These are transport observations, not functional parity. |
| `D-ACQ-GEOCODER` | Cold pass: legacy HTTP geocoder versus Kakao/Google acquisition. |
| `D-ACQ-WARM-CACHE` | Warm pass: the native side serves precise lookups from RAM; with legacy routing, caching is delegated to the legacy origin. |

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

`rollback.py` restarts the binary legacy -> native -> legacy against the same legacy origin; only `SERVER2_NATIVE_FAMILIES` changes. Each process has one geocoder route, so `/weather` and `/geocode` switch together. Each phase checks:

- Cache-Control: weather `max-age=300`, geocode `max-age=2592000`, errors `no-store`.
- Geocoder source: every route uses the legacy geocoder in legacy phases, and no route does in the native phase.
- Empty-memory re-acquisition cost: cold and warm peer deltas.
- An ETag issued before the switch revalidates with 304 after it when the bodies are identical, so client and CloudFront validators stay usable.
- Deadlines, probed with the default gateway configuration in the native and second legacy phases: a stalled backend gives the legacy 501 at about 9s after three attempts. Its status, body bytes and functional headers must match the S02 `gateway-deadline` record; only `date`, `connection` and `keep-alive` are excluded as transport headers. A stalled Kakao call gives 501 at about 3s; a stalled legacy geocoder gives 501 at about 5s.
- Configuration refusal, checked in the first phase: the release `server2` binary with native geocode and no `SERVER2_S3_BUCKET` must exit nonzero with `invalid gateway configuration` before announcing its listeners. (S10e removed `SERVER2_CONNECTION_SECONDS`; the gateway lifetime is the built-in 12 seconds, so the earlier lifetime refusal has no input.)

### Closed gap S19-GAP-1

S19 found that the foundation's 9s absolute connection lifetime closed the client socket just before the gateway wrote its 9s deadline `501 Not Implemented`. AK chose the fix on 2026-10-13, and S10b ([#2730](https://github.com/WizardFactory/TodayWeather/issues/2730)) implemented it. With `SERVER2_GATEWAY_LEGACY_URL` set, the connection lifetime is 12s (built in since S10e). The rehearsal no longer pins the gap; it fails if the default configuration does not deliver the legacy 501. The 501 guarantee covers a request that starts within lifetime minus 9s of the connection being accepted; a later keep-alive request on the same connection can still outlive it. The [S19 plan](../../plans/issue-2704.md#open-decision) keeps the original options as history.

## Limitations

These are local loopback fixtures. Timings, counts and RSS do not represent production latency, real Kakao/Google quotas, seven-day paired shadow or cutover evidence. The replay compares two server2 configurations plus selected S02 legacy records; it does not observe production traffic. Live shadow configuration and traffic mirroring need separate operational authority. Activation gates in the [gateway guide](server2-gateway.md#activation-and-rollback) still apply.

## Recorded local verification

The 2026-10-15 run of `smoke.sh` against the macOS release binary and `loopback_server` example of the S10e change passed every stage. The S19 stages started at 02:14:47 UTC.

- Reused foundation and S10 smokes passed with the S10e names in empty working directories.
- All eight gateway scenarios passed. Peer totals for the scenario run were backend 52, Kakao 76, Google 2 and S3 158 requests; the S3 peer held only `budgets/v2/kakao|google/` quota records.
- Quota exhaustion: with a 64-unit test daily quota per key, 64 of 65 lookups were funded, and the rejected lookup made no provider call. RSS was 9,728 KiB before and 13,792 KiB after.
- Admission pressure: while backend replies were held, 40 requests were admitted and 8 were rejected with 503.
- SIGTERM drain: the held in-flight request completed and the process stopped 227 ms after the signal.
- Paired replay over 15 requests and two passes: there were 0 unexplained differences. On each side, 12 S02 oracle checks and 10 weather merge-oracle checks found 0 mismatches. Observed declared differences were `D-TRANSPORT`, `D-ACQ-GEOCODER` and `D-ACQ-WARM-CACHE`. The perturbed self-check found 30 unexplained differences.
- Replay p95 (nearest rank) for the baseline and the candidate:

| Group | Baseline | Candidate |
| --- | --- | --- |
| `cold_pass` (n=15) | 126.34 ms | 13.63 ms |
| `cold_miss` | 126.34 ms (n=11) | 10.26 ms (n=4) |
| `warm_pass` (n=15) | 2.55 ms | 7.33 ms |

- Rollback: every cross-switch ETag revalidated with 304 (4/4 per switch). With the built-in gateway lifetime, the stalled backend gave the legacy 501 at 9,003 ms (native phase) and 9,003 ms (second legacy phase) after three attempts. Stalled Kakao gave 501 at 3,006 ms, and the stalled legacy geocoder gave 501 at 5,004 ms. The release `server2` binary with native geocode and no `SERVER2_S3_BUCKET` exited with status 1 before binding.

The [actual terminal capture](../evidence/tasks/server2-smoke-shadow/usage.png) is rendered from that execution log; `docs/evidence/tasks/server2-smoke-shadow/manifest.json` records its hashes. These are synthetic loopback timings, not production latency; a single slow first request dominates the baseline p95.
