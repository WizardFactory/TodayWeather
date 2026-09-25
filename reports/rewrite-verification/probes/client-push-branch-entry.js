// Command (run from the repository root, offline, plain Node):
//   node reports/rewrite-verification/probes/client-push-branch-entry.js > reports/rewrite-verification/probes/client-push-branch-entry.json
//
// Synthetic execution of the checked-in inbound-notification and entry-link handlers, not a device run.
// client/www/js/service.weatherinfo.js, service.push.js and service.branch.js are evaluated in Node VM
// contexts with stubbed Angular injection, storage, analytics and $rootScope. A Firebase.init stub captures
// Push's private _notificationCallback (Firebase.inited stays false, as without the plugin); a stubbed global
// Branch whose initSession() resolves or rejects stands in for the Branch plugin. The inbound payloads are the
// variants in docs/rewrite/examples/push-notification-open.json plus extra cases. No FCM/APNs delivery,
// Branch SDK, OS URL routing, network or device is involved.
'use strict';
process.env.TZ = 'Asia/Seoul';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../../..');
const JS = 'client/www/js';
const blob = rel => { const b = fs.readFileSync(path.join(ROOT, rel)); return crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'); };
const clone = v => JSON.parse(JSON.stringify(v));
const canon = v => Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object')
  ? Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {}) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const events = [];
const Util = { ga: {
  trackEvent(...a) { events.push(['trackEvent', ...a]); },
  trackException(e) { events.push(['trackException', e instanceof Error || (e && e.constructor && e.constructor.name === 'Error') ? 'Error: ' + e.message : 'string: ' + e]); }
} };
const CITIES = [
  { currentPosition: true, address: null, location: null, disable: true },
  { currentPosition: false, name: 'A', address: '대한민국 서울특별시 중구 광희동', location: { lat: 37.564, long: 127.005 } },
  { currentPosition: false, name: 'B', address: '대한민국 부산광역시 해운대구', location: { lat: 35.16, long: 129.16 } },
  { currentPosition: false, name: 'C', address: 'Tokyo, Japan', location: { lat: 35.69, long: 139.692 } }
];
const store = { cities: clone(CITIES), cityIndex: 1, cityList: { cityList: [] } };
const TwStorage = { get: k => (k in store ? clone(store[k]) : null), set: (k, v) => { store[k] = v; } };
const $rootScope = { $broadcast(...a) { events.push(['$broadcast', ...a.map(x => (x && typeof x === 'object') ? clone(x) : x)]); } };
const WeatherUtilStub = { loadWeatherPhotos: () => ({ then() { return { finally() {} }; } }), findWeatherPhoto: () => null };

function load(file, deps, extra) {
  let inst;
  const ctx = Object.assign({ angular: { module: () => ({ factory: (_n, f) => { inst = f(...deps); } }) },
    console: { log() {}, info() {}, warn() {}, error() {} },
    clientConfig: { debug: false, serverUrl: 'https://localhost', package: 'todayWeather' }, setTimeout }, extra || {});
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, JS, file), 'utf8'), ctx, { filename: file });
  return inst;
}

const WeatherInfo = load('service.weatherinfo.js', [$rootScope, WeatherUtilStub, TwStorage, Util]);
WeatherInfo.loadCities();
let notificationCallback;
const Firebase = { inited: false, init(_tokenCb, notifCb) { notificationCallback = notifCb; } };
const Push = load('service.push.js', [() => { throw new Error('Network disabled'); }, TwStorage, Util, WeatherUtilStub, WeatherInfo, {}, $rootScope, Firebase]);
Push.init();

const outputs = {};
function runPush(label, err, payload) {
  WeatherInfo.setCityIndex(1); events.length = 0;
  let threw = null;
  try { notificationCallback(err, payload === undefined ? undefined : clone(payload)); } catch (e) { threw = e.constructor.name + ': ' + e.message; }
  outputs['push:' + label] = { input: payload === undefined ? { err: err && err.message, result: 'undefined' } : payload,
    cityIndexAfter: WeatherInfo.getCityIndex(), events: clone(events), threw };
}

