# Geography, search and media dependencies

[Manual index](README.md) · [Inventory](inventory.json) · [Platform SDKs](platform.md)

Reviewed on 2026-10-24 at `82f7a4838dda046be966ee9c25c9cb66561d099d`. Public geocoder, domestic address-to-grid conversion, legacy world timezone lookup and client search have different provider order and bounds. They must not be documented as one interchangeable fallback.

## Operation reference

| ID / operation | Auth and request | Fields consumed / call evidence |
| --- | --- | --- |
| GEO-GOOGLE-FORWARD **GET** `https://maps.googleapis.com/maps/api/geocode/json` | `key`, `address`, optional `language`; public gateway `GEOCODER_GOOGLE_KEY`, product `GOOGLE_SECRET_KEY` | `status,results[0].geometry.location.lat/lng,address_components[].types/short_name/long_name,formatted_address`; [gateway](../../../server/lib/geocoder/google.js#L245), [server2](../../../server2/src/geocode/mod.rs#L699), [legacy name normalization](../../../server/controllers/geo.controller.js#L713) |
| GEO-GOOGLE-REVERSE **GET** same JSON path | `key,latlng={lat},{lon}`, optional `language` | Country/address/label and same result fields; [gateway](../../../server/lib/geocoder/google.js#L236), [server2](../../../server2/src/geocode/mod.rs#L688) |
| GEO-GOOGLE-XML **GET** `https://maps.googleapis.com/maps/api/geocode/xml` | `key,address,language=ko`; product key | XML `status,result.geometry.location.lat/lng`; domestic address-to-grid fallback [legacy](../../../server/utils/convertGeocode.js#L170), [server2](../../../server2/src/geocode/town.rs#L113). Offline list utility also uses this operation. |
| GEO-KAKAO-REGION **GET** `https://dapi.kakao.com/v2/local/geo/coord2regioncode.json` | `x=lon,y=lat,input_coord=WGS84`; header `Authorization: KakaoAK {key}`; gateway `GEOCODER_KAKAO_KEYS`, product `KAKAO_SECRET_KEYS` | `meta.total_count,documents[].region_type=H,region_1/2/3/4depth_name,address_name`; Korean `kmaAddress` and label. [Legacy](../../../server/lib/geocoder/kakao.js#L81), [server2](../../../server2/src/geocode/mod.rs#L679) |
| GEO-KAKAO-ADDRESS **GET** `https://dapi.kakao.com/v2/local/search/address.json` | `query`; same Kakao header/key lists | First document `x/y`; [public gateway](../../../server/lib/geocoder/kakao.js#L86), [town conversion](../../../server/utils/convertGeocode.js#L29), [server2](../../../server2/src/geocode/town.rs#L107) |
| GEO-KAKAO-TM **GET** intended `https://dapi.kakao.com/v2/local/geo/transcoord.json` | `x,y,input_coord=WGS84,output_coord=TM`; product Kakao key | `meta.total_count,documents[0]`; [station-search invoker](../../../server/controllers/kecoController.js#L506) → [builder](../../../server/lib/kecoRequester.js#L868). **Observed limitation:** builder appends `&x=` without an initial `?`; not verified working. No explicit axios timeout there. |
| GEO-GOOGLE-TIMEZONE **GET** `https://maps.googleapis.com/maps/api/timezone/json` | `key,location={lat},{lon},timestamp` epoch seconds | `rawOffset+dstOffset` seconds → minutes in [timezone controller](../../../server/controllers/timezone.controller.js#L362), hours in [old requester](../../../server/controllers/worldWeather/controllerRequester.js#L316). Legacy world/maintenance use; server2 VC supplies its own timezone. |
| GEO-PLACES **SDK** Maps JavaScript loader `https://maps.googleapis.com/maps/api/js` + legacy `AutocompleteService.getPlacePredictions()` | `libraries=places`, optional key `clientConfig.googleapikey`; `{input,types:['(regions)'],componentRestrictions:{}}` | Prediction descriptions selected by search UI; [loader](../../../client/www/js/service.util.js#L70), [search](../../../client/www/js/controller.searchctrl.js#L24). Current shared client; not Places New REST. |

Official specifications: [Google geocoding](https://developers.google.com/maps/documentation/geocoding/requests-geocoding), [Google Time Zone](https://developers.google.com/maps/documentation/timezone/requests-timezone), [Kakao Local](https://developers.kakao.com/docs/latest/ko/local/dev-guide), [legacy Places Autocomplete](https://developers.google.com/maps/documentation/javascript/legacy/place-autocomplete). These specifications describe the provider; source links describe our subset and quirks. Do not copy a malformed source URL as a recommended request example.

## Provider order, failure and cache

Public gateway ([legacy orchestration](../../../server/lib/geocoder/index.js#L126)):

- **Forward address**: Google first, Kakao after non-abort failure.
- **Reverse outside Korea rectangle**: Google directly.
- **Reverse inside rectangle**: Kakao first, then Google can supplement partial fields or non-Korean language. An outer Kakao failure terminates this path; it is not an unconditional Google fallback.

Legacy gateway bounds are three seconds/provider attempt and five seconds/lookup; configured keys are tried once each, starting at a randomized position. Auth/quota/transient failures can rotate; terminal request errors stop. Cache freshness is 30 days and writes are best effort. Google body status matters even for HTTP 200. Kakao recognizes HTTP auth/quota and body error codes, including code −10 for quota. server2 uses its own three-second/1 MiB transport and acquisition/budget state ([native orchestration](../../../server2/src/geocode/mod.rs#L589)).

Town address conversion is **Kakao address → Google XML**, with separate selected-key quota/deadline; it is not the public gateway order. Legacy `geo.controller.js` also retains older paths: Google normalization up to three retries/five seconds each, Kakao region key traversal with no explicit axios timeout. Record the caller before inferring one common timeout.

Kakao `x/y` and Mongo geographic arrays are **longitude/latitude**. Public client `loc` is latitude/longitude. Some provider numeric values arrive as strings; preserve the existing adapter's normalization and ordering rather than coercing all paths identically.

Timezone lookup caches DB results, may geocode an unknown timezone first, and updates asynchronously. Its main Google call timeout is ten seconds; the old world requester uses 20 seconds. Maintenance is declared every 15 days and wired by the manager. `rawOffset` and `dstOffset` apply to the requested timestamp, not a permanently correct offset for every future date.

Places handles transport/auth inside the SDK. App callback keeps `OK`, ignores `ZERO_RESULTS`, logs other statuses, with no JS timeout/retry. The web PWA uses its local location catalog and first-party geocode API, not this Places loader ([web adapter](../../../web/src/direct-api.ts#L121)).

## Native and media boundaries

Tracked applewatch and widget sources have older direct Google JSON callers with no appended key in those builders. Only applewatch reverse geocoding adds `sensor=true&language=ko`; its forward builder and the inspected widget builders do not. They reuse GEO-GOOGLE-FORWARD/REVERSE with **historical-native** status, not current shared-client auth policy. See [native variants](retired.md#historical-native-services).

No application-specific Flickr or VWorld API invocation was established. AirKorea station-map/photo URLs in model examples are assets, not a separate photo-search API. Branch example images are fixture content, and Branch link generation is a conditional SDK integration documented under [platform](platform.md#deep-links-and-os-sharing). Weather photo UI/event names alone are not proof of a remote media provider.

KAQ/AirKorea forecast-image fetching and parsing are covered under [weather inputs](weather-air-life.md#air-forecast-gifs-and-kaq). Links to KMA, Visual Crossing, earth.nullschool, stores, Facebook or support mail open external pages/OS applications; they are not additional weather/geocoding JSON integrations.
