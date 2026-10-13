# S10c specification: real runtime configuration

Source: [intent](../intent/issue-2736.md), issue #2736. Base 8c3a703c.

## Requirements

R1. Removed settings. The runtime reads none of `SERVER2_GEOCODER_MODE`, `SERVER2_WORLD_MODE`,
`SERVER2_WORLD_AIR`. The library removes `GeocoderConfig::mock_mode`, `MockQuota`, the
literal-loopback geocoder endpoint rule, the geocoder acquisition gate that returned `Quota`
outside mock mode, `LiveAir::restore_only`, its `live` flag and `NoFunding`, the world runtime
`loopback_http` restriction and `warnings::seed::loopback_endpoint`. No replacement mode, flag
or dry-run path is added.

R2. Routing. `SERVER2_NATIVE_FAMILIES` is a comma-separated list of families routed to the
native backend: `geocode` and `dsf` (world weather and air). Unset or empty selects legacy for
every family. An unknown or repeated entry is a configuration error. For `dsf`,
`SERVER2_WORLD_VERSIONS` keeps selecting versions (default `v000901,v000902,v000903`). A family
that is not listed reads none of its native settings. The per-family/version
`BackendDispatcher` switch is unchanged and stays the rollback route.

R3. S3. One set of settings, shared by the runtime and the seed importers:
`SERVER2_S3_REGION` (default `ap-northeast-2`), `SERVER2_S3_ENDPOINT` (default
`https://s3.<region>.amazonaws.com/`), `SERVER2_S3_BUCKET`, `SERVER2_S3_ACCESS_KEY_ID`,
`SERVER2_S3_SECRET_ACCESS_KEY` (required). The endpoint follows the existing transport rule
(HTTPS, or HTTP only to a loopback address; root path; no credentials, query or fragment). The
runtime builds S3 only when a native family is listed and shares one bounded admission of 12
in-flight requests across world weather, world air and all budget operations. Values are not
printed and the settings type has no `Debug`.

R4. Native geocoder (`geocode` listed). Keys: `GEOCODER_KAKAO_KEYS` (JSON array of nonempty
strings) and `GEOCODER_GOOGLE_KEY`. Endpoints: `GEOCODER_KAKAO_BASE_URL` (default
`https://dapi.kakao.com`) and `GEOCODER_GOOGLE_BASE_URL` (default
`https://maps.googleapis.com`), validated by the transport rule with a root path. The Google key
fingerprint rule (`ecd5fdb1`) applies when the Google endpoint is the production endpoint, as
legacy skips it only for a test endpoint. Limits: `SERVER2_GEOCODER_KAKAO_DAILY_UNITS` (per
Kakao key) and `SERVER2_GEOCODER_GOOGLE_DAILY_UNITS`, required when that provider has a usable
key; at least one provider key is required. `FundedQuota` funds every possible attempt of a
lookup from one S08 window per UTC day and per key, before HTTP; it opens a new budget store
when the day changes and never refunds. The quota owner of a key is
`sha256("server2-geocoder-quota-v1" 0x00 provider 0x00 key)` in lowercase hex, so it follows
key rotation without a separate setting and is not the legacy log fingerprint. Without a quota
the geocoder denies every acquisition (`DenyQuota`).

R5. Native world (`dsf` listed). `VC_SECRET_KEY`, `SERVER2_WORLD_VC_DAILY_UNITS`,
`SERVER2_WORLD_VC_QUOTA_ID` are required; `SERVER2_WORLD_VC_URL` defaults to the legacy
`https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/`.

R6. Native world air. The world always uses `LiveAir`. A provider is active when
`SERVER2_WORLD_AIR_<P>_KEY` (P = `GOOGLE`, `OPENWEATHER`, `WAQI`) is set; then
`SERVER2_WORLD_AIR_<P>_MONTHLY_UNITS` and `SERVER2_WORLD_AIR_<P>_QUOTA_ID` are required and
`SERVER2_WORLD_AIR_<P>_URL` defaults to the legacy endpoint root (`https://airquality.googleapis.com/`,
`https://api.openweathermap.org/`, `https://api.waqi.info/`). A key that legacy treats as
unconfigured leaves that provider out. With no active provider the output is the legacy
`no-provider` air output. A request uses memory, then S3 records of the cell, then the chain.

R7. Seed importers. `history_seed_import SEED_FILE...` and `warning_seed_import SEED_FILE`
read the R3 settings from their environment and accept any endpoint that the transport accepts.
Usage and errors never print credentials.

## Failure behavior

Every invalid or missing required setting fails startup with the existing
`invalid gateway configuration` error before a listener binds. An S3 or budget failure denies
geocoder acquisition (no provider call) while memory hits still serve. A world funding or S3
failure follows the existing S11/S13a paths.

## Alternatives rejected

- Renaming `SERVER2_GEOCODER_MODE` values to `legacy|native`: keeps a mode variable per family.
- Explicit geocoder quota-id lists aligned with `GEOCODER_KAKAO_KEYS`: misalignment silently
  moves usage between keys; a derived owner follows the key.
- Reusing `AWS_*` names for S3: an injected legacy `.env` can carry legacy AWS values.
- Keeping `LiveAir::restore_only` for tests: it is the removed restore mode; tests prove S3
  restore with providers configured and a transport double that must not be called.

## Verification strategy

Red: a gateway runtime test builds a native geocoder and native world with HTTPS endpoint
configuration and no mode variable (fails on the base). Green: geocoder funding tests over a
volatile budget peer; runtime configuration tests (defaults, required limits, routing list,
legacy selection); world/air tests rebuilt from `from_vars` against test peers; existing
golden tests. Smokes: `gateway_smoke.py`, `world_smoke.py` (with a WAQI air stub) and
`deploy/smoke.sh` on the release binary with real-format configuration pointing at test peers.
A repository grep proves that no runtime path reads the removed names.
