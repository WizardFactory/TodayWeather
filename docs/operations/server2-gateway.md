# server2 gateway and geocode operations

S10 adds an opt-in Rust gateway for `/weather` and `/geocode`. The process entrypoint forwards geocoding and weather backends to an explicit legacy HTTP origin by default. Native geocoder acquisition is available only against local mock peers; this entrypoint cannot enable live Kakao or Google calls. The library also provides family/version backend switches, funded geocoder reservations and an optional address-only S3 cache adapter. Those library adapters are not automatically configured by environment variables.

See the [request design](../architecture/diagrams/server2-gateway.html), [server2 contract](../architecture/server2.md) and [local configuration summary](../../server2/config/gateway-local.json). The diagram describes the conditional cache/provider design; its optional S3 and provider arrows do not mean those integrations are enabled in the process entrypoint.

## Run the local checks

Use Rust 1.99 or a compatible installed toolchain, Python 3 and the checked-in dependency lockfile. Run from the repository root:

```sh
cd server2
cargo test --locked --test gateway
cargo build --locked --release
python3 tools/gateway_smoke.py --binary target/release/server2
```

The smoke starts task-owned loopback HTTP peers and the actual release binary on ephemeral public/private ports. It supplies dummy keys in a restricted child environment, so the test does not load an operator's `.env`, send live provider requests or create AWS resources. It stops its child processes and local peers when the run finishes.

The smoke checks health, weather/geocode responses, conditional ETag `304`, empty `HEAD` bodies, invalid coordinates, CORS preflight and address lookup. It restarts through `legacy` → `mock` → `legacy` to exercise rollback. The mock phase also checks that 16 same-key cold callers cause one Kakao call, 16 distinct keys cause 16 Kakao calls, and a non-ko locale lookup at a Korean coordinate uses one Kakao call plus one Google supplement. These counts describe controlled fixture demand; they do not estimate production quotas or provider latency. The script prints its observed percentiles for the current run.

The gateway test target covers pinned S02 wire records, query/number encoding, backend retry/error classification, explicit family/version switches, cancellation and deadline ownership, provider parsing, cache privacy, quota funding and address projection storage. A successful local smoke is additional functional evidence; it does not replace those regression checks or the separate activation gates.

## Process configuration

The binary reads configuration from its injected environment. It does not open a legacy `.env` file or import legacy runtime assets. In mock mode, a present `GEOCODER_KAKAO_KEYS` value must be a JSON array of nonempty strings; malformed values fail configuration instead of silently dropping keys.

| Variable | Behavior |
| --- | --- |
| `SERVER2_GATEWAY_LEGACY_URL` | Explicit opt-in origin for legacy geocoding and weather HTTP. If absent, the foundation health/metrics service remains selected and the gateway is not enabled. Use a task-owned `http://127.0.0.1:<port>` origin for local verification. HTTP origins must be loopback; origins must not contain credentials, a query or a fragment. |
| `SERVER2_GEOCODER_MODE` | `legacy` is the default. `mock` selects the local Rust geocoder. Any other value fails configuration; there is no live native mode. |
| `GEOCODER_KAKAO_BASE_URL` | Required as an explicit literal-loopback HTTP origin for `mock`, such as `http://127.0.0.1:<port>`. Hostnames, numeric aliases, credentials, non-root paths, queries and fragments are rejected. |
| `GEOCODER_GOOGLE_BASE_URL` | Same mock endpoint restrictions as Kakao. Both mock endpoints must be supplied explicitly. |
| `GEOCODER_KAKAO_KEYS` | Existing JSON-array key setting. Use dummy values for mock peers; keep actual values out of fixtures, commands recorded as evidence and repository files. |
| `GEOCODER_GOOGLE_KEY` | Existing single-key setting. Use a dummy value for mocks. The non-mock library configuration retains the existing Google fingerprint restriction. |
| `SERVER2_BIND` / `SERVER2_METRICS_BIND` | Public/private listener settings inherited from the foundation. Metrics must remain loopback. The smoke chooses ephemeral ports. |

AK instructed reuse of the existing geocoder `.env` configuration rather than provisioning a separate server2 key set. Continue using the operator's existing environment-injection mechanism. Do not execute the file as a shell script or copy its secret values into server2 configuration. The local smoke deliberately supplies its own dummy environment and does not need those real keys.

In `legacy` mode the configured origin owns its existing geocoder/key behavior. In `mock` mode the process installs a finite 10,000-unit mock quota. That counter is for bounded local tests only and cannot fund live acquisition. The process does not automatically install `FundedQuota`, S3 credentials or `S3AddressStore`; those require explicit library integration and their applicable activation prerequisites.