const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/rewrite/examples/push-notification-open.json'), 'utf8'));
for (const v of example.variants) runPush(v.name, null, v.payload);
runPush('outOfRangeTap', null, { tap: true, cityIndex: '7' });
runPush('missingCityIndexTap', null, { tap: true });
runPush('nullCityIndexTap', null, { tap: true, cityIndex: null });
runPush('unknownTap', null, { tap: 'x' });
runPush('pluginError', new Error('plugin error'), undefined);

(async () => {
  const cases = {
    branchFav: { '+clicked_branch_link': true, fav: '2' },
    branchFavNumberZero: { '+clicked_branch_link': true, fav: 0 },
    todayweatherN: { '+non_branch_link': 'todayweather://3' },
    todayairN: { '+non_branch_link': 'todayair://2' },
    bareTodayweather: { '+non_branch_link': 'todayweather://' },
    bareTodayair: { '+non_branch_link': 'todayair://' },
    outOfRange: { '+non_branch_link': 'todayweather://9' },
    todayweatherZero: { '+non_branch_link': 'todayweather://0' },
    organic: {}
  };
  const runBranch = async (label, BranchPlugin, input) => {
    const calls = [];
    const plugin = BranchPlugin && Object.assign({}, BranchPlugin, {
      setDebug(v) { calls.push('setDebug(' + v + ')'); },
      initSession() { calls.push('initSession'); return BranchPlugin.initSession(); } });
    const Branch = load('service.branch.js', [$rootScope, Util, WeatherInfo], plugin ? { Branch: plugin } : {});
    WeatherInfo.setCityIndex(1); events.length = 0;
    Branch.branchInit();
    await new Promise(r => setTimeout(r, 0));
    outputs['branch:' + label] = { input, pluginCalls: calls, cityIndexAfter: WeatherInfo.getCityIndex(), events: clone(events) };
  };
  for (const [label, res] of Object.entries(cases)) await runBranch(label, { initSession: () => Promise.resolve(res) }, res);
  await runBranch('initSessionRejected', { initSession: () => Promise.reject(new Error('synthetic init failure')) }, 'initSession rejects with Error("synthetic init failure")');
  await runBranch('pluginAbsent', null, 'window.Branch undefined');

  const ev = label => outputs[label].events;
  const noEvents = label => ev(label).length === 0;
  const invalidSetIndex = i => ['trackEvent', 'city', 'error', 'Invalid set index', i];
  const checks = [];
  const check = (id, doc, expected, actual) => checks.push({ id, doc, expected, actual, match: same(expected, actual) });
  const CDC = 'docs/rewrite/client-data-contracts.md';
  check('push backgroundTap "2" selects 2 and broadcasts reloadEvent push', CDC + '#inbound-notification-payload',
    { cityIndexAfter: 2, broadcast: ['$broadcast', 'reloadEvent', 'push'] },
    { cityIndexAfter: outputs['push:backgroundTap'].cityIndexAfter, broadcast: ev('push:backgroundTap').find(e => e[0] === '$broadcast') });
  const fg = l => { const b = ev(l).find(e => e[1] === 'notificationEvent'); return { cityIndexAfter: outputs[l].cityIndexAfter, title: b && b[2].title, message: b && b[2].message, reload: ev(l).some(e => e[1] === 'reloadEvent') }; };
  check('aps and non-aps foreground give the same notificationEvent title/message, no city change or reload', CDC + '#inbound-notification-payload',
    { aps: { cityIndexAfter: 1, title: '광희동 ', message: 'Synthetic notification body', reload: false }, nonAps: { cityIndexAfter: 1, title: '광희동 ', message: 'Synthetic notification body', reload: false } },
    { aps: fg('push:apsForeground'), nonAps: fg('push:nonApsForeground') });
  check('invalid index "not-a-number" -> trackException invalid fav:NaN, no reload', CDC + '#inbound-notification-payload',
    [['trackException', 'Error: invalid fav:NaN']], ev('push:invalidIndexTap'));
  check('tap "x" -> trackException unknown tap info', CDC + '#inbound-notification-payload', [['trackException', 'Error: unknown tap info']], ev('push:unknownTap'));
  check('out-of-range "7" rejected by setCityIndex but reload still broadcast', CDC + '#inbound-notification-payload',
    { cityIndexAfter: 1, rejected: true, reload: true },
    { cityIndexAfter: outputs['push:outOfRangeTap'].cityIndexAfter, rejected: ev('push:outOfRangeTap').some(e => same(e, invalidSetIndex(7))), reload: ev('push:outOfRangeTap').some(e => same(e, ['$broadcast', 'reloadEvent', 'push'])) });
  check('tap without cityIndex (absent or null) produces no event', CDC + '#inbound-notification-payload', { absent: [], null: [] }, { absent: ev('push:missingCityIndexTap'), null: ev('push:nullCityIndexTap') });
  check('plugin error callback throws TypeError reading tap', CDC + '#inbound-notification-payload; decisions-and-open-questions.md A21',
    "TypeError: Cannot read properties of undefined (reading 'tap')", outputs['push:pluginError'].threw);

  const sel = (l, idx) => ({ cityIndexAfter: outputs[l].cityIndexAfter, reloadDeeplink: ev(l).some(e => same(e, ['$broadcast', 'reloadEvent', 'deeplink'])) });
  check('Branch fav "2" selects 2 and broadcasts reloadEvent deeplink', CDC + '#app-entry-links', { cityIndexAfter: 2, reloadDeeplink: true }, sel('branch:branchFav'));
  check('todayweather://3 selects 3', CDC + '#app-entry-links', { cityIndexAfter: 3, reloadDeeplink: true }, sel('branch:todayweatherN'));
  check('todayair://2 -> trackException invalid fav:todayair://2, no selection', CDC + '#app-entry-links; A20',
    { cityIndexAfter: 1, events: [['trackException', 'Error: invalid fav:todayair://2']] }, { cityIndexAfter: outputs['branch:todayairN'].cityIndexAfter, events: ev('branch:todayairN') });
  check('bare todayweather:// ignored silently', CDC + '#app-entry-links', { cityIndexAfter: 1, events: [] }, { cityIndexAfter: outputs['branch:bareTodayweather'].cityIndexAfter, events: ev('branch:bareTodayweather') });
  check('bare todayair:// -> trackException, no selection', CDC + '#app-entry-links; A20',
    { cityIndexAfter: 1, events: [['trackException', 'Error: invalid fav:todayair://']] }, { cityIndexAfter: outputs['branch:bareTodayair'].cityIndexAfter, events: ev('branch:bareTodayair') });
  check('organic open does nothing', CDC + '#app-entry-links', true, noEvents('branch:organic') && outputs['branch:organic'].cityIndexAfter === 1);
  check('todayweather://9 rejected, reload still broadcast', CDC + '#app-entry-links; A20',
    { cityIndexAfter: 1, rejected: true, reload: true },
    { cityIndexAfter: outputs['branch:outOfRange'].cityIndexAfter, rejected: ev('branch:outOfRange').some(e => same(e, invalidSetIndex(9))), reload: ev('branch:outOfRange').some(e => same(e, ['$broadcast', 'reloadEvent', 'deeplink'])) });
  check('todayweather://0 selects the disabled current-position slot 0', CDC + '#app-entry-links; A20', { cityIndexAfter: 0, slot0Disabled: true },
    { cityIndexAfter: outputs['branch:todayweatherZero'].cityIndexAfter, slot0Disabled: WeatherInfo.getCityOfIndex(0).disable === true });
  check('numeric Branch fav 0 ignored', CDC + '#app-entry-links', { cityIndexAfter: 1, events: [] }, { cityIndexAfter: outputs['branch:branchFavNumberZero'].cityIndexAfter, events: ev('branch:branchFavNumberZero') });
  check('initSession rejection -> trackException(err.message) (a string, not an Error)', CDC + '#app-entry-links',
    [['trackException', 'string: synthetic init failure']], ev('branch:initSessionRejected'));
  check('setDebug(true) called before initSession', CDC + '#app-entry-links', ['setDebug(true)', 'initSession'], outputs['branch:branchFav'].pluginCalls);
  check('Branch plugin absent: nothing happens', CDC + '#app-entry-links; client-data-contracts.md build dependency', { events: [], cityIndexAfter: 1 },
    { events: ev('branch:pluginAbsent'), cityIndexAfter: outputs['branch:pluginAbsent'].cityIndexAfter });

  const record = {
    probe: 'client-push-branch-entry',
    evidence_label: 'synthetic execution',
    command: 'node reports/rewrite-verification/probes/client-push-branch-entry.js > reports/rewrite-verification/probes/client-push-branch-entry.json',
    source_commit: 'bd6640f22c1029c35e8937b108be4b50ea89361a',
    date: '2026-09-25',
    rebaseline: { previous_source_commit: 'ff7acf3996ccb66c912d2ed4710cf300197d6966',
      note: 'Re-baselined 2026-09-25 from ff7acf39 to bd6640f2. The three client files have the same blob hashes at both commits; inputs, outputs and all 19 checks are identical to the ff7acf39 run.',
      node16_cross_check: 'Also run on 2026-09-25 with Node v16.20.2, the server runtime pinned by server/.nvmrc and package.json engines since c80ee014: every output and check was identical; only runtime.node differed. That run is not the stored record.' },
    runtime: { node: process.version, TZ: process.env.TZ },
    source: [
      { file: 'client/www/js/service.push.js', lines: 'L797-L860', blob_sha1: blob(`${JS}/service.push.js`), exercised: 'init; _notificationCallback (L819-L853) captured through Firebase.init' },
      { file: 'client/www/js/service.branch.js', lines: 'L119-L179', blob_sha1: blob(`${JS}/service.branch.js`), exercised: 'branchInit' },
      { file: 'client/www/js/service.weatherinfo.js', lines: 'L8-L29, L56-L112, L299-L335', blob_sha1: blob(`${JS}/service.weatherinfo.js`), exercised: 'createCity, getCityOfIndex, getCityIndex, setCityIndex, loadCities' },
      { file: 'docs/rewrite/examples/push-notification-open.json', note: 'variant payloads used as inputs' }
    ],
    stubs: 'Angular DI via a factory-capturing module; TwStorage over an in-memory object with four synthetic cities (slot 0 a disabled current position) and cityIndex 1; Util.ga records trackEvent/trackException; $rootScope.$broadcast recorded; WeatherUtil photo calls are no-ops; Firebase.init captures callbacks and Firebase.inited is false; Branch plugin stub records setDebug/initSession calls. cityIndex is reset to 1 before each case.',
    inputs: { cities: CITIES, pushPayloads: Object.fromEntries(Object.entries(outputs).filter(([k]) => k.startsWith('push:')).map(([k, v]) => [k, v.input])),
      branchInitSessionResults: Object.fromEntries(Object.entries(outputs).filter(([k]) => k.startsWith('branch:')).map(([k, v]) => [k, v.input])) },
    outputs,
    checks,
    all_checks_match: checks.every(c => c.match),
    interpretation: 'Synthetic execution of the checked-in _notificationCallback (captured through a Firebase.init stub) and Branch.branchInit against stubbed dependencies and the real WeatherInfo selection logic. It reproduces the inbound-notification rules and the entry-link table in client-data-contracts.md, including the source anomalies A20 (todayair:// links fail to parse; disabled slot 0 selectable; reload broadcast after a rejected index) and A21 (the plugin error callback throws). It does not show how cordova-plugin-firebase flattens real FCM/APNs messages, whether the external build registers the URL schemes, how Branch reports links on a device, or what TabCtrl renders; those remain unverified. Re-run at bd6640f2: the client source is identical to ff7acf39 and every result is unchanged. Upstream 45b2eb3f removed the server\'s direct APNs delivery (an iOS record without fcmToken now fails with "FCM token is required for iOS notifications"; see docs/architecture/push-notifications.md); the probed payloads already model FCM-delivered fields, so the removal does not change this result.'
  };
  process.stdout.write(JSON.stringify(record, null, 1) + '\n');
})().catch(e => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
