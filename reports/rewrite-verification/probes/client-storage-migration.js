// Command (run from the repository root, offline, plain Node):
//   node reports/rewrite-verification/probes/client-storage-migration.js > reports/rewrite-verification/probes/client-storage-migration.json
//
// Synthetic execution of the checked-in client storage code, not a device or production run.
// Evaluates client/www/js/service.storage.js, controller.units.js, service.weatherutil.js,
// service.weatherinfo.js and service.push.js in fresh Node VM contexts with stubbed Angular
// injection, localStorage, cordova appPreferences (present, empty native suite), analytics,
// Firebase (plugin absent) and a $http that throws. No network, server, database or plugin.
// Startup order mirrors client/www/js/app.js L328-L341: TwStorage.init -> WeatherInfo.loadCities
// -> Push.init -> Units.loadUnits. Purchase.init and the rest of that callback (L343-L416) are not run.
// Inputs are the checked-in fixtures docs/rewrite/examples/storage-current.json and storage-legacy.json;
// the variants are derived from them in this script. Each scenario is compared with the
// expectedAfterStartup / variantRuns block that the fixture records.
'use strict';
process.env.TZ = 'Asia/Seoul'; // must be set before any Date is created
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../../..');
const JS = 'client/www/js';
const FILES = ['service.storage.js', 'controller.units.js', 'service.weatherutil.js', 'service.weatherinfo.js', 'service.push.js'];
const FIXED_NOW = Date.parse('2026-09-24T09:00:00+09:00');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const blob = rel => { const b = fs.readFileSync(path.join(ROOT, rel)); return crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'); };
const clone = v => JSON.parse(JSON.stringify(v));
const canon = v => Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object')
  ? Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {}) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

let active = null; // scenario receiving asynchronous unhandled rejections
process.on('unhandledRejection', e => { if (active) active.exceptions.push('unhandledRejection: ' + (e && e.message)); });
const tick = () => new Promise(r => setImmediate(r));

