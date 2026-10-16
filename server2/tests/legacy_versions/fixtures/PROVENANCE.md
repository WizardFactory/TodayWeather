# S17 legacy-version oracle fixtures

Two recordings: `kma-older.json.gz` (S17a, below) and `kma-town.json.gz` ([S17b](#s17b-town-oracle-fixture)).

`kma-older.json.gz` (sha256 `f86f257bdff84c83f94ce676a79113cc48a84f195774f490df28c87b986e36d6`) holds
pinned legacy-oracle recordings of the KMA v000901 and v000902 address routers for the S17a native
assembly tests. It is test data only; the server2 runtime never reads it or any legacy file.

## Original recording

The S15b-3e integration refresh below supersedes the original older-version
recording; the original method and town-oracle provenance are retained here.

- Legacy source: master `1d60f728`. The sha256 of every legacy file read while recording is stored
  in `source.files` (51 files), including `server/routes/v000901/route.kma.addr.js` and
  `server/routes/v000902/route.kma.v000902.js`.
- Runtime: Node.js `v16.20.2` (official darwin-arm64 tarball, sha256
  `6a5c4108475871362d742b988566f3fe307f6a67ce14634eb3fbceb4f9eea88c`), `TZ=UTC`,
  `NODE_ENV=production`, dependencies installed with `npm ci --ignore-scripts` from
  `server2/tools/golden/package-lock.json` (express 4.13.4, i18n 0.8.3). Network was denied except
  task-owned loopback; HTTPS was denied.
- Harness: the maintained legacy offline harness `server/test/offline/rss-response-smoke.js`, as in
  S15, with `manager.MAX_CURRENT_COUNT` 192 (D4).
- Driver: the S15 driver ([source](../../domestic/fixtures/PROVENANCE.md#driver-source), sha256
  `d9f7a410b94ea32c98f5a051ed10a3757e6f16f35d0f503f15e78c30582eb821`) with the diff below applied
  (result sha256 `a6ca68cddb86bdee227465de6bd7fe3c0f33e60fe3cd84034305d98d671b0c2c`). It changes
  only the router file, the Express mount and the scenario list. The S15 driver recorded on master
  `1d60f728` still reproduces the S15 `oracle.json.gz` byte for byte. Recording twice gives identical
  bytes. The driver is documentation, not a repository tool (S11/S15 precedent).
- Cross-check: the recorded `domestic-v000901`, `domestic-v000901-db1`, `domestic-v000902` and
  `domestic-v000902-db1` bodies and Express ETags equal the S02 goldens byte for byte. The
  `gateway-default-domestic`, `gateway-v000901-domestic` and `gateway-v000902-domestic` backend
  bodies reproduce the S02 gateway goldens after the gateway's geographic merge (asserted on the
  wire in `kma_gateway.rs`).

## Content

The original recording had 123 scenarios with 2,307 recorded store answers
(none after the response):

- **v000901 (94):** the 85 S15 scenarios run through the v000901 router (`v000903` in an id becomes
  `v000901`), 8 v000901 air paths and the unversioned gateway default:
  `air-airkorea-forecast`, `air-kaq-forecast-aqicn`, `air-forecast-empty`, `air-forecast-taehari`,
  `air-forecast-unknown-source`, `air-forecast-error`, `air-list-stale-first`,
  `air-dust-forecast-stations` and `gateway-default-domestic`.
- **v000902 (29):** a selection run through the v000902 router (ids prefixed `v000902-`, or `v000903`
  replaced by `v000902`): the S02 golden equivalents, gateway inputs, regions, air, life, warnings,
  clock, error and history cases.

The two S15 declared forwards are also declared here (`query-malformed-escape`,
`stn-small-year-datetime`, both v000901). Each scenario records `version`; the replay double
(`server2/tests/domestic/recorded.rs`) builds `/{version}/kma{path}`.

## Driver diff

```diff
--- record-kma.js (S15 driver, sha256 d9f7a410b94ea32c98f5a051ed10a3757e6f16f35d0f503f15e78c30582eb821)
+++ record-older.js (S17a driver, sha256 a6ca68cddb86bdee227465de6bd7fe3c0f33e60fe3cd84034305d98d671b0c2c)
@@ -1,9 +1,10 @@
-/* S15 KMA v000903 oracle driver (task evidence, not a repository tool).
- * Executes the legacy /v000903/kma router through the maintained offline harness
+/* S17a KMA v000901/v000902 oracle driver (task evidence, not a repository tool). Derived from the
+ * S15 driver (sha256 d9f7a410...): only the router, mount and scenario list differ.
+ * Executes the legacy /v000901/kma/addr and /v000902/kma routers through the maintained offline harness
  * (server/test/offline/rss-response-smoke.js) exactly as the S02 recorder does, and records,
  * for every request, the response plus each dependency answer at the legacy store-read
  * boundary (model reads and controller dependency calls) in the server2 KmaStore vocabulary.
- * Run: TZ=UTC NODE_ENV=production NODE_PATH=<deps>/node_modules node record-kma.js <repo> <out.json.gz>
+ * Run: TZ=UTC NODE_ENV=production NODE_PATH=<deps>/node_modules node record-older.js <repo> <out.json.gz>
  */
 'use strict';
 const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
@@ -209,6 +210,8 @@
     } finally { for (const s of sockets) s.destroy(); await new Promise(ok => listener.close(ok)); allowedPorts.delete(port); }
 }
 
+const ROUTES = {v000901: {file: 'routes/v000901/route.kma.addr.js', mount: '/v000901/kma/addr'},
+    v000902: {file: 'routes/v000902/route.kma.v000902.js', mount: '/v000902/kma'}};
 const enc8 = s => s.split('/').map(encodeURIComponent).join('/');
 const SEOUL = '/addr/' + enc8('서울특별시/종로구/청운효자동');
 const MYEONG = '/addr/' + enc8('서울특별시/중구/명동');
@@ -456,16 +459,52 @@
     f.current.forEach(r => { if (r.date === '20260924' && r.time < '0600') { r.rn1 = -1; r.pty = -1; } });
 }, {history: true, overrides: {history: () => ({mapping: clone(MAPPING), hourly: [asos('hourly', '202609240100', {rn1: 1.5, t1h: 15, reh: 90}), asos('hourly', '202609240200', {t1h: 15, reh: 90})], daily: []})}});
 
+// S17a: v000901-specific air paths (makeAirInfo, AirForecast) beyond the S15 list.
+const STATIONS = f => { const a = hours('종로구', '2026-09-24 09:00', 3); f.arpltnInfo = {arpltn: station('종로구', '2026-09-24 09:00'), list: a, stnList: [a]}; };
+const forecastRows = (codes) => () => {
+    const out = [];
+    for (let h = 1; h <= 30; h++) for (const code of codes) {
+        const t = new RealDate(Date.parse('2026-09-24T09:00:00+09:00') + h * 3600000 + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
+        out.push({code, dataTime: t, val: code === 'o3' ? 0.02 + h / 1000 : 10 + 2 * h, pubDate: '2026-09-24 05:00'});
+    }
+    return out;
+};
+add('air-airkorea-forecast', {path: SEOUL, query: 'airUnit=airkorea', lang: 'ko'}, STATIONS, {overrides: {air_forecast_airkorea: forecastRows(['pm10', 'pm25'])}});
+add('air-kaq-forecast-aqicn', {path: SEOUL, query: 'airUnit=aqicn&airForecastSource=kaq', lang: 'en'}, STATIONS, {overrides: {air_forecast_kaq: forecastRows(['pm10', 'pm25', 'o3', 'no2'])}});
+add('air-forecast-empty', {path: SEOUL, query: 'airForecastSource=kaq', lang: 'ko'}, STATIONS);
+add('air-forecast-taehari', {path: SEOUL, lang: 'ko'}, f => { const a = hours('태하리', '2026-09-24 09:00', 2); f.arpltnInfo = {arpltn: station('태하리', '2026-09-24 09:00'), list: a, stnList: [a]}; });
+add('air-forecast-unknown-source', {path: SEOUL, query: 'airForecastSource=other', lang: 'en'}, STATIONS);
+add('air-forecast-error', {path: SEOUL, lang: 'en'}, STATIONS, {overrides: {air_forecast_airkorea: {__error: 'forecast read failed'}}});
+add('air-list-stale-first', {path: SEOUL, query: 'airUnit=airnow', lang: 'ja'}, f => {
+    const a = hours('종로구', '2026-09-23 20:00', 3), b = hours('중구', '2026-09-24 09:00', 3);
+    f.arpltnInfo = {arpltn: station('종로구', '2026-09-23 20:00'), list: a, stnList: [a, b]};
+});
+add('air-dust-forecast-stations', {path: SEOUL, query: 'airUnit=airkorea_who', lang: 'zh-TW'}, STATIONS, {overrides: {dust_forecast: [
+    {date: '20260924', dustForecast: {PM10Grade: 2, PM10Str: '나쁨', PM25Grade: 1, PM25Str: '보통'}},
+    {date: '20260926', dustForecast: {O3Grade: 3, O3Str: '매우나쁨'}}]}});
+const V902 = new Set(['domestic-v000903', 'domestic-v000903-db1', 'domestic-locale-en', 'domestic-locale-ja', 'domestic-null-units',
+    'domestic-special-info', 'gateway-v000903-domestic', 'gateway-query-normalization', 'busan', 'jeju', 'air-stations', 'air-kaq-forecast',
+    'air-dust-forecast', 'air-fallback', 'air-stale', 'life-food-kasi', 'warning-two-zones', 'winter-cold-wind', 'missing-short', 'model-errors',
+    'region-guard', 'clock-night-2340', 'clock-kst-0605', 'yesterday-warmer', 'station-first-rain', 'history-asos-fill',
+    'air-airkorea-forecast', 'air-forecast-taehari', 'air-dust-forecast-stations']);
+const rename = (id, v) => id.replace('v000903', v);
+const versioned = [];
+for (const c of cases) versioned.push(Object.assign({}, c, {id: rename(c.id, 'v000901'), version: 'v000901'}));
+for (const c of cases) if (V902.has(c.id)) versioned.push(Object.assign({}, c, {id: c.id.includes('v000903') ? rename(c.id, 'v000902') : 'v000902-' + c.id, version: 'v000902'}));
+// The S02 gateway default (unversioned) backend request is the v000901 one.
+versioned.push(Object.assign({}, cases.find(c => c.id === 'gateway-v000903-domestic'), {id: 'gateway-default-domestic', version: 'v000901'}));
+
 async function run() {
     const out = [];
-    for (const c of cases) {
+    for (const c of versioned) {
         now = c.options.clock || '2026-09-24T00:10:00.000Z';
         process.env.TW_SMOKE_NOW = now;
         const harness = makeDomesticHarness();
         const fixture = harness.makeFixture(harness.locations[c.options.place || 0], c.options.policy || 'newer');
         c.modifier(fixture);
         this_f = fixture;
-        const h = harness.createHarness(c.options.db || '2.0', fixture, {oracleRoute: path.join(server, 'routes/v000903/route.kma.v000903.js'), translate: translate(),
+        const route = ROUTES[c.version];
+        const h = harness.createHarness(c.options.db || '2.0', fixture, {oracleRoute: path.join(server, route.file), translate: translate(),
             config: c.options.history ? {readEnabled: true} : undefined});
         if (c.options.zones) {
             const codes = h.load(path.join(server, 'lib/kmaWarningZones.js')).zonesForTown(fixture.place.town);
@@ -474,11 +513,11 @@
         }
         overrides = c.options.overrides || {};
         calls = []; responded = false;
-        const p = '/v000903/kma' + c.request.path + (c.request.query ? '?' + c.request.query : '');
-        const res = await wire(appFor(h.router, '/v000903/kma'), {path: p, headers: c.request.lang ? {'accept-language': c.request.lang} : {}});
+        const p = '/' + c.version + '/kma' + c.request.path + (c.request.query ? '?' + c.request.query : '');
+        const res = await wire(appFor(h.router, route.mount), {path: p, headers: c.request.lang ? {'accept-language': c.request.lang} : {}});
         await new Promise(ok => setImmediate(ok));
         const recorded = calls; calls = null;
-        out.push({id: c.id, clock: now, db: c.options.db || '2.0', path: c.request.path, query: c.request.query || '', lang: c.request.lang || null,
+        out.push({id: c.id, version: c.version, clock: now, db: c.options.db || '2.0', path: c.request.path, query: c.request.query || '', lang: c.request.lang || null,
             status: res.status, content_type: res.contentType || null, etag: res.etag || null, body: res.raw.toString('utf8'), body_sha256: sha(res.raw), calls: recorded});
         if (thrown.length) process.stderr.write('  thrown: ' + JSON.stringify(thrown) + '\n');
         thrown = [];
@@ -487,7 +526,7 @@
     }
     delete process.env.TW_SMOKE_NOW;
     const recordOut = {schema: 1, oracle: {node: process.version, tz: process.env.TZ, harness: 'server/test/offline/rss-response-smoke.js',
-        route: 'server/routes/v000903/route.kma.v000903.js', i18n: require('i18n/package.json').version, express: require('express/package.json').version,
+        routes: Object.fromEntries(Object.entries(ROUTES).map(([v, r]) => [v, 'server/' + r.file])), i18n: require('i18n/package.json').version, express: require('express/package.json').version,
         max_current_count: 192}, source: {files: Object.fromEntries(Object.entries(sourceFiles).sort())}, scenarios: out};
     const text = JSON.stringify(recordOut);
     fs.writeFileSync(outFile, zlib.gzipSync(Buffer.from(text), {level: 9, mtime: 0}));
```

## S17b town oracle fixture

`kma-town.json.gz` (sha256 `991cf39a229d2e46491652611b331ae2573e6521a8db507f3c132e03b559f904`) holds
pinned legacy-oracle recordings of the town routers `server/routes/v000803/routeTownForecast.js` and
`server/routes/v000705/routeTownForecast.js` (and the usage root of
`server/routes/v000901/route.kma.addr.js`) for the S17b tests. It is test data only.

- Recorded like the S17a fixture (same legacy base, runtime, harness and dependencies). The driver
  is the S17a driver with the diff below applied (result sha256
  `b3bac9dc6a13cc9bb12338b5c248b893a2520ef38e947dee8de5b5b468cc90fd`): only the routers, mounts,
  request paths and methods, the recorded `method`, `url` and `content_length`, and the scenario
  list differ. Recording twice gives identical bytes.
- Cross-check: the recorded `domestic-v000803` and `domestic-v000705` bodies and ETags (none for
  v000705) equal the S02 goldens byte for byte.
- 86 scenarios, 1,214 recorded store answers. **v000803 (58):** 51 S15 scenarios through the
  v000803 router (ids prefixed `v000803-`, or `v000903` replaced by `v000803`), the usage root
  with and without the trailing slash and as HEAD, a HEAD request, a HEAD of the region guard and
  an upper-case mount. **v000705 (25):** 12 S15 scenarios through the base routes, the four
  sub-routes (`mid`, `short`, `shortest`, `current`) with and without model errors, an unknown
  sub-route (Express 404), the usage root (with and without the slash), a HEAD request and an
  upper-case mount with an upper-case `MID` sub-route. **v000901 (3):** the usage root (with and
  without the slash) and an upper-case mount, whose `req.baseUrl` spelling makes
  `checkQueryValidation` drop `req.version`, so the reply has no `location`.
- Legacy outcomes: v000705 answers `res.json(undefined)` (200, `application/json`, empty body, no
  ETag; `Content-Length: 0` on GET only); the region guard answers 400; a malformed escape answers
  500 (both routers); the `short`, `shortest` and `current` sub-routes answer 500 when
  `insertSkyIcon` finds no `midData` (`next(err)`); the unknown sub-route answers 404. The 500s and
  the 404 are declared forwards in `support.rs`.

### Town driver diff

```diff
--- record-older.js (S17a driver, sha256 a6ca68cddb86bdee227465de6bd7fe3c0f33e60fe3cd84034305d98d671b0c2c)
+++ record-town.js (S17b driver, sha256 b3bac9dc6a13cc9bb12338b5c248b893a2520ef38e947dee8de5b5b468cc90fd)
@@ -1,10 +1,10 @@
-/* S17a KMA v000901/v000902 oracle driver (task evidence, not a repository tool). Derived from the
- * S15 driver (sha256 d9f7a410...): only the router, mount and scenario list differ.
+/* S17b KMA town v000803/v000705 (and v000901 root) oracle driver (task evidence, not a repository tool). Derived from the
+ * S17a driver (sha256 a6ca68cd...): only the routers, mounts, request paths and scenario list differ.
  * Executes the legacy /v000901/kma/addr and /v000902/kma routers through the maintained offline harness
  * (server/test/offline/rss-response-smoke.js) exactly as the S02 recorder does, and records,
  * for every request, the response plus each dependency answer at the legacy store-read
  * boundary (model reads and controller dependency calls) in the server2 KmaStore vocabulary.
- * Run: TZ=UTC NODE_ENV=production NODE_PATH=<deps>/node_modules node record-older.js <repo> <out.json.gz>
+ * Run: TZ=UTC NODE_ENV=production NODE_PATH=<deps>/node_modules node record-town.js <repo> <out.json.gz>
  */
 'use strict';
 const fs = require('fs'), path = require('path'), vm = require('vm'), Module = require('module');
@@ -201,17 +201,18 @@
     const port = listener.address().port; allowedPorts.add(port);
     try {
         return await new Promise((resolve, reject) => {
-            const req = http.request({host: '127.0.0.1', port, path: input.path, method: 'GET', headers: {connection: 'close', ...input.headers}, agent: false}, res => {
+            const req = http.request({host: '127.0.0.1', port, path: input.path, method: input.method || 'GET', headers: {connection: 'close', ...input.headers}, agent: false}, res => {
                 const chunks = []; res.on('data', c => chunks.push(c));
-                res.on('end', () => resolve({status: res.statusCode, contentType: res.headers['content-type'], etag: res.headers.etag, raw: Buffer.concat(chunks)}));
+                res.on('end', () => resolve({status: res.statusCode, contentType: res.headers['content-type'], etag: res.headers.etag, contentLength: res.headers['content-length'], raw: Buffer.concat(chunks)}));
             });
             req.setTimeout(15000, () => req.destroy(new Error('case timeout'))); req.on('error', reject); req.end();
         });
     } finally { for (const s of sockets) s.destroy(); await new Promise(ok => listener.close(ok)); allowedPorts.delete(port); }
 }
 
-const ROUTES = {v000901: {file: 'routes/v000901/route.kma.addr.js', mount: '/v000901/kma/addr'},
-    v000902: {file: 'routes/v000902/route.kma.v000902.js', mount: '/v000902/kma'}};
+const ROUTES = {v000803: {file: 'routes/v000803/routeTownForecast.js', mount: '/v000803/town'},
+    v000705: {file: 'routes/v000705/routeTownForecast.js', mount: '/v000705/town'},
+    v000901: {file: 'routes/v000901/route.kma.addr.js', mount: '/v000901/kma/addr'}};
 const enc8 = s => s.split('/').map(encodeURIComponent).join('/');
 const SEOUL = '/addr/' + enc8('서울특별시/종로구/청운효자동');
 const MYEONG = '/addr/' + enc8('서울특별시/중구/명동');
@@ -482,17 +483,43 @@
 add('air-dust-forecast-stations', {path: SEOUL, query: 'airUnit=airkorea_who', lang: 'zh-TW'}, STATIONS, {overrides: {dust_forecast: [
     {date: '20260924', dustForecast: {PM10Grade: 2, PM10Str: '나쁨', PM25Grade: 1, PM25Str: '보통'}},
     {date: '20260926', dustForecast: {O3Grade: 3, O3Str: '매우나쁨'}}]}});
-const V902 = new Set(['domestic-v000903', 'domestic-v000903-db1', 'domestic-locale-en', 'domestic-locale-ja', 'domestic-null-units',
-    'domestic-special-info', 'gateway-v000903-domestic', 'gateway-query-normalization', 'busan', 'jeju', 'air-stations', 'air-kaq-forecast',
-    'air-dust-forecast', 'air-fallback', 'air-stale', 'life-food-kasi', 'warning-two-zones', 'winter-cold-wind', 'missing-short', 'model-errors',
-    'region-guard', 'clock-night-2340', 'clock-kst-0605', 'yesterday-warmer', 'station-first-rain', 'history-asos-fill',
-    'air-airkorea-forecast', 'air-forecast-taehari', 'air-dust-forecast-stations']);
+// S17b: town routers. A case path '/addr/<region>/<city>/<town>' is requested as
+// '/<version>/town/<region>/<city>/<town>' (+ an optional v000705 sub-route).
+const TOWN_CASES = ['domestic-v000903', 'domestic-locale-en', 'domestic-locale-ko', 'domestic-locale-ja', 'domestic-locale-zh-CN',
+    'domestic-locale-de', 'domestic-locale-zh-TW', 'domestic-v000903-db1', 'domestic-null-units', 'domestic-pop-covered',
+    'domestic-never-requested-history', 'domestic-partial-history', 'domestic-special-info', 'rss-older', 'rss-equal', 'busan', 'jeju',
+    'station-first-rain', 'station-first-snow-cloud', 'rain-categories', 'air-stations', 'air-stations-airnow', 'air-stale', 'air-dust-forecast',
+    'life-food-kasi', 'life-index-near-area', 'winter-cold-wind', 'hot-humid', 'missing-short', 'model-errors', 'unknown-air-unit',
+    'db1-history', 'stn-error', 'station-hourly-fill', 'short-publications', 'current-error', 'mid-forecast-error', 'yesterday-warmer',
+    'yesterday-colder', 'rss-unusable-values', 'current-sky-from-shortest', 'stn-fog-thunder', 'region-guard', 'clock-night-2340',
+    'clock-kst-0030', 'clock-kst-0605', 'clock-kst-1535', 'current-interpolated-strings', 'query-malformed-escape',
+    'history-asos-fill', 'history-yesterday-from-asos', 'history-short-rain-3h'];
+const V705 = ['domestic-v000903', 'domestic-v000903-db1', 'busan', 'missing-short', 'model-errors', 'current-error', 'mid-forecast-error',
+    'region-guard', 'clock-night-2340', 'station-first-rain', 'query-malformed-escape', 'history-asos-fill'];
 const rename = (id, v) => id.replace('v000903', v);
+const townId = (id, v) => id.includes('v000903') ? rename(id, v) : v + '-' + id;
 const versioned = [];
-for (const c of cases) versioned.push(Object.assign({}, c, {id: rename(c.id, 'v000901'), version: 'v000901'}));
-for (const c of cases) if (V902.has(c.id)) versioned.push(Object.assign({}, c, {id: c.id.includes('v000903') ? rename(c.id, 'v000902') : 'v000902-' + c.id, version: 'v000902'}));
-// The S02 gateway default (unversioned) backend request is the v000901 one.
-versioned.push(Object.assign({}, cases.find(c => c.id === 'gateway-v000903-domestic'), {id: 'gateway-default-domestic', version: 'v000901'}));
+for (const id of TOWN_CASES) versioned.push(Object.assign({}, cases.find(c => c.id === id), {id: townId(id, 'v000803'), version: 'v000803'}));
+for (const id of V705) versioned.push(Object.assign({}, cases.find(c => c.id === id), {id: townId(id, 'v000705'), version: 'v000705'}));
+for (const part of ['mid', 'short', 'shortest', 'current']) {
+    versioned.push(Object.assign({}, cases.find(c => c.id === 'domestic-v000903'), {id: 'v000705-' + part, version: 'v000705', part}));
+    versioned.push(Object.assign({}, cases.find(c => c.id === 'model-errors'), {id: 'v000705-' + part + '-model-errors', version: 'v000705', part}));
+}
+versioned.push(Object.assign({}, cases.find(c => c.id === 'domestic-v000903'), {id: 'v000705-unknown-part', version: 'v000705', part: 'other'}));
+// Review S17B-R1: the usage roots, HEAD replies and case-insensitive mounts.
+const base = () => cases.find(c => c.id === 'domestic-v000903');
+const ROOT = {path: '/addr', lang: 'ko'};
+for (const v of ['v000803', 'v000705', 'v000901']) {
+    versioned.push(Object.assign({}, base(), {id: v + '-usage', version: v, request: ROOT}));
+    versioned.push(Object.assign({}, base(), {id: v + '-usage-slash', version: v, request: {path: '/addr/', lang: 'ko'}}));
+}
+versioned.push(Object.assign({}, base(), {id: 'v000803-usage-head', version: 'v000803', request: ROOT, method: 'HEAD'}));
+versioned.push(Object.assign({}, base(), {id: 'v000705-head', version: 'v000705', method: 'HEAD'}));
+versioned.push(Object.assign({}, base(), {id: 'v000803-head', version: 'v000803', method: 'HEAD'}));
+versioned.push(Object.assign({}, cases.find(c => c.id === 'region-guard'), {id: 'v000803-region-guard-head', version: 'v000803', method: 'HEAD'}));
+versioned.push(Object.assign({}, base(), {id: 'v000803-mixed-case', version: 'v000803', upper: true}));
+versioned.push(Object.assign({}, base(), {id: 'v000705-mixed-case-mid', version: 'v000705', upper: true, part: 'MID'}));
+versioned.push(Object.assign({}, base(), {id: 'v000901-mixed-case', version: 'v000901', upper: true}));
 
 async function run() {
     const out = [];
@@ -513,11 +540,13 @@
         }
         overrides = c.options.overrides || {};
         calls = []; responded = false;
-        const p = '/' + c.version + '/kma' + c.request.path + (c.request.query ? '?' + c.request.query : '');
-        const res = await wire(appFor(h.router, route.mount), {path: p, headers: c.request.lang ? {'accept-language': c.request.lang} : {}});
+        const townPath = c.request.path.replace(/^\/addr/, '') + (c.part ? '/' + c.part : '');
+        const mount = c.upper ? route.mount.toUpperCase() : route.mount;
+        const p = mount + townPath + (c.request.query ? '?' + c.request.query : '');
+        const res = await wire(appFor(h.router, route.mount), {path: p, method: c.method, headers: c.request.lang ? {'accept-language': c.request.lang} : {}});
         await new Promise(ok => setImmediate(ok));
         const recorded = calls; calls = null;
-        out.push({id: c.id, version: c.version, clock: now, db: c.options.db || '2.0', path: c.request.path, query: c.request.query || '', lang: c.request.lang || null,
+        out.push({id: c.id, version: c.version, method: c.method || 'GET', url: p, content_length: res.contentLength === undefined ? null : res.contentLength, clock: now, db: c.options.db || '2.0', path: townPath, query: c.request.query || '', lang: c.request.lang || null,
             status: res.status, content_type: res.contentType || null, etag: res.etag || null, body: res.raw.toString('utf8'), body_sha256: sha(res.raw), calls: recorded});
         if (thrown.length) process.stderr.write('  thrown: ' + JSON.stringify(thrown) + '\n');
         thrown = [];
```

## S15b-3e integration re-record (2026-10-16)

The S17a `kma-older.json.gz` recording above was refreshed against legacy source
from master `73290838` (including #2771). The original unmodified S17a driver
(sha256 `a6ca68cddb86bdee227465de6bd7fe3c0f33e60fe3cd84034305d98d671b0c2c`)
was reconstructed from the documented S15 driver and Driver diff; pinned Node
16.20.2, dependency lock, timezone, network fences and MAX_CURRENT_COUNT=192
remain unchanged. Two independent recorder executions produce identical gzip bytes.

All 123 scenario response statuses, bodies, ETags and content types remain identical.
Only `air-forecast-empty` gains the stored AirKorea fallback read after an empty KAQ
read; its response still contains no forecast because the fallback is also empty.
The recording now contains 2,308 store answers. Only two source hashes change:
`server/controllers/controllerTown24h.js` and
`server/test/offline/rss-response-smoke.js`. The S17b `kma-town.json.gz` oracle is
unchanged; its town routes do not invoke the changed air-forecast selection.

This refresh records the behavior of the existing legacy driver; it does not insert
server2 output into the oracle or change a scenario to fit the Rust implementation.
