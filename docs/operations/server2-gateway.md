# server2 gateway and geocode operations

S10 adds an opt-in Rust gateway for `/weather` and `/geocode`. The process entrypoint forwards geocoding and weather backends to an explicit legacy HTTP origin by default. S10c (#2736) removed the verification-only geocoder `mock` mode: the native geocoder now runs only with the real configuration, which is the existing geocoder keys, the Kakao/Google endpoints (production by default), configured daily quotas and S3 for the quota records. `SERVER2_NATIVE_FAMILIES` selects which families use the native backend; without it every family stays on legacy. Tests and smokes give the same settings real-format values that point at task-owned test peers.

See the [request design](../architecture/diagrams/server2-gateway.html), [server2 contract](../architecture/server2.md) and [configuration summary](../../server2/config/gateway-local.json). The diagram describes the conditional cache/provider design; its optional address-cache arrow does not mean that adapter is enabled in the process entrypoint.

## Run the local checks

Use Rust 1.99 or a compatible installed toolchain, Python 3 and the checked-in dependency lockfile. Run from the repository root:

```sh
cd server2
cargo test --locked --test gateway
cargo build --locked --release
python3 tools/gateway_smoke.py --binary target/release/server2
```

The smoke starts task-owned loopback HTTP peers (a provider/legacy fixture and the S06 S3 test peer) and the actual release binary on ephemeral public/private ports. It supplies dummy keys and the S3 peer's dummy credentials in a restricted child environment, so the test does not load an operator's `.env`, send live provider requests or create AWS resources. It stops its child processes and local peers when the run finishes.

The smoke checks health, weather/geocode responses, conditional ETag `304`, empty `HEAD` bodies, invalid coordinates, CORS preflight and address lookup. It restarts through `legacy` → `native` → `legacy` routing to exercise rollback; only `SERVER2_NATIVE_FAMILIES` differs between the phases. The native phase also checks that 16 same-key cold callers cause one Kakao call, 16 distinct keys cause 16 Kakao calls, a non-ko locale lookup at a Korean coordinate uses one Kakao call plus one Google supplement, and the S3 peer holds only `budgets/v2/kakao|google/` quota records. The legacy phases add no S3 object. A last start without `SERVER2_GEOCODER_KAKAO_DAILY_UNITS` must exit with a configuration error before binding. These counts describe controlled fixture demand; they do not estimate production quotas or provider latency. The script prints its observed percentiles for the current run.

The gateway test target covers pinned S02 wire records, the runtime configuration (routing list, required settings, production defaults, HTTPS endpoints, legacy selection), the native geocoder built from real-format settings serving the S02 `geocode-v000903-coord` bytes, query/number encoding, backend retry/error classification, explicit family/version switches, cancellation and deadline ownership, provider parsing, cache privacy, daily quota funding and address projection storage. A successful local smoke is additional functional evidence; it does not replace those regression checks or the separate activation gates.

## Process configuration

The binary reads configuration from its injected environment. It does not open a legacy `.env` file or import legacy runtime assets. A family that is not listed in `SERVER2_NATIVE_FAMILIES` reads none of its native settings. Every invalid or missing required setting stops startup with `invalid gateway configuration` before a listener binds.

| Variable | Behavior |
| --- | --- |
| `SERVER2_GATEWAY_LEGACY_URL` | Explicit opt-in origin for legacy geocoding and weather HTTP. If absent, the foundation health/metrics service remains selected and the gateway is not enabled. HTTP origins must be loopback; origins must not contain credentials, a query or a fragment. |
| `SERVER2_NATIVE_FAMILIES` | Comma-separated families routed to the native backend: `geocode` (the Rust geocoder) and `dsf` (native world weather and air). Unset or empty keeps every family on legacy. An unknown or repeated entry fails configuration. |
| `GEOCODER_KAKAO_KEYS` | Existing JSON-array key setting. A present value must be a JSON array of nonempty strings; malformed values fail configuration instead of silently dropping keys. |
| `GEOCODER_GOOGLE_KEY` | Existing single-key setting. Against the production Google endpoint only the key with the legacy fingerprint `ecd5fdb1` is used, as in legacy; a configured test endpoint skips that check. |
| `GEOCODER_KAKAO_BASE_URL` / `GEOCODER_GOOGLE_BASE_URL` | Existing legacy names. Defaults `https://dapi.kakao.com` and `https://maps.googleapis.com`. A configured root must be HTTPS, or plain HTTP only to a loopback address, with no path, credentials, query or fragment. |
| `SERVER2_GEOCODER_KAKAO_DAILY_UNITS` | Required with Kakao keys: units per key per UTC day. Every possible attempt of a lookup is funded before HTTP. |
| `SERVER2_GEOCODER_GOOGLE_DAILY_UNITS` | Required with a usable Google key: units per UTC day. |
| `SERVER2_S3_REGION` / `SERVER2_S3_ENDPOINT` | Region (default `ap-northeast-2`) and endpoint (default `https://s3.<region>.amazonaws.com/`). The endpoint follows the transport rule: HTTPS, or plain HTTP only to a loopback address. |
| `SERVER2_S3_BUCKET` / `SERVER2_S3_ACCESS_KEY_ID` / `SERVER2_S3_SECRET_ACCESS_KEY` | Required when any family is native. One bounded admission of 12 in-flight requests is shared by world weather, world air and all quota records. The credentials are static; rotation or instance-role refresh is not provided. |
| `SERVER2_BIND` / `SERVER2_METRICS_BIND` | Public/private listener settings inherited from the foundation. Metrics must remain loopback. The smoke chooses ephemeral ports. |
| `SERVER2_CONNECTION_SECONDS` | Absolute connection lifetime from the foundation. With the gateway enabled the default is 12 seconds, so the 9-second deadline `501` is written before the socket closes. A configured value of 9 or less fails startup before any listener binds; the allowed range is 10..30. The foundation default without the gateway stays 9. |

The native world settings (`dsf`) are described in the [server2 contract](../architecture/server2.md#s10c-real-runtime-configuration-2026-10-13).

AK instructed reuse of the existing geocoder `.env` configuration rather than provisioning a separate server2 key set. Continue using the operator's existing environment-injection mechanism. Do not execute the file as a shell script or copy its secret values into server2 configuration. The smokes deliberately supply their own dummy environment and do not need those real keys.

Each configured key is its own quota owner. Its S08 owner identifier is a domain-separated SHA-256 of the key (`server2-geocoder-quota-v1`), so it follows key rotation and differs from the legacy log fingerprint. One S08 window covers one UTC day; the process opens a new budget store when the day changes and never refunds a reserved unit. S08 keeps one policy per owner and day, so a changed daily limit applies from the next UTC day. A restart with another limit inside the same day finds the stored policy and denies that key's acquisitions (no provider call) until the day ends. The measured limit values belong to #2724; until then, any configured value is an operator choice, not a measured quota.

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

The 2026-10-13 15:00:21 UTC release-process run of the S10c change passed against task-owned
loopback peers with real-format configuration: 16 same-key cold callers shared one Kakao
request; 16 distinct keys caused 16 requests; a non-ko locale lookup at a Korean coordinate used
Kakao plus Google. The 16-sample distinct-key native timings were p50 60.92 ms, p95/p99
64.92 ms with eight concurrent clients and a fixed 50-ms peer delay. These are synthetic local
elapsed times, not live provider tails or production quota evidence. The S3 test peer held 4
quota records after the native phase and no object after the first legacy phase; the second
legacy phase added none. A native start without `SERVER2_GEOCODER_KAKAO_DAILY_UNITS` exited
with status 1 before binding. Legacy/native/legacy restart rollback passed. The deadline `501`
under the default lifetime is exercised by the
[S19 rollback rehearsal](server2-smoke-shadow.md#cache-aware-rollback-rehearsal). The
[actual terminal capture](../evidence/tasks/server2-gateway/usage.png) is rendered from the
execution output. The companion PDF is generated from this editable guide and visually checked
page by page.