async function runScenario(opts) {
  const store = new Map();
  for (const [k, v] of Object.entries(opts.raw || {})) store.set(k, v);
  for (const [k, v] of Object.entries(opts.json || {})) store.set(k, JSON.stringify(v));
  const before = new Map(store);
  const nativeSuite = new Map();
  const events = [], timers = [], exceptions = [], broadcasts = [], httpCalls = [];
  const st = { exceptions };
  active = st;

  class FixedDate extends Date {
    constructor(...a) { if (a.length === 0) super(FIXED_NOW); else super(...a); }
    static now() { return FIXED_NOW; }
  }
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    get length() { return store.size; }
  };
  const appPreferences = { suite: () => ({
    fetch: (ok, _f, k) => ok(nativeSuite.has(k) ? nativeSuite.get(k) : undefined),
    store: (ok, _f, k, v) => { nativeSuite.set(k, v); if (ok) ok(); },
    remove: (ok, _f, k) => { nativeSuite.delete(k); if (ok) ok(); }
  }) };
  const Util = {
    ga: { trackEvent: (...a) => events.push(a.slice(0, 3).map(String).join('/')),
      trackException: e => exceptions.push('trackException: ' + String(e && e.message || e)),
      trackView() {}, trackTiming() {} },
    region: 'KR', language: 'ko-KR', uuid: '', version: ''
  };
  const registry = {};
  const moduleApi = { factory(n, fn) { registry[n] = fn; return moduleApi; }, controller() { return moduleApi; } };
  const $q = { defer() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; },
    all: p => Promise.all(p) };
  const $http = o => { httpCalls.push(o && o.url); throw new Error('Network disabled'); };
  const $rootScope = { $broadcast: (...a) => broadcasts.push(a[0]) };
  const Firebase = { init() {}, inited: false };
  const ctx = {
    angular: { module: () => moduleApi, isArray: Array.isArray },
    console: { log() {}, info() {}, warn() {}, error() {} },
    clientConfig: { package: 'todayWeather', debug: false, serverUrl: '', weatherPhotosUrl: '' },
    ionic: { Platform: { isAndroid: () => false, isIOS: () => true } },
    localStorage, plugins: { appPreferences }, Date: FixedDate, JSON, Math, Array, Object, Error, Number, String, parseInt, isNaN,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}
  };
  ctx.window = ctx;
  for (const f of FILES) vm.runInNewContext(fs.readFileSync(path.join(ROOT, JS, f), 'utf8'), ctx, { filename: f });
  const TwStorage = registry.TwStorage($rootScope, $q, Util);
  const Units = registry.Units(TwStorage, Util);
  const WeatherUtil = registry.WeatherUtil($q, $http, Util, Units);
  const WeatherInfo = registry.WeatherInfo($rootScope, WeatherUtil, TwStorage, Util);
  const Push = registry.Push($http, TwStorage, Util, WeatherUtil, WeatherInfo, Units, $rootScope, Firebase);

  const parse = s => { try { return JSON.parse(s); } catch (e) { return { unparsable: s }; } };
  const diff = from => {
    const removed = [...from.keys()].filter(k => !store.has(k)).sort();
    const added = {}, rewritten = {}, unchanged = [];
    for (const k of [...store.keys()].sort()) {
      if (!from.has(k)) added[k] = parse(store.get(k));
      else if (from.get(k) !== store.get(k)) rewritten[k] = parse(store.get(k));
      else unchanged.push(k);
    }
    return { removed, added, rewritten, unchanged };
  };
  const cityView = c => c && { currentPosition: c.currentPosition, disable: c.disable, photo: c.photo, loadTime: c.loadTime, hasLocation: !!c.location };
  const timeTypes = () => Push.pushData.pushList.map(p => ['time', 'startTime', 'endTime'].filter(k => p[k] !== undefined)
    .map(k => k + ':' + (p[k] instanceof Date ? 'Date' : typeof p[k])).join(','));

  const out = {};
  await TwStorage.init();
  try {
    WeatherInfo.loadCities();
    out.pushInitReturned = Push.init();
    Units.loadUnits();
  } catch (e) {
    out.startupThrew = e.constructor.name + ': ' + e.message;
  }
  await tick(); await tick();
  out.localStorageAfterStartup = diff(before);
  const ci = WeatherInfo.getCityIndex();
  out.cityIndexInMemory = ci === undefined ? '<undefined>' : ci;
  out.cities = [...Array(WeatherInfo.getCityCount()).keys()].map(i => cityView(WeatherInfo.getCityOfIndex(i)));
  out.pushTimeFieldTypes = timeTypes();
  out.pushListInMemory = clone(Push.pushData.pushList);
  out.nativeSuiteKeysAfterStartup = [...nativeSuite.keys()].sort();
  out.scheduledTimersMs = timers.map(t => t.ms);
  out.analyticsEventsAtStartup = events.slice();
  out.exceptionsAtStartup = exceptions.slice();
  if (!out.startupThrew) {
    const snap = new Map(store);
    timers.splice(0).forEach(t => t.fn()); // the 3000 ms repost
    out.afterRepostTimer = { httpCalls: httpCalls.slice(), localStorageChanged: diff(snap) };
    if (opts.updateCity !== undefined) {
      const ex = exceptions.length, ev = events.length, s2 = new Map(store);
      Push.updateCityInfo(opts.updateCity);
      out.afterUpdateCityInfo = { city: opts.updateCity, newExceptions: exceptions.slice(ex), newEvents: events.slice(ev),
        pushListInMemory: clone(Push.pushData.pushList), localStorageChanged: diff(s2), httpCalls: httpCalls.slice() };
    }
    if (out.pushInitReturned === true) {
      const s3 = new Map(store), ev = events.length;
      Push.enableAlertForOldAlarm(false); // TabCtrl showAlertInfoEvent Close branch, called directly
      out.afterAlertPopupClose = { localStorageChanged: diff(s3), nativeSuiteKeys: [...nativeSuite.keys()].sort(),
        httpCalls: httpCalls.slice(), newEvents: events.slice(ev) };
    }
  }
  await tick();
  out.exceptions = exceptions.slice();
  out.analyticsEvents = events.slice();
  out.broadcasts = broadcasts.slice();
  active = null;
  return out;
}

