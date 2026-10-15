# server2 gateway and geocode operations

S10 adds an opt-in Rust gateway for `/weather` and `/geocode`. The process entrypoint forwards geocoding and weather backends to an explicit legacy HTTP origin by default. S10c (#2736) removed the verification-only geocoder `mock` mode: the native geocoder now runs only with the real configuration, which is the existing geocoder keys, the Kakao/Google endpoints (production by default), daily quotas and S3 for the quota records. S10e (#2753) moved every setting to the legacy `server/.env` names and values, read from `server2/.env`; endpoints and quotas without a legacy setting are built in. `SERVER2_NATIVE_FAMILIES` selects which families use the native backend; without it every family stays on legacy. Tests and smokes use the same setting names; they reach task-owned test peers through test-only builders, never through a setting.

See the [request design](../architecture/diagrams/server2-gateway.html), [server2 contract](../architecture/server2.md) and [configuration summary](../../server2/config/gateway-local.json). The diagram describes the conditional cache/provider design; its optional address-cache arrow does not mean that adapter is enabled in the process entrypoint.

## Run the local checks

Use Rust 1.99 or a compatible installed toolchain, Python 3 and the checked-in dependency lockfile. Run from the repository root:

```sh
cd server2
cargo test --locked --test gateway
cargo build --locked --release
cargo build --locked --release --example loopback_server
python3 tools/gateway_smoke.py --binary target/release/server2
```

The smoke starts task-owned loopback HTTP peers (a provider/legacy fixture and the S06 S3 test peer). The first legacy phase and the configuration refusal run the release `server2` binary; the phases that need the S3 peer run the release `loopback_server` example, the same process whose S3 and geocoder roots and per-key daily units come from its arguments. Processes listen on ephemeral ports (`PORT=0`) in an empty working directory with dummy keys and the S3 peer's dummy credentials in a restricted child environment, so the test does not load an operator's `.env`, send live provider requests or create AWS resources. It stops its child processes and local peers when the run finishes.

The smoke checks health, weather/geocode responses, conditional ETag `304`, empty `HEAD` bodies, invalid coordinates, CORS preflight and address lookup. It restarts through `legacy` → `native` → `legacy` routing to exercise rollback; only `SERVER2_NATIVE_FAMILIES` differs between the phases. The native phase also checks that 16 same-key cold callers cause one Kakao call, 16 distinct keys cause 16 Kakao calls, a non-ko locale lookup at a Korean coordinate uses one Kakao call plus one Google supplement, and the S3 peer holds only `budgets/v2/kakao|google/` quota records. The legacy phases add no S3 object. A last start of the release binary with native geocode and without `SERVER2_S3_BUCKET` must exit with a configuration error before binding. These counts describe controlled fixture demand; they do not estimate production quotas or provider latency. The script prints its observed percentiles for the current run.

The gateway test target covers pinned S02 wire records, the runtime configuration (routing list, required settings, production defaults, HTTPS endpoints, legacy selection), the native geocoder built from real-format settings serving the S02 `geocode-v000903-coord` bytes, query/number encoding, backend retry/error classification, explicit family/version switches, cancellation and deadline ownership, provider parsing, cache privacy, daily quota funding and address projection storage. A successful local smoke is additional functional evidence; it does not replace those regression checks or the separate activation gates.

## Process configuration

The binary reads the process environment and then `.env` in its working directory (start it from `server2/`; copy the legacy `server/.env` to `server2/.env`), with the legacy dotenv rules: the last duplicate wins and a process variable wins over the file. It never opens `server/.env` or imports legacy runtime assets. [server2/.env.example](../../server2/.env.example) lists every variable. A family that is not listed in `SERVER2_NATIVE_FAMILIES` reads none of its native settings. Every invalid or missing required setting stops startup with `invalid gateway configuration` before a listener binds.

| Variable | Behavior |
| --- | --- |
| `SERVER2_GATEWAY_LEGACY_URL` | Explicit opt-in origin for legacy geocoding and weather HTTP (server2 coexistence setting). If absent, the foundation health/metrics service remains selected and the gateway is not enabled. HTTP origins must be loopback; origins must not contain credentials, a query or a fragment. |
| `SERVER2_NATIVE_FAMILIES` | Comma-separated families routed to the native backend: `geocode`, `dsf` (native world weather and air) and `kma`. Unset or empty keeps every family on legacy. An unknown or repeated entry fails configuration. |
| `GEOCODER_KAKAO_KEYS` | Legacy JSON-array key setting. A present value must be a JSON array of nonempty strings; malformed values fail configuration instead of silently dropping keys. |
| `GEOCODER_GOOGLE_KEY` | Legacy single-key setting. Against the production Google endpoint only the key with the legacy fingerprint `ecd5fdb1` is used, as in legacy. |
| Geocoder endpoints | Built in: `https://dapi.kakao.com`, `https://maps.googleapis.com`. Legacy's test-only `GEOCODER_KAKAO_BASE_URL` / `GEOCODER_GOOGLE_BASE_URL` are not read. |
| Geocoder daily units | Built in: 100,000 per Kakao key and UTC day (the documented Kakao daily quota) and 322 for the Google key (Google documents no daily quota; 10,000 free Geocoding events a month ÷ 31). Every possible attempt of a lookup is funded before HTTP. |
| `SERVER2_S3_BUCKET` | The server2 raw-record bucket (server2-only setting); required when any family is native. |
| `AWS_ACCESS_KEY` / `AWS_SECRET_KEY` / `TWA_S3_REGION` | Legacy S3 credentials and region (default `ap-northeast-2`); the endpoint `https://s3.<region>.amazonaws.com/` is built in. One bounded admission of 12 in-flight requests is shared by world weather, world air, KMA and all quota records. The credentials are static; rotation or instance-role refresh is not provided. |
| `OPENSHIFT_NODEJS_IP` / `OPENSHIFT_NODEJS_PORT` / `PORT` | Legacy listener settings (`config.js`): address default `127.0.0.1`, port `OPENSHIFT_NODEJS_PORT`, else `PORT`, else `3000`. Metrics listen on loopback at the next port. During coexistence give server2 a port other than the legacy origin's. |
| Connection lifetime | Built in: 12 seconds with the gateway, so the 9-second deadline `501` is written before the socket closes; 9 seconds without it. |

The native world (`dsf`) and KMA (`kma`) settings are described in the [server2 contract](../architecture/server2.md#s10e-legacy-settings-and-server2env-2026-10-15).

AK instructed reuse of the existing legacy `.env` configuration rather than provisioning a separate server2 key set (S10, S10e). Keep `server2/.env` private (mode 600, ignored by Git); Paseo copies it from the source checkout into new worktrees. Do not execute the file as a shell script or print its values. The smokes deliberately supply their own dummy environment in an empty working directory and do not need those real keys.

Each configured key is its own quota owner. Its S08 owner identifier is a domain-separated SHA-256 of the key (`server2-geocoder-quota-v1`), so it follows key rotation and differs from the legacy log fingerprint. One S08 window covers one UTC day; the process opens a new budget store when the day changes and never refunds a reserved unit. S08 keeps one policy per owner and day, so a changed daily limit applies from the next UTC day. A restart with another limit inside the same day finds the stored policy and denies that key's acquisitions (no provider call) until the day ends. The built-in limits are documented provider quotas, not measured demand; measured values still belong to #2724.

## Contract and ownership

Unversioned `/weather/coord/...` keeps default `v000901`. Supported weather versions are `v000901`, `v000902` and `v000903`; coordinate geocode uses `v000903`, and address geocode supports `v000901` and `v000903`. Preserve the exact legacy route, validation, query, locale, body-byte and functional-header contract, including `HEAD`, conditional responses and preflight.

Gateway admission is bounded at 40 and the original public deadline is nine seconds. Backend attempts are at most three seconds, with at most three attempts inside that deadline. Geocoder lookup is at most five seconds and each provider attempt is at most three seconds. Deadline expiry preserves the legacy `501 Not Implemented` response. Capacity rejection returns `503 Service Unavailable` with `Retry-After: 5`; an explicit weather-unavailable marker retains its bounded retry timing. Errors use `no-store`; weather success uses `max-age=300`, geocode success uses `max-age=2592000`, and CORS allows `*`.

Owned work survives a disconnected waiter. Same-key geocoder waiters share one bounded acquisition and its retries; a new waiter does not extend the owner's deadline or create another reservation. Provider funding reserves the maximum possible chain before HTTP, including key rotation and possible supplements. Unused reserved units remain consumed. This conservative behavior prevents cancellation or replacement from refunding potentially spent quota. A quota or S3 failure denies a new acquisition without a provider call; memory hits still serve.

Weather families stay on legacy HTTP unless `SERVER2_NATIVE_FAMILIES` lists them; `dsf` registers the native world handler and selects it for `SERVER2_WORLD_VERSIONS` (default all three). Library callers may also register a handler with `BackendDispatcher::register_native` and select its `(Version, Family)` with `set_backend`. Selecting native without a registered handler fails closed.

## Cache privacy and storage

Precise normalized coordinate-plus-locale results stay in bounded volatile memory, with no more than 30 days of freshness. Reverse lookup bodies, precise cache keys and reversible lookup histories must not reach S3, catalogs, packs, metadata or operational logs. Hashing a coordinate does not make its history anonymous. Empty-memory reverse lookup may need a provider again; an archive cannot be used to reconstruct forbidden precise history. The native geocoder writes only S08 quota records (`budgets/v2/kakao|google/<owner>/<UTC date>/`) to S3.

The optional `S3AddressStore` accepts only address lookup projections, with a 16 KiB bound and 30-day freshness. Reverse lookups never invoke the address store. The adapter bounds its operations and requires acknowledged publication plus readback before accepting a stored projection. Corrupt, oversized, expired or invalid projections cannot serve as successful cache hits. This library capability is not wired by process startup (#2724 decides), and local storage tests do not establish live AWS behavior.

Any later coarse reverse cache must prove exact labels and response fields across boundaries and locales before serving. Same-cell weather or an address pointer does not prove equivalent display names, country/KMA addresses or returned coordinates.

## Activation and rollback

Routing `geocode` to the native backend in production still needs the measured Kakao/Google daily and peak quotas (#2724), byte/label parity, seven days of paired shadow without unexplained differences, measured cold p95 at most 2.5 seconds and the whole-gateway error/latency requirements. Local fixture percentiles do not satisfy production latency or quota gates. AK's separately scoped cutover authority remains required.

For process rollback, keep the existing explicit legacy origin and restart without the family in `SERVER2_NATIVE_FAMILIES`. The smoke exercises this restart transition against local peers. Library integrations must also restore each selected `(Version, Family)` to `BackendMode::Legacy`. Confirm both warm and empty-memory behavior, because changing a route does not reconstruct a precise-coordinate cache. Removing `SERVER2_GATEWAY_LEGACY_URL` disables the gateway and returns to the foundation service; it does not route client traffic back to legacy infrastructure. Quota records already written stay in S3.

These instructions cover local verification and configuration. They do not authorize deployment, production traffic changes, AWS resource actions or live provider calls.

## Recorded local verification

The 2026-10-15 02:14:26 UTC release-process run of the S10e change passed against task-owned
loopback peers with the S10e setting names in an empty working directory: 16 same-key cold
callers shared one Kakao request; 16 distinct keys caused 16 requests; a non-ko locale lookup at a
Korean coordinate used Kakao plus Google. The 16-sample distinct-key native timings were p50
65.21 ms, p95/p99 74.86 ms with eight concurrent clients and a fixed 50-ms peer delay. These are
synthetic local elapsed times, not live provider tails or production quota evidence. The S3 test
peer held 4 quota records after the native phase and no object after the first legacy phase; the
second legacy phase added none. The release `server2` binary with native geocode and no
`SERVER2_S3_BUCKET` exited with status 1 before binding. Legacy/native/legacy restart rollback
passed. The deadline `501` under the built-in lifetime is exercised by the
[S19 rollback rehearsal](server2-smoke-shadow.md#cache-aware-rollback-rehearsal). The
[actual terminal capture](../evidence/tasks/server2-gateway/usage.png) is rendered from the
execution output. The companion PDF is generated from this editable guide and visually checked
page by page.
