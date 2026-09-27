# Spec: serve `/weather` and `/geocode` from tw-svc (#2606)

- Intent: [intent/issue-2606.md](../intent/issue-2606.md).
- Facts: `reports/sdlc/issue-2606/investigation.md` (design-task evidence, not in the repository).
- Test scenarios: [specs/issue-2606-test-scenarios.md](issue-2606-test-scenarios.md).
- Issue: [#2606](https://github.com/WizardFactory/TodayWeather/issues/2606) and its [scope comment](https://github.com/WizardFactory/TodayWeather/issues/2606#issuecomment-5846716189).
- Revision 12 (2026-09-27, implementation task `issue-2606-impl`; amended the same day with AK's single-Google-key decision, §3.5): applies the round-11 LOW items carried from the design task, routes the gateway log lines to stdout/stderr (§5.4), and lists the multi-segment address deviation (§2.5).
- Revision 11 (2026-09-26): AK decided to keep the Lambda's `Accept-Language` rule (§9); review round 10 LOWs applied.
- Revision 10 (2026-09-26): language, `loc` parsing and backend retries now match the Lambda exactly; per-version parity uses the clients' real queries and headers; rollback checks use the Lambda-era baseline (review round 9).
- Revision 9 (2026-09-26). This revision reduces the design to what the goal needs, as AK decided on 2026-09-26. Operational hardening from review rounds 1–8 moved to §9 (follow-ups). Internal callers change their URL only (option A). Per-version behavior is stated explicitly (§3.1). Earlier revisions and reviews are under `reports/sdlc/issue-2606/`.

## 1. Goal and non-goals

**Goal.** CloudFront sends public `weather/*` and `geocode/*` requests straight to the service EC2 (Express, tw-svc) instead of API Gateway → tw-backend-functions Lambda. For every route in §2.1, each client (app, web, widgets, unidentified callers) receives the same successful responses as today **for each API version**, with no client change. The Lambdas stay deployed and unchanged, as the rollback target.

**Non-goals** (separate issues if wanted): decommissioning the Lambdas or DynamoDB tables; migrating the DynamoDB cache; client changes; changing the KMA/DSF backend chains; TLS on the CloudFront→origin leg; origin lock-down; the items in §9.

## 2. Route contract

### 2.1 Implemented routes

Scope rule (AK): an API with 0 requests in the 30-day CloudFront window ending 2026-09-22 is unused and excluded; every API with at least one request is kept.

| ID | Method and path | 30-day requests | Behavior |
| --- | --- | ---: | --- |
| R1 | `GET /weather/coord/{loc}` | 155,998 | Weather with the Lambda's default version `v000901` (§3.1) |
| R2 | `GET /weather/{v}/coord/{loc}`, `v` ∈ {`v000901`, `v000902`, `v000903`} | 51 / 47 / 39,254 | Weather with version `v` (§3.1) |
| R3 | `GET /geocode/v000903/coord/{loc}` | 209 | Coordinate geoinfo (§3.2) |
| R4 | `GET /geocode/{v}/addr/{address…}`, `v` ∈ {`v000901`, `v000903`} | 1 / 39 | Address geoinfo (§3.3). `{address…}` is the rest of the path |
| R5 | `OPTIONS` under `/weather` or `/geocode` | — | CORS preflight, answered by the existing `cors()` (204) |

`HEAD` on R1–R4 is answered by Express's GET handling without a body.

### 2.2 Excluded shapes (X1)

Every other path that is exactly `/weather` or `/geocode`, or starts with `/weather/` or `/geocode/`, returns `404`, `text/plain`, body `Not Found`, `Cache-Control: no-store`. Examples: `/weather/addr/x`, `/weather/{v}/addr/x`, unversioned `/geocode/coord/x` and `/geocode/addr/x`, `/geocode/v000901/coord/x`, `/geocode/v000902/...`, `/weather/v000803/coord/x`, `POST /weather/coord/x`. All had 0 requests in the window.

### 2.3 Input rules

- **`loc`:** split the decoded path segment on `,` and use the first two parts, as the Lambda does (extra parts are ignored); convert each with `Number()`, as the Lambda does; both must be finite; latitude within ±90 and longitude within ±180, otherwise `400`. Normalize each with `parseFloat(x.toFixed(3))`, as the Lambda does (`37.5665` → `37.566`). A normalized `(0,0)` returns `404`, as in the Lambda.
- **`address`:** the rest of the path, decoded once by Express; empty or longer than 200 characters → `400`.
- **Malformed percent-encoding** → `400` (a 4-argument error handler in the router, §4.1).
- **Query (R1/R2):** forwarded to the backend with the same key/value pairs the Lambda forwarded. API Gateway gave the Lambda one value per key (the last), so: parse the raw query string, keep the last value per key in first-appearance order, and re-encode each key and value with `encodeURIComponent`. The pairs are the same as the Lambda's whenever decoded values contain none of `&`, `=`, `#`, `+` or `%` (true for every real client query); for such values the Lambda's raw re-append broke them, and the encoded form preserves them.
- **Language:** exactly the Lambda's value: the raw `Accept-Language` header up to its first `-` (the whole header if it has none), case unchanged; `en` if the header is absent. Examples: `ko-KR,ko;q=0.9` → `ko`; Chrome's `ko,en-US;q=0.9,en;q=0.8` → `ko,en`; `KO-KR` → `KO`; `ko_KR` → `ko_KR`. The same value goes to the geocoder (so `ko,en` is not `ko` and drops Kakao's label, as in the Lambda), into the cache key, and as the backend `Accept-Language`. It is never rewritten, only encoded with `encodeURIComponent` wherever it enters a URL. A value longer than 64 characters is replaced by `en` (the only deviation; browsers do not send such values before the first `-`).

### 2.4 Response rules

| Case | Status | Headers | Body |
| --- | --- | --- | --- |
| R1/R2 success | 200 | `application/json; charset=utf-8`, `Cache-Control: max-age=300`, `Access-Control-Allow-Origin: *` | Backend JSON with geo fields merged (§3.1) |
| R3/R4 success | 200 | Same, `Cache-Control: max-age=2592000` | Geoinfo (§3.2, §3.3) |
| Invalid input | 400 | `text/plain`, `Cache-Control: no-store`, ACAO `*` | `Bad Request` |
| `(0,0)` or X1 | 404 | Same | `Not Found` |
| Geocoder, backend or deadline failure | 501 | Same | `Not Implemented` (501 kept for parity) |
| In-flight limit reached (§5.3) | 503 | Same, plus `Retry-After: 5` | `Service Unavailable` |

Error bodies never contain URLs, hostnames, provider names, keys or stack traces. These routes never set cookies. CloudFront keeps compressing responses (`Compress=true`).

### 2.5 Deliberate deviations from the Lambda

None of these changes a successful response for real client requests within normal latency; the rows marked as such describe the rare exceptions.

| Lambda behavior | New behavior | Why safe |
| --- | --- | --- |
| Error body `Error: url=…` (internal host) | Generic text | Clients treat every non-2xx alike and do not parse error bodies |
| Non-numeric `loc` → 501 | 400 | Same client handling; not sent by known clients |
| Excluded shapes → 501 or a backend result | 404 | 0 requests in 30 days |
| Errors had no `Cache-Control` | `no-store` | Fresher retries |
| Latitude/longitude out of range and addresses over 200 characters were passed to the providers | 400 | Not produced by any known client |
| Malformed percent-encoding | nginx answers its own HTML 400 before Express; behind nginx the router answers `text/plain` 400 | 0 such requests; no client parses error bodies |
| Slow requests: no overall deadline before the 29 s API Gateway limit; the same Google key retried up to 3 times | 9 s overall deadline including geocoding; each key tried once | A request that needed more than 9 s or a retried key could now give 501 instead of 200; the app gives up after 10 s anyway (§3.5) |
| Any `Accept-Language` value used | A value longer than 64 characters before its first `-` becomes `en` | Not sent by browsers or the apps |
| Dark Sky reverse-geocoding fallback | Removed (#2601); a coordinate result without `label` or `address` → 501, as when Dark Sky failed | Its failures already gave 501 |
| Kakao address branch always failed | Works, output reduced to `{country, address, location}` | An answer where there was a 501 |
| Backend retried on any error, including 4xx | 4xx is not retried; 9 s overall deadline | A 4xx gave 501 after 3 attempts and still gives 501 |
| Backend redirects were followed | A 3xx → 501 | The only redirect in the chain (a town outside the Korea box → public `/weather/coord`) cannot occur for towns from the geocoder |
| `{address}` was one path segment, so an address with a raw `/` failed at API Gateway | The rest of the path is the address | An error becomes an answer |
| `OPTIONS` 200 from an API Gateway mock with a static `Access-Control-Allow-Headers`; `HEAD` failed | `OPTIONS` 204 from `cors()` (CloudFront does not forward `Access-Control-Request-Headers`, so no allow-headers list); `HEAD` like `GET` without body | Clients send only safelisted headers and no `OPTIONS` was seen in 30 days; clients do not send `HEAD` |
| No `ETag` | Express adds `ETag` (304 possible) | Existing Express routes already do this |

## 3. Behavior

### 3.1 Weather (R1/R2) and version handling

**Versions.** In the Lambda, the path version (R1: the default `v000901`) is used **only** to build the backend path; the geocoding and the field merge are the same for every version (tw-backend-functions `1b489a9`, `weather/function.weather.js`). The per-version differences in the response come from tw-svc's own version routers, which the new route reaches with exactly the same path:

| Public path | Backend path (KR) | Backend path (other) | tw-svc handler (`server/routes/{v}/index.js`) |
| --- | --- | --- | --- |
| R1 `/weather/coord` | `/v000901/kma/addr/…` | `/v000901/dsf/coord/…` | `v000901/route.kma.addr`, `v000901/route.dsf.coord` |
| R2 `v000901` | `/v000901/kma/addr/…` | `/v000901/dsf/coord/…` | same as R1 |
| R2 `v000902` | `/v000902/kma/addr/…` | `/v000902/dsf/coord/…` | `v000902/route.kma.v000902`, `v000902/route.dsf.coord.v000902` |
| R2 `v000903` | `/v000903/kma/addr/…` | `/v000903/dsf/coord/…` | `v000903/route.kma.v000903`, `v000903/route.dsf.coord.v000903` (since #2585) |

The non-KR `dsf/coord` chains call Visual Crossing since #2585. Their 2.5 s request budget (`dsf.controller.js`) was sized to fit the 3 s per-attempt timer, which the gateway keeps (§3.1 step 3), so do not shorten the attempt timer below 3 s.

So the design requirement is: **for each version, the backend request (path, query, `Accept-Language`) equals the one the Lambda sends, and the backend response is passed through with the same merge.** Nothing in the new route may branch on the version other than building the path. The backend's per-version outcome, including its errors, is reproduced: today `/weather/v000901/coord` answered 501 on 45 of 51 requests, and the new route must return the same status as the Lambda for the same request, apart from the §2.5 deviations (DO-1).

Steps:
1. Parse the inputs (§2.3) and resolve `geo = geocoder.coord([lat, lon], lang)` (§3.4).
2. Backend path:
   - `geo.country === 'KR'`: `/{v}/kma/addr/{enc(name1)}[/{enc(name2)}][/{enc(name3)}]` from `geo.kmaAddress` (`encodeURIComponent`; `name2`/`name3` appended when non-empty, the Lambda rule). An empty `name1` → 501.
   - Otherwise: `/{v}/dsf/coord/{lat},{lon}` with the normalized coordinates.

   Append the query (§2.3).
3. **Loopback** GET to `http://{config.ipAddress}:{config.port}{path}` (the PM2 cluster port, so any worker may answer; nginx and CloudFront are bypassed), with `Accept-Language: {lang}` and `Accept: application/json`.
   - Like the Lambda: up to 3 attempts of 3 s each (a total timer, not only `request`'s idle `timeout`), retried after a timeout, a connection error or a 5xx. Unlike the Lambda, a 4xx is not retried (same 501 outcome), and no attempt starts or runs past the 9 s request deadline.
   - Redirects are not followed; a 3xx → 501. (A backend redirect would point at the public `/weather/coord` and could loop.)
4. On a 200 JSON body, merge like the Lambda `importGeoInfo`: `name` ← `geo.name`, `country`, `address`, `location` ← `geo.location`, each when present, overwriting keys of the same name. Respond per §2.4.
5. Any other backend result, or the 9 s request deadline → 501.

### 3.2 Coordinate geoinfo (R3)

The body is built exactly as the Lambda `byCoord` builds it: `name` (from `label`), `country`, `address`, `location {lat, long}`, in that order, each only when present, then `kmaAddress` when present. Nothing else (`lang`, `updatedAt`, `_id`). The geocode output does not depend on the version: the Lambda ignores the geocode path version.

### 3.3 Address geoinfo (R4)

`{country?, address: <decoded request string>, location}`, as the Lambda `byAddr` returns for Google results. Same for `v000901` and `v000903`.

### 3.4 Geocoder module (`server/lib/geocoder/`)

Ported from tw-backend-functions `a4c1deb` (`geoinfo/controller.kakao.js`, `controller.google.js`, `controller.geoapi.js`, `function.geoinfo.js`). Output-shaping code is copied unchanged; each file cites its source. Only the transport changes (timeouts, key rotation, numeric parsing of Kakao `x`/`y`), and Dark Sky and Daum are removed.

- **Coordinate flow**, with the Korea box checked on the normalized coordinates (lat 32.6942–39.3769, lon 123.9523–131.88), as in the Lambda:
  - Inside: Kakao (an error → 501). If `lang !== 'ko'`, drop Kakao's `label`, `address` and `lang`. If `label` or `address` is missing, call Google and fill only the missing keys; if Google fails, keep the result.
  - Outside: Google (an error → 501).
  - A result without `label` or `address` → 501, not cached.
  - A KR result without `kmaAddress` is returned (R3 200, like the Lambda) but not cached; R1/R2 then give 501 (empty `name1`).
- **Address flow:** Google, then Kakao if Google fails; `loc` normalized to 3 decimals; no location → 501.
- **Interface:** `coord(loc, lang)` and `addr(address, lang)` return promises of the client-shape object, and reject with `EINPUT`, `ENOTFOUND` or `EPROVIDER`.

### 3.5 Provider keys and timeouts

- Every provider request has a 3 s total timer; the geocoder as a whole has 5 s.
- Provider base URLs default to the real endpoints; `GEOCODER_KAKAO_BASE_URL` and `GEOCODER_GOOGLE_BASE_URL` override them for the offline tests and LD-1 only.
- Keys come from `process.env`: `GEOCODER_KAKAO_KEYS` (a JSON array of strings; unset or unparseable counts as no key) and `GEOCODER_GOOGLE_KEY` (one key). A missing provider key makes that provider unavailable (501 on use); nothing throws at load. Dedicated names keep the existing `KAKAO_SECRET_KEYS`/`GOOGLE_SECRET_KEY` users (KECO station lookup, time zone, `geo.controller`) unaffected.
- **Kakao:** `GEOCODER_KAKAO_KEYS` holds the two keys the Lambda and the service host already use (both answer the coordinate and address APIs, checked 2026-09-27). Start at a random key and try each key at most once. Move to the next key on auth errors (401/403 or an auth error code), quota errors (429 or a quota error code) and transient errors (timeout, network, 5xx). An empty result (no documents) or another request error ends the attempt.
- **Google (AK, 2026-09-27):** a single key and no rotation. The code uses `GEOCODER_GOOGLE_KEY` only if its fingerprint (first 8 hex digits of its SHA-256) is `ecd5fdb1` (`lib/geocoder/keys.js`); any other value is ignored and logged by fingerprint only. Using another Google key needs a code change. Any Google error, including `ZERO_RESULTS`, ends the lookup, because there is no other key. (The check is skipped only when `GEOCODER_GOOGLE_BASE_URL` points the geocoder at a test stub.)
- **Key values** go only into the service host's environment for `www` (for example `server/.env`, which `config/env.js` loads, or the PM2 environment, then `pm2 save`); never into the repository or logs. Log lines mask the Google `key=` parameter. Each worker logs the fingerprints of its keys once, when it handles its first gateway request; if the Kakao list is empty or the Google key is missing or ignored, the line goes to stderr.

### 3.6 Cache (MongoDB)

- Model `GeocodeCache` on the existing mongoose 5.1.2 connection: `_id` (key), `kind`, `lang`, `geoInfo` (Mixed; the provider result), `updatedAt`.
- Keys: `c:{lat3},{lon3},{lang}` (e.g. `c:37.566,126.978,ko`) and `a:{decoded address}`.
- TTL index `{updatedAt: 1}`, `expireAfterSeconds: 2592000` (30 days), created in callback form once the connection is open; an index error is logged, never thrown.
- Read: skipped when `mongoose.connection.readyState !== 1`; otherwise native `collection.findOne({_id}, {maxTimeMS: 300})` raced against a 300 ms timer (a timeout is a miss). A hit is used only if younger than 30 days, and for KR only with `kmaAddress`. The client shape is rebuilt with the same builder as a miss.
- Write: after a successful resolution, `updateOne(..., {upsert: true}, cb)` when the connection is open; a failure never fails the request.
- The cache starts empty. CloudFront keeps serving its cached geocode (30 days) and weather (5 minutes) responses, which limits the initial provider load.

## 4. Server integration

### 4.1 Mounting

In `server/app.js`, directly after `app.use(cors())` and before `express-session`: `app.use(require('./routes/gateway'));`.
- The router handles `^/(weather|geocode)(/|$)` and calls `next()` for any other path.
- It ends every request it owns: after its routes come the X1 404 handler and a 4-argument error handler (decode errors → 400, anything else → 501). The app-level handlers take 3 arguments and are not error handlers, so the router needs its own.
- Mounted before the session middleware, so no session or `Set-Cookie`. The loopback request goes through the full existing stack, as the Lambda's request did.

### 4.2 Internal callers (option A: URL change only)

Four server callers use the unversioned public geocode paths, which X1 excludes. Each changes only its URL to the versioned path; all keep calling `config.apiServer.url` (the public host). Geocode output is version-independent (§3.2), so each caller receives the same object as today, before cutover (from the Lambda) and after (from R3/R4).

| Caller | Host | Change |
| --- | --- | --- |
| `controllerTown24h.coord2addr` (`kma/coord` in `v000902` and `v000903`) | service | `/geocode/coord/` → `/geocode/v000903/coord/` |
| `routes/v000903/route.geo.v000903.js` | service | same |
| `controllerPush._requestGeoInfo` | gather host (`tw-push`, `tw-alert-push` checkouts) | same |
| `lib/kmaScraper.js` fallback | gather | `/geocode/addr/` → `/geocode/v000903/addr/` |

`controllerTown._getUrlWithCoord` (302 to `/weather/coord/`, R1) is unchanged. Existing tests that assert the old URLs are updated with the change (plan step 3).

### 4.3 Replacement probe (`AttachEIPToSpot`)

When a spot replacement starts, `AttachEIPToSpot` moves the service Elastic IP only after the new instance answers `/health` and `/v000903/kma/coord/37.5665,126.9780` with fresh KMA data. That probe path runs `coord2addr`, which calls the public geocode API. After cutover the public geocode API is served by the service origin itself, which during a replacement is the stopped old instance, so the probe would fail and the EIP would never move.

Change the probe's data path to the KMA address route that the probe coordinate resolves to (`/v000903/kma/addr/{enc name1}/{enc name2}[/{enc name3}]`, taken from R3 for `37.5665,126.9780` on the direct origin). It returns the same `currentPubDate` and `current` fields and needs no geocoding. This is a one-constant change to the `AttachEIPToSpot` function (source kept outside this repository), deployed under A3 **before** cutover; it works with the Lambda path too. The constant must be the percent-encoded ASCII path: the probe's `http.client` rejects non-ASCII paths, and `ready()` would then report not ready for every replacement.

## 5. Operations

### 5.1 Approvals

Merging the implementation authorizes no production step. Each checkpoint needs AK's explicit approval:

| Checkpoint | Covers |
| --- | --- |
| A1 | Placing the provider keys on the host: the two existing Kakao keys and the Google key `ecd5fdb1` (§3.5) |
| A2 | Deploying to the service host, the URL change in the gather host's checkouts (§5.2 steps 1–2), and the direct-origin checks, which write cache records and spend provider quota (§5.2 step 3) |
| A3 | AWS changes before cutover: the probe path (§4.3), the AMI, launch template, spot fleet and `AttachEIPToSpot` target, the alarm (§5.2 steps 4–6) |
| A4 | The CloudFront cutover and, if needed, its rollback and the cache clean-up (§5.5, §5.6) |

### 5.2 Deployment (all before cutover)

1. **Service host (A2).** The host runs a patched legacy tree, so deploy by the established patch procedure: back up every touched file; copy the new files; apply the `app.js` mount line and the §4.2 URL changes; `node --check`; run the gateway offline tests on the host's Node; add the key variables to the PM2 environment; `pm2 reload www --update-env`; confirm the workers are `online` and `/health` answers; `pm2 save`. Record the deployment in `docs/operations/` now. On failure, restore the backup and reload. The gateway needs Node 16 or later (it uses the global `AbortController`). PM2's `www` interpreter was Node 16.20.2 when checked on 2026-09-27; the #2585 notes that mention Node 10.15.3 predate that check, so confirm the interpreter with `pm2 jlist` before deploying. The gateway offline tests (U, RT, IC) can run on the host with its installed dependencies; CI runs them too.
2. **Gather host (A2):** apply the `kmaScraper` URL change to the gather checkout and the `controllerPush` change to the `tw-push` and `tw-alert-push` checkouts on the same host (not running when last observed), the same way. They work with the Lambda too. A host-side grep confirms that no checkout still contains an unversioned `/geocode/(coord|addr)/` URL (OP-3).
3. **Direct-origin verification:** all DO-* pass, then OP-1 (test scenarios). Deploy #2585 (Visual Crossing) before DO-1 if non-KR success parity is to be proven; otherwise non-KR cells fail on both sides, DO-1 prints a warning, and PC-1 accepts them as unchanged or recovered (`--expect`).
4. **Probe path (A3):** deploy the §4.3 change; OP-3.
5. **Replacement image (A3).** Without it, a spot replacement starts old code and every `weather/*` and `geocode/*` request gets 404.
   - Record the rollback values privately: launch template versions, fleet `LaunchTemplateConfigs`, the complete `AttachEIPToSpot` variable map.
   - Service: `create-image --no-reboot`; new launch template version; `modify-spot-fleet-request` changing only the version (keep the subnet overrides); update `AttachEIPToSpot`'s `TARGET_AMI_ID` by submitting the **complete** variable map (`--environment` replaces the whole map).
   - Gather: new AMI and template version the same way; `AttachEIPToSpot` is not changed for it.
   - Any later code or key change on a host needs a new image the same way. OP-3.
6. **Alarm (A3):** a CloudFront `5xxErrorRate` alarm for the production distribution (> 10% for 3 × 5 minutes) notifying by email. CloudFront metrics live in us-east-1 and an alarm can only notify a topic in its own region, so this needs a us-east-1 SNS topic with a confirmed subscription. The existing alarms watch the Lambda and API Gateway and go quiet after cutover. OP-2.

### 5.3 Limits

| Limit | Value |
| --- | --- |
| Provider request | 3 s |
| Geocoder total | 5 s |
| Backend loopback attempt | 3 s, up to 3 attempts, capped by the deadline |
| Whole request | 9 s → 501 (below CloudFront's 30 s origin timeout) |
| In-flight requests per worker (`GATEWAY_MAX_INFLIGHT`, default 40) | Excess → 503 with `Retry-After: 5`. The slot is released exactly once, when the handler finishes or the deadline fires, independent of the connection state |

When the deadline fires, outstanding provider and loopback requests are aborted, but a geocode cache write that started before it may still complete (bounded at 500 ms, §3.6).

### 5.4 Monitoring

- The CloudFront 5xx alarm (§5.2 step 6).
- One log line per gateway request: route, version, cache hit/miss, provider, backend status, milliseconds, status. No keys, no coordinates beyond 3 decimals. These lines and the provider warnings go to stdout/stderr (PM2 logs): the app logger (`lib/log.js`) prints only errors when `NODE_ENV=production`, as on the service host.

### 5.5 Cutover (A4)

Change only the `TargetOriginId` of the `weather/*` and `geocode/*` behaviors to the service origin used by the default behavior. Everything else stays (forwarded query strings and headers, TTLs, compression, methods, response headers policy). Procedure: `get-distribution-config` and save it; edit the two fields; diff (CO-1), and prepare and diff the reverse edit for RB-1 at the same time; `update-distribution --if-match <ETag>`. No invalidation: DO-1 proves that successful bodies are the same.

### 5.6 Rollback

- **RB-1 (A4):** read the current config, set the two `TargetOriginId` fields back to the API Gateway origin, diff (only those two fields), submit. The Lambdas are untouched. Invalidate `/geocode/*` if wrong successful geocode bodies were served (30-day cache).
- After RB-1 the internal callers reach the Lambda again through the public host, so no code rollback is needed. If wrong geocode results were cached, delete `GeocodeCache` records with `updatedAt` ≥ the deploy time before the next cutover attempt.
- **Trigger:** CO-2 or PC-1 fails, or PC-3 or the 5xx alarm fails because of the new routes.
- **Rollback check:** RB-1 compares with the Lambda-era baseline recorded through the gateway before cutover (DO-3), not with the new route's headers (for example `OPTIONS` returns 200 again).
- The Lambda stack, API Gateway and the API origin stay in place until a separate decommission issue.

## 6. Security and privacy

- Generic error bodies; keys masked in logs; keys only in the host environment.
- No session or cookies on these routes.
- Input guards (§2.3) bound sizes; `lang` (at most 64 characters) and every other value enter URLs only through `encodeURIComponent`, so no header or path value can inject a query or path segment. The backend path is built only from geocoder output encoded with `encodeURIComponent`.
- The Mongo cache stores 3-decimal coordinate-to-address records per language, as the DynamoDB cache did.

## 7. Documentation

After cutover (separate PR, DOC-1): update `docs/architecture/mobile-api.md`, `docs/architecture/aws-code-correlation.md`, the `AGENTS.md` gateway constraint line, and the AWS infrastructure and mobile-request diagrams (Archify JSON, regenerated HTML) (and the Lambda-geocoder mentions in `docs/operations/visual-crossing-deploy.md`, and a "since #2606" note in `docs/operations/hourly-and-service-enrichment-restore-2026-09-25.md`) to show CloudFront → service EC2 for `weather/*` and `geocode/*`, with the Lambdas as rollback-only. With the implementation PR, add the new environment names to `docs/rewrite/configuration-inventory.md` (names only), and correct the code statements the change makes stale: the internal callers' geocode URLs (`service-overview.md`, `weather-collection.md`, `kma-station-observations.md`, `server-push-and-purchase.md`, `server-response-assembly.md`, `api-endpoint-catalog.md`, and the `coord2addr` label in `diagrams/server-domestic-assembly.json`, regenerated with Archify) and the statements that Express does not implement these paths (`service-overview.md`, `rewrite-playbook.md`, `api-endpoint-catalog.md`). Topology statements stay until cutover.

## 8. Requirements index

| Req | Statement | Section |
| --- | --- | --- |
| RQ1 | R1–R5 with the input and response rules | 2 |
| RQ2 | X1 → 404 | 2.2 |
| RQ3 | Per-version parity: backend request per version, pass-through, merge | 3.1 |
| RQ4 | Geoinfo output parity (R3, R4, cache hit = miss) | 3.2–3.4, 3.6 |
| RQ5 | Provider timeouts and key rotation; keys from dedicated env names | 3.5 |
| RQ6 | Cache rules and bounded reads/writes | 3.6 |
| RQ7 | Mounting, no cookies, own error handling | 4.1 |
| RQ8 | Internal callers (URL change only) | 4.2 |
| RQ9 | Replacement probe path | 4.3 |
| RQ10 | Deadline, retries, redirects, in-flight limit | 3.1, 5.3 |
| RQ11 | Deployment, replacement image, alarm | 5.2, 5.4 |
| RQ12 | Cutover and rollback | 5.5, 5.6 |
| RQ13 | No keys or internal hosts in responses or logs | 6 |
| RQ14 | Documentation | 7 |

The test-scenario document maps each requirement to scenarios.

## 9. Follow-ups and issue changes

**Follow-ups (not in this issue):**
- Provider health signal: shared counters, canary, a health route and a Route 53 check.
- Hardened PM2 environment handling and staged reloads.
- A scripted traffic re-check before cutover, and review of excluded-shape 404s after it.
- Detailed Kakao error-code classification and quota sizing from measured miss rates.
- Rotating the provider keys bundled in the Lambda configuration once the Lambdas are no longer needed (security; timing is AK's decision).
- Decommissioning the Lambdas, API Gateway and DynamoDB tables.
- Fixing the Lambda's `Accept-Language` cut (`ko,en-US;q=0.9` → `ko,en`), which this issue deliberately keeps (see below); fixing it changes `name`/`address` for such clients.

**Issue #2606 text to update** (applied to the issue body on 2026-09-26 and 2026-09-27; the scope-comment note remains informational):
- Internal callers: the issue says to switch `coord2addr` and `route.geo` to the in-process geocoder. AK chose option A: all four callers keep the public API and only switch to versioned paths (§4.2).
- Scope comment: its version list for the shared geocode handler (`v000901` for `coord`) conflicts with its own exclusion of `/geocode/v000901/coord`; the route-level traffic rule applies (R3 is `v000903` only).
- The acceptance item `grep -rn "apiServer.url + '/geocode" …` returns nothing" no longer applies; replace it with IC-1 (no unversioned gateway path).
- Key names: dedicated `GEOCODER_KAKAO_KEYS`/`GEOCODER_GOOGLE_KEY` instead of the shared names; a single Google key (§3.5).
- `Accept-Language`: the issue lists the Lambda's cut at the first `-` as a defect not to reproduce and asks for the primary subtag. AK decided on 2026-09-26 to keep the Lambda rule, so that successful responses stay identical for every client (`ko,en-US;q=0.9` keeps giving Google's name and address). The issue's required change and its defect list should say so; the fix is a follow-up.
- Fixture parity: compare fresh resolutions (DO-2) because the Lambda may answer from older DynamoDB records.
- Add the probe path change (§4.3) to the required changes.
- The docs item is met after cutover (DOC-1).