const summarizePush = l => l.map(p => ({ cityIndex: p.cityIndex, id: p.id, category: p.category, enable: p.enable,
  hasCityInfo: 'name' in p || 'town' in p || 'location' in p }));
const tracked = o => o.exceptions.filter(e => e.startsWith('trackException'));
const noPost = l => l.filter(e => !e.startsWith('push/post/'));

(async () => {
  const curFx = readJson('docs/rewrite/examples/storage-current.json');
  const legFx = readJson('docs/rewrite/examples/storage-legacy.json');
  const checks = [];
  const check = (id, doc, expected, actual) => checks.push({ id, doc, expected, actual, match: same(expected, actual) });
  const results = {};

  // ---- current key set ----
  const cur = await runScenario({ json: curFx.localStorage });
  results.current = cur;
  const ce = curFx.expectedAfterStartup;
  check('current.localStorageAfterStartup', 'docs/rewrite/examples/storage-current.json#expectedAfterStartup', ce.localStorageAfterStartup, cur.localStorageAfterStartup);
  check('current.inMemoryAfterStartup', 'docs/rewrite/examples/storage-current.json#expectedAfterStartup', ce.inMemoryAfterStartup,
    { cityIndex: cur.cityIndexInMemory, cities: cur.cities, pushInitReturned: cur.pushInitReturned, pushTimeFieldTypes: cur.pushTimeFieldTypes, pushList: cur.pushListInMemory });
  check('current.scheduledTimersMs', 'storage-current.json#expectedAfterStartup', ce.scheduledTimersMs, cur.scheduledTimersMs);
  check('current.repostNoRequest', 'storage-current.json repostResult; client-state-and-behavior.md (loadPushInfo repair)', { httpCalls: [], added: {}, rewritten: {} },
    { httpCalls: cur.afterRepostTimer.httpCalls, added: cur.afterRepostTimer.localStorageChanged.added, rewritten: cur.afterRepostTimer.localStorageChanged.rewritten });
  check('current.nativeSuiteKeysAfterStartup', 'storage-current.json#expectedAfterStartup', ce.nativeSuiteKeysAfterStartup, cur.nativeSuiteKeysAfterStartup);
  check('current.analyticsEvents', 'storage-current.json#expectedAfterStartup', ce.analyticsEvents, noPost(cur.analyticsEventsAtStartup));
  check('current.harnessErrors (photo feed rejection only)', 'storage-current.json#expectedAfterStartup harnessErrors', ['unhandledRejection: Invalid url='], cur.exceptions);
  const inPush = curFx.localStorage.pushData2.pushList;
  const rep0 = cur.pushListInMemory[0];
  check('current.repair.cityIndex0 stale name, location and town replaced from cities[0]', 'client-state-and-behavior.md loadPushInfo step 1',
    { nameReplaced: true, locationReplaced: true, townReplaced: true, nameAfter: curFx.localStorage.cities[0].name },
    { nameReplaced: rep0.name !== inPush[0].name, locationReplaced: !same(rep0.location, inPush[0].location),
      townReplaced: !same(rep0.town, inPush[0].town), nameAfter: rep0.name });
  check('current.repair.location without lat re-derived', 'client-state-and-behavior.md loadPushInfo step 2',
    { inputHasLat: false, outputHasLat: true }, { inputHasLat: !!(inPush[2].location && inPush[2].location.lat), outputHasLat: !!(cur.pushListInMemory[2].location && cur.pushListInMemory[2].location.lat) });

  const cv = Object.fromEntries(curFx.variantRuns.map(v => [v.name, v.observed]));
  const fresh = await runScenario({ json: {} });
  results['current:empty store'] = fresh;
  check('variant.empty store', 'storage-current.json#variantRuns[empty store (new install)]', cv['empty store (new install)'], {
    localStorageAfterStartup: fresh.localStorageAfterStartup, cityIndexInMemory: fresh.cityIndexInMemory, cities: fresh.cities,
    citiesWritten: 'cities' in fresh.localStorageAfterStartup.added, nativeSuiteKeysAfterStartup: fresh.nativeSuiteKeysAfterStartup,
    analyticsEvents: fresh.analyticsEventsAtStartup });
  for (const [name, change] of [['cityIndex over', { json: { cityIndex: 5 } }], ['cityIndex neg', { json: { cityIndex: -1 } }],
    ['cityIndex malformed', { raw: { cityIndex: '{bad' } }]]) {
    const json = Object.assign({}, curFx.localStorage, change.json || {});
    if (change.raw) delete json.cityIndex;
    const r = await runScenario({ json, raw: change.raw });
    results['current:' + name] = r;
    check('variant.' + name, `storage-current.json#variantRuns[${name}]`, cv[name], {
      cityIndexInMemory: r.cityIndexInMemory, localStorageRewritten: r.localStorageAfterStartup.rewritten,
      analyticsEvents: r.analyticsEventsAtStartup, trackedExceptions: tracked(r) });
  }

  // ---- legacy keys ----
  const leg = await runScenario({ raw: legFx.rawLocalStorage, json: legFx.jsonLocalStorage });
  results.legacy = leg;
  const le = legFx.expectedAfterStartup;
  const { stillAbsent, ...leStore } = le.localStorageAfterStartup;
  check('legacy.localStorageAfterStartup', 'storage-legacy.json#expectedAfterStartup', leStore, leg.localStorageAfterStartup);
  check('legacy.stillAbsent', 'storage-legacy.json#expectedAfterStartup', stillAbsent, stillAbsent.filter(k => !(k in leg.localStorageAfterStartup.added)));
  check('legacy.inMemoryAfterStartup', 'storage-legacy.json#expectedAfterStartup', le.inMemoryAfterStartup,
    { cityIndex: leg.cityIndexInMemory, cities: leg.cities, pushInitReturned: leg.pushInitReturned, pushTimeFieldTypes: leg.pushTimeFieldTypes, pushList: leg.pushListInMemory });
  check('legacy.scheduledTimersMs', 'storage-legacy.json#expectedAfterStartup', le.scheduledTimersMs, leg.scheduledTimersMs);
  check('legacy.nativeSuiteKeysAfterStartup', 'storage-legacy.json#expectedAfterStartup', le.nativeSuiteKeysAfterStartup, leg.nativeSuiteKeysAfterStartup);
  check('legacy.analyticsEvents', 'storage-legacy.json#expectedAfterStartup', le.analyticsEvents, noPost(leg.analyticsEventsAtStartup));
  const lc = le.afterAlertPopupClose;
  check('legacy.afterAlertPopupClose', 'storage-legacy.json#expectedAfterStartup.afterAlertPopupClose',
    { localStorageAdded: lc.localStorageAdded, localStorageRewritten: lc.localStorageRewritten, nativeSuiteKeys: lc.nativeSuiteKeys, httpCalls: lc.httpCalls, postEventLabelIsSavedObject: true },
    { localStorageAdded: leg.afterAlertPopupClose.localStorageChanged.added, localStorageRewritten: leg.afterAlertPopupClose.localStorageChanged.rewritten,
      nativeSuiteKeys: leg.afterAlertPopupClose.nativeSuiteKeys, httpCalls: leg.afterAlertPopupClose.httpCalls,
      postEventLabelIsSavedObject: leg.afterAlertPopupClose.newEvents.length === 1 &&
        leg.afterAlertPopupClose.newEvents[0] === 'push/post/' + JSON.stringify({ savePushInfo: leg.afterAlertPopupClose.localStorageChanged.added.pushData2 }) });

  const lv = Object.fromEntries(legFx.variantRuns.map(v => [v.name, v.observed]));
  const upd = await runScenario({ raw: legFx.rawLocalStorage, json: legFx.jsonLocalStorage, updateCity: 1 });
  results['legacy:updateCityInfo(1)'] = upd;
  check('variant.updateCityInfo(1) before the popup answer', 'storage-legacy.json#variantRuns[updateCityInfo(1) before the popup answer]',
    lv['updateCityInfo(1) before the popup answer'], {
      trackedExceptions: upd.afterUpdateCityInfo.newExceptions, alarmInMemory: upd.afterUpdateCityInfo.pushListInMemory[1],
      localStorageChanged: { added: upd.afterUpdateCityInfo.localStorageChanged.added, rewritten: upd.afterUpdateCityInfo.localStorageChanged.rewritten },
      httpCalls: upd.afterUpdateCityInfo.httpCalls, analyticsEventsBeforeThrow: upd.afterUpdateCityInfo.newEvents,
      closeThenSaved: upd.afterAlertPopupClose.localStorageChanged.added.pushData2.pushList[1] });

  const bad = await runScenario({ raw: Object.assign({}, legFx.rawLocalStorage, { pushData2: '{bad' }), json: legFx.jsonLocalStorage });
  results['legacy:unparsable pushData2'] = bad;
  check('variant.unparsable pushData2', 'storage-legacy.json#variantRuns[unparsable pushData2]', lv['unparsable pushData2'], {
    pushInitReturned: bad.pushInitReturned, analyticsEvents: bad.analyticsEventsAtStartup, pushListInMemory: summarizePush(bad.pushListInMemory),
    closeReplacedPushData2: 'pushData2' in bad.afterAlertPopupClose.localStorageChanged.rewritten });

  const multiIn = lv['several legacy alarms'] && legFx.variantRuns.find(v => v.name === 'several legacy alarms').inputChange['pushData.alarmList'];
  const multi = await runScenario({ raw: legFx.rawLocalStorage,
    json: Object.assign({}, legFx.jsonLocalStorage, { pushData: Object.assign({}, legFx.jsonLocalStorage.pushData, { alarmList: multiIn }) }) });
  results['legacy:several legacy alarms'] = multi;
  check('variant.several legacy alarms', 'storage-legacy.json#variantRuns[several legacy alarms]', lv['several legacy alarms'], {
    pushListInMemory: summarizePush(multi.pushListInMemory),
    trackedExceptions: tracked(multi).map(e => e.includes(' city:') ? e.split(' city:')[0] + ' city:<placeholder JSON omitted>' : e) });

  const noList = await runScenario({ raw: legFx.rawLocalStorage,
    json: Object.assign({}, legFx.jsonLocalStorage, { pushData: { registrationId: null, type: 'android' } }) });
  results['legacy:pushData without alarmList'] = noList;
  check('variant.legacy pushData without alarmList', 'storage-legacy.json#variantRuns[legacy pushData without alarmList]',
    { pushInitThrew: lv['legacy pushData without alarmList'].pushInitThrew, unitsLoaded: false },
    { pushInitThrew: noList.startupThrew, unitsLoaded: 'units' in noList.localStorageAfterStartup.rewritten });

  const record = {
    probe: 'client-storage-migration',
    evidence_label: 'synthetic execution',
    command: 'node reports/rewrite-verification/probes/client-storage-migration.js > reports/rewrite-verification/probes/client-storage-migration.json',
    source_commit: 'bd6640f22c1029c35e8937b108be4b50ea89361a',
    date: '2026-09-25',
    rebaseline: { previous_source_commit: 'ff7acf3996ccb66c912d2ed4710cf300197d6966',
      note: 'Re-baselined 2026-09-25 from ff7acf39 to bd6640f2. The client files (including app.js) have the same blob hashes at both commits; inputs, outputs and all 24 checks are identical to the ff7acf39 run.',
      node16_cross_check: 'Also run on 2026-09-25 with Node v16.20.2, the server runtime pinned by server/.nvmrc since c80ee014 (the client itself runs in a WebView, not on that runtime): 23 of 24 checks matched; variant.cityIndex malformed failed only because V8 in Node 16 words the JSON.parse error as "Unexpected token b in JSON at position 1", the engine-specific text this record already warns about. That run is not the stored record.' },
    runtime: { node: process.version, TZ: process.env.TZ, utcOffsetMinutesAtFixedNow: -new Date(FIXED_NOW).getTimezoneOffset() },
    source: [
      { file: 'client/www/js/service.storage.js', lines: 'L125-L248', blob_sha1: blob(`${JS}/service.storage.js`), exercised: '_setBackwardCompatibility, setForwardCompatibility, get, set, init' },
      { file: 'client/www/js/service.weatherinfo.js', lines: 'L8-L29, L78-L112, L278-L380', blob_sha1: blob(`${JS}/service.weatherinfo.js`), exercised: 'createCity, getCityIndex, setCityIndex, setFirstCityIndex, loadWeatherPhotos, loadCities, _saveCitiesPreference, _loadCitiesPreference, saveCities' },
      { file: 'client/www/js/service.push.js', lines: 'L50-L158, L222-L265, L475-L661, L761-L779, L797-L903', blob_sha1: blob(`${JS}/service.push.js`), exercised: 'loadOldPushInfo, loadPushInfo, savePushInfo, _postPushList, _getSimpleCityInfo, newPushAlert, updateCityInfo, secs2date, enableAlertForOldAlarm, init' },
      { file: 'client/www/js/controller.units.js', lines: 'L14-L130', blob_sha1: blob(`${JS}/controller.units.js`), exercised: '_getDefaultUnits, loadUnits, saveUnits' },
      { file: 'client/www/js/service.weatherutil.js', lines: 'L50-L60, L925-L935', blob_sha1: blob(`${JS}/service.weatherutil.js`), exercised: 'loadWeatherPhotos rejects with Invalid url= for the empty weatherPhotosUrl' },
      { file: 'client/www/js/app.js', lines: 'L328-L341', note: 'startup order mirrored; not executed' }
    ],
    stubs: 'appPreferences present with an empty native suite; iOS platform; Util.region KR; Firebase plugin absent (Firebase.inited false); clientConfig {package todayWeather, serverUrl "", weatherPhotosUrl ""}; fixed clock 2026-09-24T09:00:00+09:00; $http throws and records the URL; setTimeout queued and the 3000 ms repost run manually; Push.updateCityInfo and Push.enableAlertForOldAlarm(false) called directly',
    inputs: {
      fixtures: ['docs/rewrite/examples/storage-current.json (localStorage)', 'docs/rewrite/examples/storage-legacy.json (rawLocalStorage, jsonLocalStorage)'],
      variants: {
        'current:empty store': 'no keys',
        'current:cityIndex over': 'storage-current localStorage with cityIndex 5',
        'current:cityIndex neg': 'storage-current localStorage with cityIndex -1',
        'current:cityIndex malformed': 'storage-current localStorage with raw cityIndex "{bad"',
        'legacy:updateCityInfo(1)': 'storage-legacy keys; Push.updateCityInfo(1) after startup, then the Close branch',
        'legacy:unparsable pushData2': 'storage-legacy keys plus raw pushData2 "{bad"',
        'legacy:several legacy alarms': { 'pushData.alarmList': multiIn },
        'legacy:pushData without alarmList': { pushData: { registrationId: null, type: 'android' } }
      }
    },
    outputs: results,
    checks,
    all_checks_match: checks.every(c => c.match),
    interpretation: 'Synthetic execution of the checked-in client storage, units, weather-info and push services in isolated Node VM contexts with stubbed dependencies. It reproduces the startup storage outcomes recorded in the two example fixtures (expectedAfterStartup and variantRuns) and the migration, selection and push-record repair statements in client-state-and-behavior.md that are labelled synthetic execution. It does not run app.js itself, Purchase.init, the TabCtrl popup, the OK branch, a WebView, the native appPreferences plugin, Firebase or any request, so it says nothing about device timing, native storage failures or production data; the fixtures are synthetic and the legacy writer\'s alarm fields beyond cityIndex/time are unknown. Error message texts (for example the malformed-JSON message) are Node/V8-specific. Re-run at bd6640f2: the client source is identical to ff7acf39 and every result is unchanged.'
  };
  process.stdout.write(JSON.stringify(record, null, 1) + '\n');
})().catch(e => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