## Contract and ownership

Unversioned `/weather/coord/...` keeps default `v000901`. Supported weather versions are `v000901`, `v000902` and `v000903`; coordinate geocode uses `v000903`, and address geocode supports `v000901` and `v000903`. Preserve the exact legacy route, validation, query, locale, body-byte and functional-header contract, including `HEAD`, conditional responses and preflight.

Gateway admission is bounded at 40 and the original public deadline is nine seconds. Backend attempts are at most three seconds, with at most three attempts inside that deadline. Geocoder lookup is at most five seconds and each provider attempt is at most three seconds. Deadline expiry preserves the legacy `501 Not Implemented` response. Capacity rejection returns `503 Service Unavailable` with `Retry-After: 5`; an explicit weather-unavailable marker retains its bounded retry timing. Errors use `no-store`; weather success uses `max-age=300`, geocode success uses `max-age=2592000`, and CORS allows `*`.

Owned work survives a disconnected waiter. Same-key geocoder waiters share one bounded acquisition and its retries; a new waiter does not extend the owner's deadline or create another reservation. Provider funding reserves the maximum possible chain before HTTP, including key rotation and possible supplements. Unused reserved units remain consumed. This conservative behavior prevents cancellation or replacement from refunding potentially spent quota.

All weather families remain legacy HTTP in process startup. Library callers may register a handler with `BackendDispatcher::register_native` and select its `(Version, Family)` with `set_backend`. Selecting a native mode without a registered handler fails closed. S10 supplies the switch mechanism and fixture handlers, not an operational native weather-family port or an environment switch that pretends one exists.

## Cache privacy and storage

Precise normalized coordinate-plus-locale results stay in bounded volatile memory, with no more than 30 days of freshness. Reverse lookup bodies, precise cache keys and reversible lookup histories must not reach S3, catalogs, packs, metadata or operational logs. Hashing a coordinate does not make its history anonymous. Empty-memory reverse lookup may need a provider again; an archive cannot be used to reconstruct forbidden precise history.

The optional `S3AddressStore` accepts only address lookup projections, with a 16 KiB bound and 30-day freshness. Reverse lookups never invoke the address store. The adapter bounds its operations and requires acknowledged publication plus readback before accepting a stored projection. Corrupt, oversized, expired or invalid projections cannot serve as successful cache hits. This library capability is not automatically enabled by process startup, and local storage tests do not establish live AWS behavior.

Any later coarse reverse cache must prove exact labels and response fields across boundaries and locales before serving. Same-cell weather or an address pointer does not prove equivalent display names, country/KMA addresses or returned coordinates.

## Activation and rollback

The local entrypoint rejects live native geocoder acquisition. Actual daily and peak Kakao/Google quotas remain unknown, and local mock percentiles do not satisfy production latency or quota gates. Before a production family activation, record exact quota headroom, byte/label parity, seven days of paired shadow without unexplained differences, measured cold p95 at most 2.5 seconds and the whole-gateway error/latency requirements. AK's separately scoped cutover authority remains required.

For process rollback, keep the existing explicit legacy origin and restart with `SERVER2_GEOCODER_MODE=legacy`. The smoke exercises this restart transition against local peers. Library integrations must also restore each selected `(Version, Family)` to `BackendMode::Legacy`. Confirm both warm and empty-memory behavior, because changing a route does not reconstruct a precise-coordinate cache. Removing `SERVER2_GATEWAY_LEGACY_URL` disables the gateway and returns to the foundation service; it does not route client traffic back to legacy infrastructure.

These instructions cover local verification and configuration. They do not authorize deployment, production traffic changes, AWS resource actions or live provider calls.

## Recorded local verification

The 2026-10-13 01:18:38 UTC release-process run passed against task-owned
loopback peers: 16 same-key cold callers shared one Kakao request; 16 distinct
keys caused 16 requests; a non-ko locale lookup at a Korean coordinate used Kakao plus Google. The
16-sample distinct-key mock timings were p50 62.76 ms, p95/p99 66.65 ms
with eight concurrent clients and a fixed 50-ms peer delay. These are synthetic
local elapsed times, not live provider tails or production quota evidence.
Legacy/mock/legacy restart rollback and the separate foundation socket/drain
smoke passed. The [actual terminal capture](../evidence/tasks/server2-gateway/usage.png)
is rendered from the execution output. The companion PDF is generated from
this editable guide and visually checked page by page.
