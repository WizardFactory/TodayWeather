# S17 legacy-version oracle fixtures

`kma-older.json.gz` (sha256 `b401cff97bec3cc6561e85fa0f73f5aa45b3066b5541f2c25b87cd7bba26e188`) holds
pinned legacy-oracle recordings of the KMA v000901 and v000902 address routers for the S17a native
assembly tests. It is test data only; the server2 runtime never reads it or any legacy file.

## Recording

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

123 scenarios with 2,307 recorded store answers (none after the response):

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
