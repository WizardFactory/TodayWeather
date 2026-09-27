# Test scenarios: #2606 direct CloudFront → tw-svc

- Spec: [specs/issue-2606.md](issue-2606.md) (revision 12). RQ, route (R1–R5, X1) and section references point there.
- Issue acceptance criteria: [#2606](https://github.com/WizardFactory/TodayWeather/issues/2606) and its [scope comment](https://github.com/WizardFactory/TodayWeather/issues/2606#issuecomment-5846716189).

A scenario passes only if its expected result is observed. A missing dependency, credential or prerequisite means **not run**, never passed.

## Layers

| Layer | Where | Prerequisites | Command | Side effects / cleanup |
| --- | --- | --- | --- | --- |
| **U** unit | Local or CI, no network | Offline harness (`server/test/offline/README.md`) | `node server/test/offline/gateway-geocoder.test.js` (in `run.js`); the parity script: `node scripts/gateway-parity.mjs --self-test` (loopback only) | None |
| **RT** route | Local or CI, loopback only | Harness plus `express@4.13.4`, `cors`, `express-session` (also added to the offline CI workflow) | `node server/test/offline/gateway-route.test.js` (in `run.js`) | Ephemeral 127.0.0.1 ports, closed at the end |
| **IC** internal callers | Local or CI | Harness | `node server/test/offline/gateway-callers.test.js` (in `run.js`) and the updated existing tests | None |
| **LD** local smoke | Linux machine | Node 16.20.2 (`NODE_BIN`); the full `server` install built for it (`SERVER_NODE_MODULES`; native `iconv`); a `mongod` 4.0.x binary; a temporary copy of `server/` without `.env`; stub providers; a network namespace with only loopback | `SERVER_NODE_MODULES=… MONGOD_BIN=… NODE_BIN=… unshare -rn sh -c 'ip link set lo up && node server/test/offline/gateway-local-smoke.js'` | Starts mongod (temporary dbpath) and `bin/www` (`SERVER_MODE=service`); all stopped and deleted at the end |
| **DO** direct origin | Operator shell | Spec §5.2 steps 1–2 done | `node scripts/gateway-parity.mjs --direct http://<service-origin> --gateway https://todayweather.wizardfactory.net` | About 300 GETs per side (DO-1 to DO-5; `--self-test` counts 294 checks), each with a unique `_twcb` query to bypass the CloudFront cache; the non-KR DO-1 cells bill Visual Crossing records (shared by both sides through the same backend cache); writes cache records on both sides; a few dozen provider calls |
| **CO/PC/RB** cutover | Operator with approval A4 | DO and OP passed | AWS CLI (spec §5.5, §5.6) | Changes two behaviors; RB reverts them |
| **OP** operational | Operator | Deployed build | Mongo shell, AWS CLI | Read-only, except OP-2's alarm-state test (A3) |
| **DOC** | Post-cutover docs PR | — | Link check, Archify validate | None |

Offline fixtures live in `server/test/offline/fixtures/gateway/`: provider responses (from tw-backend-functions `a4c1deb` test fixtures plus sanitized samples), **parity goldens** generated once by running the `a4c1deb` modules offline on the same fixtures (command recorded in the README), and backend samples for each version's `kma/addr` and `dsf/coord`. No fixture contains a key.

## U — geocoder (RQ4, RQ5, RQ6, RQ13)

| ID | Req | Scenario | Expected | Failure |
| --- | --- | --- | --- | --- |
| U-1 | RQ4 | Kakao reverse fixtures (Seoul, Jeju, an island county), `lang=ko` | R3 shape deep-equals the golden, key order included | Any difference |
| U-2 | RQ4 | Google reverse fixtures: KR with `lang=en`, New York, London | Deep-equals the golden | Any difference |
| U-3 | RQ4 | Google address fixture `서울특별시 송파구 잠실동`; Kakao address fixture with string `x`/`y` | `{country, address: input, location}` equals the golden; Kakao gives numeric 3-decimal `location`; no other keys | Differs |
| U-4 | RQ4 | Korea box on normalized coordinates: inside (32.695,124), (39.376,127), (35,123.953), (35,131.88); outside (32.694,124), (39.377,127), (35,123.952), (35,131.881) | Inside → Kakao; outside → Google | Wrong provider |
| U-5 | RQ4 | KR with `lang=en`: Kakao ok, Google fills `label`/`address`; then Google fails | Equals the golden; with Google failing, the Kakao result without label → 501 | Differs |
| U-6 | RQ4 | Google result without `formatted_address`; KR result without `kmaAddress` | First → `EPROVIDER`, not cached. Second → returned, not cached | Wrong status or caching |
| U-7 | RQ5 | Provider stub never answers; stub drips one byte every 500 ms | Each attempt aborted at 3 s total; geocoder rejects `EPROVIDER` within 5 s | Hangs or exceeds 5 s |
| U-8 | RQ5 | Random start fixed at index 0. Kakao keys answer [401, 200]; then [429, 500]; Google (single key) `OVER_QUERY_LIMIT`; Kakao 200 without documents | Success on the second key; `EPROVIDER` after one attempt per key; Google fails after its one attempt; the empty result does not try another key | Key retried, success missed, or empty retried |
| U-18 | RQ5 | `GEOCODER_GOOGLE_KEY` unset, empty, another key, a list | Only a key with fingerprint `ecd5fdb1` is used; others are ignored and reported by fingerprint | Another key used |
| U-17 | RQ10 | Transport size caps with a 2 MB response | The default 1 MB cap rejects it (`ETOOLARGE`); the loopback's 6 MB cap accepts it | Wrong cap |
| U-9 | RQ5 | `GEOCODER_KAKAO_KEYS` unset, `not-json`, `{}` and `[]` while `KAKAO_SECRET_KEYS` is set | Module loads without throwing; Kakao unavailable (`EPROVIDER`); the shared name is not read | Throw at load, or shared name used |
| U-10 | RQ13 | All log lines from U-2, U-8 and U-9, and the per-request line of RT-1 and RT-6 | No key substring; Google URL logged with `key=***`; the per-request line has route, version, cache, provider, backend status, ms and status, and no coordinate with more than 3 decimals | A key appears, a field is missing, or a longer coordinate |
| U-11 | RQ6 | Keys for `(37.5665,126.9780,ko)` and address `잠실` | `c:37.566,126.978,ko`; `a:잠실` | Different |
| U-12 | RQ4, RQ6 | Resolve once (miss), then from the stored document | Hit output deep-equals miss output; provider called once | Differs, or called twice |
| U-13 | RQ6 | Stored: fresh KR without `kmaAddress`; 31 days old; fresh valid | Provider called for the first two only | Wrong |
| U-14 | RQ6 | `readyState` 0; `findOne` takes 1 s; write callback errors | No read attempted; miss at ≤ 300 ms; request still succeeds | Waits, reads while closed, or fails |
| U-16 | RQ4 | Coordinate flow with `lang` values `ko`, `ko,en`, `KO` and `en` on the same Kakao and Google fixtures | Each output equals the `a4c1deb` golden for the same `lang` value (for `ko,en` and `KO`, Kakao's label and address are dropped and Google's are used) | Any difference |
| U-15 | RQ6 | Connection already open; opening then `open`; `createIndex` returns an options error | Index created once after open with `expireAfterSeconds: 2592000`; the error is logged, no throw or unhandled rejection | Created early/twice, or throws |

## RT — routes and versions (RQ1, RQ2, RQ3, RQ7, RQ10, RQ13)

**Setup.** The app is composed in `app.js` order: `cors()` → gateway router → `express-session` → a stub backend that serves `/{v}/kma/addr/...` and `/{v}/dsf/coord/...` from per-version fixtures and records path, query and headers. The geocoder is injected.

| ID | Req | Request | Expected | Failure |
| --- | --- | --- | --- | --- |
| RT-1 | RQ1, RQ3 | `GET /weather/coord/37.5665,126.9780`, `Accept-Language: ko-KR` | Backend gets `/v000901/kma/addr/<enc n1>/<enc n2>/<enc n3>` with `Accept-Language: ko`. 200 = backend JSON + `name`, `country`, `address`, `location{lat:37.566,long:126.978}`; `max-age=300`; ACAO `*` | Any difference |
| RT-2 | RQ3 | The same KR coordinate and a non-KR coordinate (`40.7128,-74.0060`) on R1 and on R2 for each of `v000901`, `v000902`, `v000903` (8 requests), each backend version fixture returning a different body | Backend paths are `/{v}/kma/addr/...` and `/{v}/dsf/coord/40.713,-74.006` with `v` = `v000901` for R1 and the path version for R2; each response body equals **that version's** fixture plus the same merged fields; nothing else differs between versions | Wrong version, or any version-dependent change other than the path |
| RT-3 | RQ3 | Each version's backend returns 500 (×3), 404, and non-JSON | 501 for every version | Differs by version |
| RT-4 | RQ1 | R1 with `?temperatureUnit=F&a=1&a=2&x=%ED%95%9C&p=a+b&flag` | Backend query `temperatureUnit=F&a=2&x=%ED%95%9C&p=a%20b&flag=` | Differs |
| RT-5 | RQ1 | R1 without `Accept-Language`; with `ko-KR,ko;q=0.9`; `ko,en-US;q=0.9,en;q=0.8`; `KO-KR`; `ko&key=x`; a 70-character value without `-` | The geocoder and the backend `Accept-Language` get `en`; `ko`; `ko,en`; `KO`; `ko&key=x` (encoded in URLs, never injected as a query); `en` | Differs, or an injected query |
| RT-6 | RQ1, RQ4 | `GET /geocode/v000903/coord/37.5665,126.9780` | 200; keys `name,country,address,location,kmaAddress` in that order; `max-age=2592000` | Differs |
| RT-7 | RQ1, RQ4 | `GET /geocode/v000903/addr/%EC%84%9C%EC%9A%B8`, the same on `v000901`, and `/geocode/v000903/addr/a/b` | 200 `{country,address,location}`, identical for both versions; `address` = decoded input (`a/b`); `max-age=2592000` | Differs, or differs by version |
| RT-8 | RQ2 | `/weather`, `/weather/addr/x`, `/weather/v000903/addr/x`, `/geocode/coord/1,2`, `/geocode/addr/x`, `/geocode/v000901/coord/1,2`, `/geocode/v000902/addr/x`, `/weather/v000803/coord/1,2`, `POST /weather/coord/1,2` | 404 `Not Found`, `text/plain`, `no-store`; no geocoder or backend call | Other status, or a call |
| RT-9 | RQ1 | `loc` `abc,1`, `1`, `91,0`, `0,181`; `1,2,3`; `0,0` and `0.0004,-0.0004`; address of 201 chars; `/weather/coord/%ZZ` | 400 for the invalid ones and the bad encoding; `1,2,3` is served as `1,2`; 404 for the two zero cases; errors are `text/plain` `no-store`, never HTML | Mismatch or HTML |
| RT-10 | RQ13 | Backend 500 ×3; geocoder error message with a URL and key-like text | 501 `Not Implemented`; the body contains none of `http`, `.net`, `.com`, `key` | Leak |
| RT-11 | RQ10 | (a) backend 503, 503, 200; (b) 404; (c) first attempt exceeds the 3 s attempt timer, the second answers 200 (injected clock); (d) ECONNRESET then 200; (e) `302 Location: /weather/coord/…`; (f) every attempt times out | (a) 200 after 3 attempts; (b) 501 after 1; (c) 200 after 2; (d) 200 after 2; (e) 501, redirect not followed; (f) 501 after 3 attempts at ≤ 9 s | Wrong attempt count, redirect followed, or past the deadline |
| RT-12 | RQ10 | Backend never answers; the router's deadline set to 300 ms (production 9 s) | 501 at the deadline | Hangs |
| RT-13 | RQ10 | `GATEWAY_MAX_INFLIGHT=2`: 5 concurrent R1 with the backend delayed 1 s; then 2 clients abort at 100 ms, and after their handlers end 2 new requests | First batch: 2 × 200 and 3 × 503 with `Retry-After: 5`. The aborted handlers release their slots once each; the 2 new requests get 200 | Other split, or a leaked slot |
| RT-14 | RQ1, RQ7 | `OPTIONS /weather/v000903/coord/1,2` with `Origin`; `HEAD /weather/coord/37.5665,126.9780`; any R1–R4 response; static check of `app.js` order | 204 with ACAO and no backend call; HEAD 200 without body; no `Set-Cookie`; the mount line is after `cors()` and before `session(` | Other |
| RT-15 | RQ7 | Injected handler throws, synchronously and asynchronously | 501 `text/plain`, never HTML | HTML |
| RT-16 | RQ13 | One R2 `v000903` request (cache miss) | Exactly one per-request line with the fields `route, version, cache, provider, backend, ms, status` in that order; no raw coordinate or key | Missing field, or a coordinate or key in the line |

## IC — internal callers (RQ8)

| ID | Scenario | Expected | Failure |
| --- | --- | --- | --- |
| IC-1 | The IC-1 command below | Check prints nothing; self-check prints 4 | Any match, or a self-check other than 4 |
| IC-2 | `coord2addr`, `route.geo.v000903`, `controllerPush._requestGeoInfo` and the `kmaScraper` fallback against a stub public API | Requests go to `/geocode/v000903/coord/<loc>` (push: `<lat>,<lon>` from `[lon,lat]`) and `/geocode/v000903/addr/<enc>`; each caller's result (params, redirect target, stored `geo`) is the same as with the old URL and the same stub body | Wrong URL or changed result |
| IC-3 | The existing tests that assert the old URLs (`rss-response-smoke.js` and the smokes that reuse it, `test.city.parser.js`, `gather-code-drift.test.js`) | Updated to the versioned URLs and passing | Failing or still asserting the old URL |

IC-1 command (repository root):

```sh
# check (must print nothing after the change)
grep -rnE "apiServer\.url \+ '/geocode/(coord|addr)/'" server --include=*.js --exclude-dir=node_modules
# self-check against the pre-change base (must print exactly 4 lines)
git grep -nE "apiServer\.url \+ '/geocode/(coord|addr)/'" b8a3c504 -- server | wc -l
```

## LD — local functional smoke (RQ1, RQ3, RQ7)

| ID | Scenario | Expected | Failure |
| --- | --- | --- | --- |
| LD-1 | Real `bin/www`, empty mongod, stub providers on loopback reached through `GEOCODER_*_BASE_URL`, dummy `GEOCODER_KAKAO_KEYS` and a dummy `GEOCODER_GOOGLE_KEY` (accepted only because `GEOCODER_GOOGLE_BASE_URL` points at the stub), no network. R3 for `37.5665,126.9780`; R1 and R2 (`v000901`, `v000902`, `v000903`) for the same coordinate and for London (the real `dsf/coord` chains, which call Visual Crossing since #2585 and fail without network); one X1 path | R3 200, no `Set-Cookie`. Each R1/R2 reaches that version's real `kma/addr` chain (log line shows the version) and returns 200 if the chain has data, otherwise 501; never HTML or a hang beyond 9 s. X1 → 404 | HTML, crash, cookie, hang, or wrong version |

## DO — direct origin vs. current gateway, before cutover (RQ1–RQ5, RQ8, RQ9)

`scripts/gateway-parity.mjs` sends each request to both bases with a unique `_twcb` query, retries a gateway response until `X-Cache: Miss from cloudfront`, uses the `Accept-Language` values each scenario names, prints a JSON report and exits non-zero on failure. A cell where the gateway answers 501 and the direct origin 200 passes only if the gateway 501 repeats on a second miss and the direct result's geo fields (`name`, `country`, `address`, `location`, `kmaAddress`) equal those of R3 for the same coordinate and language on the direct origin (the Lambda's own bundled keys may fail); a direct 501 where the gateway gave 200 always fails. DO-2 runs **before** DO-1, so its direct miss is a real miss (confirmed by the per-request log line). It compares bodies after removing the fields that also differ between two consecutive gateway misses for the same request (time-varying data).

| ID | Scenario | Expected | Failure |
| --- | --- | --- | --- |
| DO-1 | **Per version:** R1 and R2 for `v000901`, `v000902`, `v000903`. Coordinates: the first DO-2 fresh offset of `37.5665,126.9780`, `35.146,126.923`, `33.4996,126.5312`, `40.7128,-74.0060`, `51.5074,-0.1278` (so the gateway resolves freshly too); the exact fixtures as an informational set. Each with three queries: none; the app's (`client/www/js/service.weatherutil.js` L80–87 with default units, including `windSpeedUnit=m/s` and `airForecastSource=kaq`); the iOS widget's (`tw.ios/widget/TodayViewController.m` L2421), also with `(null)` values. `Accept-Language`: `ko-KR`, `en-US`, `ko,en-US;q=0.9,en;q=0.8` and absent | For every version, query and header: same status on both sides; for 200s, identical top-level key sets and identical values apart from time-varying fields. R1 equals R2 `v000901` on the direct side. On the informational set, geo-field differences explained by the Lambda's older DynamoDB records are listed, not failed | Any unexplained difference, or a status difference not covered by spec §2.5 |
| DO-2 | Run first. Geoinfo: R3 and R4 (`v000901`, `v000903`) for 3 nearby coordinates per DO-1 coordinate (offsets +0.0015°, +0.0035°, +0.0055°, so both caches resolve freshly) and address `서울특별시 송파구 잠실동`. Direct miss, then direct hit, vs. gateway | Identical `name`, `country`, `address`, `location`, `kmaAddress`; hit = miss; R4 `v000901` = R4 `v000903`. The Lambda's address cache never expires, so an R4 difference passes only if the direct result equals a fresh offline golden for the same provider response | Any unexplained difference |
| DO-3 | Headers of direct R1–R4, and `OPTIONS` with `Origin`. Also record the same headers through the current gateway as the **Lambda-era baseline** for RB-1 | Direct: `Cache-Control` per spec; ACAO `*`; `application/json`; no `Set-Cookie`; OPTIONS 204 with ACAO. Baseline saved | Differs, or no baseline |
| DO-4 | The RT-8 list on the direct origin | 404 `no-store` | Other |
| DO-5 | Direct `GET /v000903/kma/coord/37.5665,126.9780` and `/v000903/geo/37.5665,126.9780` (no redirect follow), no `Accept-Language` | 200 JSON with `currentPubDate`; a 3xx with the relative `Location: ../kma/addr/...` (the internal callers work with the versioned URL) | Other |
| DO-6 | The probe's own `ready()` function (from the deployed `AttachEIPToSpot` source) with the exact new percent-encoded constant, against the direct origin | `ready()` returns true: 200 JSON with a 12-digit `currentPubDate` not older than 6 hours, numeric `current.t1h` and `current.reh`, and a non-empty `shortest` | False, or the constant is not ASCII |

## OP — operational (RQ6, RQ9, RQ11)

| ID | Scenario | Expected | Failure |
| --- | --- | --- | --- |
| OP-1 | `db.geocodecaches.getIndexes()` on the production DB; after the first gateway requests (DO-2), the PM2 logs of the workers that handled them | TTL index `{updatedAt:1}` 2592000 s; each such worker logged `gateway geocoder keys: kakao=[5273c28e,5a1eba50] google=[ecd5fdb1]` (fingerprints only) | Missing index, or another Google fingerprint or an ignored Google key |
| OP-2 | `describe-alarms` (us-east-1) for the new alarm and its topic subscription; `set-alarm-state` to ALARM and back | `5xxErrorRate`, the distribution, > 10% for 3 × 5 min; confirmed email subscription; both test emails arrive | Missing, wrong region, or no email |
| OP-3 | After spec §5.2 steps 2, 4 and 5, a boolean script that prints no values | The IC-1 pattern (`apiServer.url + '/geocode/(coord|addr)/'`) matches no non-test file in any checkout on the service or gather host; the deployed `AttachEIPToSpot` constant equals, byte for byte, the one DO-6 passed with; the service fleet's launch template version uses the new AMI (created after the last host change and `pm2 save`) with the recorded overrides; the variable map equals the recorded map except `TARGET_AMI_ID` = new AMI; the gather fleet uses the new gather AMI | Any mismatch → re-bake; cutover blocked |
| OP-4 | Key checklist, kept privately | `GEOCODER_KAKAO_KEYS` holds the 2 working Kakao keys (`5273c28e`, `5a1eba50`); `GEOCODER_GOOGLE_KEY` holds the key with fingerprint `ecd5fdb1` (AK 2026-09-27) | Unconfirmed → block deploy |

## CO / PC / RB — cutover, post-cutover, rollback (RQ12)

| ID | When | Scenario | Expected | Failure → action |
| --- | --- | --- | --- | --- |
| CO-1 | Before submit | `jq` diff of the saved config against the edited config; the same for the prepared reverse edit (RB-1) against the edited config | Only the two `TargetOriginId` fields differ in both; the API Gateway origin ID exists | Do not submit |
| CO-2 | After `Deployed` | `curl -s -D - -o /dev/null "https://todayweather.wizardfactory.net/weather/v000903/coord/37.5665,126.9780?_twcb=$(uuidgen)"` | `X-Powered-By: Express`, no `x-amzn-RequestId` | RB-1 |
| PC-1 | +5 min | `node scripts/gateway-parity.mjs --public https://todayweather.wizardfactory.net`: DO-1 routes for every version with the app's and the widget's queries (200 with a non-empty `name` where the direct side gave 200 in DO-1), R3, R4 per version, DO-3, DO-4 without `POST`; plus the issue's two URLs `/weather/coord/37.5665,126.9780` and `/weather/v000903/coord/37.5665,126.9780` (cache-busted), which must return 200 JSON with a non-empty `name` | All pass | RB-1 |
| PC-2 | +24 h | `AWS/Lambda Invocations` (Sum over 24 h starting at `Deployed` + 5 min) for the four production API functions (`weatherbycoord`, `weatherbyaddr`, `geoinfobycoord`, `geoinfobyaddr`) | 0 | Find the remaining caller |
| PC-3 | +1 h, +24 h | `AWS/CloudFront 5xxErrorRate` | 1 h average ≤ 5%; 24 h average ≤ 2% | RB-1 if caused by the new routes |
| PC-4 | +24 h | `describe-stacks` for `tw-backend-functions-production`; `get-distribution-config` | `LastUpdatedTime` unchanged (2019-03-19); the API Gateway origin is still listed | Investigate the unexpected change |
| RB-1 | On failure | Targeted revert (spec §5.6); invalidate `/geocode/*` if wrong bodies were served | `Deployed`; CO-2 shows API Gateway headers again; Lambda invocations resume; `node scripts/gateway-parity.mjs --public https://todayweather.wizardfactory.net --baseline <DO-3 baseline file>` (always cache-busted) matches the baseline on status, `Cache-Control`, ACAO, `Content-Type` and the absence of `Set-Cookie` (for example `OPTIONS` 200) | Re-read the config and escalate |

## DOC (RQ14)

| ID | Scenario | Expected | Failure |
| --- | --- | --- | --- |
| DOC-0 | Implementation PR | `docs/rewrite/configuration-inventory.md` lists `GEOCODER_KAKAO_KEYS`, `GEOCODER_GOOGLE_KEY`, `GEOCODER_*_BASE_URL` and `GATEWAY_MAX_INFLIGHT` by name, with no values | Missing name or a value |
| DOC-1 | Post-cutover PR: the spec §7 files; link check; Archify validate/deliver for the two diagrams | The docs and both diagrams show CloudFront → service EC2 for `weather/*` and `geocode/*`, Lambdas rollback-only; 0 new broken links; Archify validation passes | Any unmet |

## Coverage

| Req | Scenarios |
| --- | --- |
| RQ1 | RT-1, RT-4–RT-7, RT-9, RT-14, LD-1, DO-1, DO-3, PC-1 |
| RQ2 | RT-8, DO-4 |
| RQ3 | RT-1–RT-3, LD-1, DO-1, PC-1 |
| RQ4 | U-1–U-6, U-12, U-16, RT-6, RT-7, DO-2 |
| RQ5 | U-7–U-9, U-18, DO-2 |
| RQ6 | U-11–U-15, OP-1 |
| RQ7 | RT-14, RT-15, LD-1 |
| RQ8 | IC-1–IC-3, DO-5 |
| RQ9 | DO-6, OP-3 |
| RQ10 | U-17, RT-11–RT-13 |
| RQ11 | OP-1–OP-4 |
| RQ12 | CO-1, CO-2, PC-1–PC-4, RB-1 |
| RQ13 | U-10, RT-10, RT-16 |
| RQ14 | DOC-0, DOC-1 |

## Issue acceptance mapping

| #2606 acceptance item | Scenarios |
| --- | --- |
| Offline tests | U, RT, IC |
| Fixture parity | DO-1, DO-2 |
| Headers | DO-3 |
| OPTIONS | RT-14, DO-3 |
| grep | IC-1 (replaces the issue's grep; spec §9) |
| Public 200 | PC-1 |
| Lambda invocations 0 | PC-2 |
| Stack unchanged, API origin kept | PC-4 |
| Docs | DOC-1 (after cutover; spec §9) |
| Excluded → 404 (scope comment) | RT-8, DO-4 |
