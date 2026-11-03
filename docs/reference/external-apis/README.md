# External API manual

This manual describes every external service operation found with an application caller in the checked-out TodayWeather repository, plus explicitly separated inactive integrations. It covers KMA, other weather and air providers, astronomy, geocoding, mobile SDKs, push, storage and operational support. It is an integration manual for this codebase, not a catalog of every operation offered by each provider.

**Source baseline:** `82f7a4838dda046be966ee9c25c9cb66561d099d`, reviewed on **2026-10-24 KST**. “Wired” describes source invocation; it does not establish production deployment, a working credential, account entitlement or current provider availability. TodayAir is retired; its remaining native source is historical evidence.

## Read by purpose

| Document | Contents |
| --- | --- |
| [KMA](kma.md) | Grid observations/forecasts, mid-range products, forecast zones, ASOS, UV/pollen, six warning operations, RSS and observation pages |
| [Weather, air and life](weather-air-life.md) | AirKorea, forecast GIFs/KAQ, Google/OpenWeather/WAQI/VC air, Visual Crossing weather, MFDS risk and KASI astronomy |
| [Geography and media](geography-media.md) | Google/Kakao forward/reverse geocoding, coordinate conversion, timezone, Places and media dependency boundaries |
| [Platform services](platform.md) | FCM/OAuth, client Firebase services, AdMob/UMP, OpenAI notice translation, S3/IMDS/CloudFront and log shipping |
| [Legacy and inactive integrations](retired.md) | Still-wired older routes, historical native Ionic calls, retired APIs, unused adapters and research-only KMA alternatives |
| [Machine-readable inventory](inventory.json) | Stable IDs, endpoint/auth/request/response summary, per-consumer wiring, source anchors and official links |
| [Review evidence](../../evidence/research/external-api-inventory-2026-10-24.md) | Retrieval/version/hash register, coverage method, checks and unresolved documentation gaps |

The [internal product endpoint catalog](../../rewrite/api-endpoint-catalog.md) documents APIs exposed by our own service. The [mobile flow](../../architecture/mobile-api.md), [collection flow](../../architecture/weather-collection.md), [server2 architecture](../../architecture/server2.md) and [Korean acquisition/S3 proposal](../../architecture/server2-kma-data-design.md) describe how these dependencies are assembled. This manual adds provider contracts; it does not change them.

## Status and counting rules

| Status | Meaning |
| --- | --- |
| `wired` | A checked-out application call chain invokes the operation |
| `conditional` | Invocation requires a mode, flag, selected native route, credential, budget or installed SDK |
| `legacy_route` | Invoked by an older retained route; not the modern default provider path |
| `historical_native` | Actual caller exists in a tracked older native bundle; current shared builds need not use it |
| `adapter_only` / `utility_only` | Builder/helper exists; no current application invocation established |
| `retired` | Explicitly removed, disabled or stopped before network acquisition |
| `research_only` | Reviewed as an option; no runtime adapter/caller established |
| `os_delegated` | Calls the operating system, such as the share sheet; no specific third-party HTTP API is implied |

Multiple routes, keys, pages and native copies of one provider operation are not separate APIs. Forward and reverse geocoding share a URL but have different request semantics and are separate inventory entries. SDK rows group their named methods; they do not enumerate undocumented SDK-internal hosts. Research groups are not included in a “currently used API” total. The inventory records per-consumer status to avoid treating a server2 adapter as a legacy production collector, or a historical native caller as a current shared-client dependency.

## Common integration rules

- Keep **publication time**, **valid/observation time** and **fetch time** separate. KMA and Korean public datasets generally use KST text; Unix epochs denote instants. Preserve provider-local timezone and per-row DST offsets for world weather.
- Keep missing, rejected-QC and qualitative values distinct from numeric zero. Preserve original precipitation text. A daily official minimum/maximum is not the minimum/maximum of an incomplete hourly sample.
- A successful HTTP status is insufficient. Validate provider status/envelope, identity, requested publication, rows/categories and all pages before publishing a complete acquisition. Pagination and retry policies differ by family.
- Credential names below are configuration interfaces only. Never copy keys, service-account JSON, signed URLs, device tokens, private bucket names or complete authenticated requests into logs or docs. Query credentials must be encoded once; casing such as KASI `ServiceKey` is significant.
- Configured timeout, retry, cache TTL and quota are **local policies**, not measured p95/p99 or provider SLAs. This review made no authenticated data requests or latency measurements. Provider access approval, license/attribution obligations and actual remaining quota must be checked for the operating account before enabling acquisition.

## Main credential and prerequisite map

| Consumer | Configuration names / prerequisite |
| --- | --- |
| KMA point/mid/zones/UV/pollen/warnings; KASI | `DONGNAE_SECRET_KEYS` JSON list. Obsolete normal/test-key variables are not fallback credentials. APIHub `authKey` is a separate provider interface, not this query name. |
| Legacy ASOS history | `ASOS_HISTORY_SERVICE_KEY`; scheduled/read gates `ASOS_HISTORY_ENABLED`, `ASOS_HISTORY_READ_ENABLED`; station allowlist `ASOS_HISTORY_STATIONS`. server2 ASOS uses `DONGNAE_SECRET_KEYS`. |
| AirKorea | `AIRKOREA_SECRET_KEYS` JSON list |
| World weather / optional legacy VC air | `VC_SECRET_KEY`, local `VC_DAILY_RECORD_LIMIT` |
| Global air | `GOOGLE_SECRET_KEY`, `OWM_SECRET_KEY`, `WAQI_SECRET_KEY`; paid legacy phase explicitly gated |
| Public geocoder | `GEOCODER_GOOGLE_KEY`, `GEOCODER_KAKAO_KEYS`; product/town paths also use `GOOGLE_SECRET_KEY`, `KAKAO_SECRET_KEYS` |
| Client Places | `clientConfig.googleapikey`; Maps JavaScript/legacy Places library |
| FCM | Product service-account configuration; server2 `SERVER2_FIREBASE_TODAYWEATHER`, `SERVER2_FIREBASE_TODAYAIR`. Client native Firebase platform configuration and permission/token required. |
| Notice translation | `OPENAI_SECRET_KEY`, `TRANSLATION_LLM_MODEL`, optional `TRANSLATION_LLM_REASONING_EFFORT` |
| S3 / CloudFront | `AWS_ACCESS_KEY`, `AWS_SECRET_KEY`; native server2 can obtain instance-role credentials through IMDSv2. `SERVER2_S3_BUCKET`, `SERVER2_S3_REGION`; KAQ has separate bucket/region configuration. |
| Mobile advertising / Firebase | Selected Cordova plugins and platform configuration; release ad-unit names in [platform reference](platform.md#advertising-and-client-telemetry) |
| Logentries | `LOGENTRIES_GATHER_TOKEN`, `LOGENTRIES_SERVICE_TOKEN`, selected by `SERVER_MODE` |

## Scope boundaries and maintenance

The review covered application callers in `server/`, `server2/`, shared `client/www/`, `web/`, and tracked iOS/widget/applewatch variants. Source-only AWS deployment tools, package download URLs, licenses/examples, unused vendor SDK methods, OS/store/social website navigation and first-party ingress are not additional runtime provider APIs. The historical Ionic SDK methods with confirmed app invokers are included explicitly. No direct Flickr/VWorld/SNS submission caller was found; photo-related UI names do not establish such integrations.

Update the affected page and `inventory.json` when a provider operation, auth source, consumed field, mode/flag, request bound or fallback changes. Recheck actual request builders and callers; old catalogs and deployed snapshots are revision-bound. Keep public specification facts separate from source quirks and dated observations. See the evidence record for known gaps rather than interpreting an unavailable old documentation page as a failed data API call.
