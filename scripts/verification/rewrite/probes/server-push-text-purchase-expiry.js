// Command (run from the repository root, offline, plain Node):
//   mkdir -p reports/verification/rewrite/probes && node scripts/verification/rewrite/probes/server-push-text-purchase-expiry.js > reports/verification/rewrite/probes/server-push-text-purchase-expiry.json
//
// Synthetic execution of baseline push functions extracted by name from Git source:
// requires retained bd6640f2 object (no network fetch). Receipt checks are retired.
// Original combined 27-check source and record remain available in Git history.
// Extracted from
// server/controllers/controllerPush.js, server/controllers/alert.push.controller.js,
// server/controllers/controllerTown24h.js and server/controllers/controllerTown.js.
// Historical filename retained for links; #2642 removes receipt-expiry checks.
// Those files are never required, so no Mongo model,
// Firebase (server/lib/pushProviders.js since c80ee014), GCM, i18n, sprintf or HTTP
// code is loaded; direct APNs delivery was removed in 45b2eb3f. The pure modules
// server/lib/aqi.converter.js and server/lib/kmaTimeLib.js are required as-is.
// Stubs: no-op log; manager.leadingZeros; an i18n stub whose setLocale installs a translator returning
// the server/locales/<lang>.json value for a key (else the key); a positional %d/%s sprintf; a fixed-clock
// Date passed into the extracted functions' scope. The script re-runs itself under TZ=Asia/Seoul, UTC and
// America/Los_Angeles (child processes of the same Node binary) and compares the results.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../../..');
const ZONES = ['Asia/Seoul', 'UTC', 'America/Los_Angeles'];
// Historical push-only replay: requires this retained Git object, no fetch.
const BASELINE = 'bd6640f22c1029c35e8937b108be4b50ea89361a';
const src = rel => execFileSync('git', ['show', BASELINE + ':' + rel], {cwd: ROOT, encoding: 'utf8'});
const blob = rel => { const b = Buffer.from(src(rel)); return crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'); };
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;
const exercised = {};

function sliceBlock(file, start, header) {
  const s = src(file);
  let i = s.indexOf('{', start), depth = 0;
  for (; i < s.length; i++) { if (s[i] === '{') depth++; else if (s[i] === '}') { depth--; if (depth === 0) break; } }
  (exercised[file] = exercised[file] || []).push(`${header}: L${lineOf(s, start)}-L${lineOf(s, i)}`);
  return s.slice(start, i + 1);
}
function extractProto(file, cls, name) {
  const s = src(file); const at = s.indexOf(`${cls}.prototype.${name} = function`);
  if (at < 0) throw new Error('missing ' + name);
  const code = sliceBlock(file, at, name);
  return code.slice(code.indexOf('function'));
}
function extractMethod(file, name) { // ES6 class method written as "    name(args) {"
  const s = src(file); const m = new RegExp(`\\n    ${name}\\s*\\(([^)]*)\\)\\s*\\{`).exec(s);
  if (!m) throw new Error('missing ' + name);
  const code = sliceBlock(file, m.index + 1, name);
  return `function ${name}(${m[1]}) ` + code.slice(code.indexOf('{'));
}
const build = (code, scope) => { const n = Object.keys(scope); return new Function(...n, 'return (' + code + ');')(...n.map(k => scope[k])); };
const fixedDateClass = iso => { const now = Date.parse(iso);
  return class FixedDate extends Date { constructor(...a) { if (a.length === 0) super(now); else super(...a); } static now() { return now; } }; };

function child() {
  const log = { info() {}, warn() {}, error() {}, debug() {}, verbose() {}, silly() {} };
  global.log = log;
  global.manager = { leadingZeros: (n, d) => String(n).padStart(d, '0') };
  const AqiConverter = require(path.join(ROOT, 'server/lib/aqi.converter.js'));
  const kmaTimeLib = require(path.join(ROOT, 'server/lib/kmaTimeLib.js'));
  const locale = l => { const d = JSON.parse(src(`server/locales/${l}.json`)); return { __: k => (d[k] !== undefined ? d[k] : k) }; };
  const i18n = { configure(o) { o.register.setLocale = l => { o.register.__ = locale(l).__; }; } };
  const sprintf = (f, ...a) => { let i = 0; return f.replace(/%[ds]/g, () => String(a[i++])); };
  const cTown = {
    _getWeatherEmoji: build(extractProto('server/controllers/controllerTown24h.js', 'ControllerTown24h', '_getWeatherEmoji'), {}),
    _getEmoji: build(extractProto('server/controllers/controllerTown24h.js', 'ControllerTown24h', '_getEmoji'), {}),
    _convertKmaPtyToStr: build(extractProto('server/controllers/controllerTown.js', 'ControllerTown', '_convertKmaPtyToStr'), { global })
  };
  const P = {};
  for (const n of ['_getAqiStr', '_makeStrTmnTmx', '_makePushAirMessage', '_makeKmaPushWeatherMessage', '_pty2str', '_makeDsfPushWeatherMessage', '_makeKmaPushMessage', '_makeDsfPushMessage'])
    P[n] = build(extractProto('server/controllers/controllerPush.js', 'ControllerPush', n), { cTown, AqiConverter, log, i18n, __dirname: '/stub' });
  const out = { alarm: {}, alert: {}, aqiStr: {} };
  const units = { temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa', distanceUnit: 'km', precipitationUnit: 'mm', airUnit: 'airkorea', airForecastSource: 'airkorea' };
  const safe = f => { try { return f(); } catch (e) { return { threw: e.message }; } };

  // §4.1 KMA alarm fixture
  const kmaBody = dateObj => ({ source: 'KMA', townName: '역삼1동', units: Object.assign({}, units),
    current: { date: '20260924', dateObj, time: parseInt(dateObj.substr(11, 2)), skyIcon: 'sun_smallcloud', t1h: 18, pty: 0, rn1: 0,
      summaryAir: '대기질은 보통입니다.', arpltn: { pm25Grade: 2, pm25Str: '보통', pm10Grade: 1, pm10Str: '좋음', o3Grade: 1, o3Str: '좋음', khaiGrade: 2, khaiStr: '보통' } },
    midData: { dailyData: [
      { date: '20260923', fromToday: -1, tmn: 17, tmx: 25, skyAm: 'sun', skyPm: 'sun', wfAm: '맑음', wfPm: '맑음', pty: 0, pop: 10 },
      { date: '20260924', fromToday: 0, tmn: 18, tmx: 24.6, skyAm: 'sun', skyPm: 'sun_bigcloud_rain', wfAm: '맑음', wfPm: '구름많고 비', pty: 1, pop: 60, dustForecast: { pm10Grade: 2, pm10Str: '보통', pm25Grade: 2, pm25Str: '보통' } },
      { date: '20260925', fromToday: 1, tmn: 15.5, tmx: 21, skyAm: 'cloud_rain', skyPm: 'sun_smallcloud', wfAm: '흐리고 비', wfPm: '구름적고', pty: 1, pop: 70, dustForecast: { pm10Grade: 1, pm10Str: '좋음', pm25Grade: 3, pm25Str: '나쁨', o3Grade: 1, o3Str: '좋음' } }] },
    airInfo: { source: 'airkorea', pollutants: {
      pm25: { daily: [{ date: '2026-09-24', fromToday: 0, val: 20, grade: 2, str: '보통' }, { date: '2026-09-25', fromToday: 1, val: 45, grade: 3, str: '나쁨' }] },
      pm10: { daily: [{ date: '2026-09-24', fromToday: 0, val: 40, grade: 2, str: '보통' }, { date: '2026-09-25', fromToday: 1, val: 25, grade: 1, str: '좋음' }] },
      aqi: { daily: [{ date: '2026-09-24', fromToday: 0, val: 60, grade: 2, str: '보통' }] } } } });
  const tw = { name: '집', lang: 'ko', units, package: 'todayWeather' }, ta = Object.assign({}, tw, { package: 'todayAir' });
  out.alarm['kma todayWeather 07:00'] = safe(() => P._makeKmaPushMessage.call(P, tw, kmaBody('2026.09.24 07:00')));
  out.alarm['kma todayWeather 19:00 dry'] = safe(() => P._makeKmaPushMessage.call(P, tw, kmaBody('2026.09.24 19:00')));
  const rain = kmaBody('2026.09.24 19:00'); rain.current.pty = 1; rain.current.rn1 = 2.5; rain.current.skyIcon = 'cloud_rain';
  out.alarm['kma todayWeather 19:00 raining'] = safe(() => P._makeKmaPushMessage.call(P, tw, rain));
  out.alarm['kma todayAir 07:00'] = safe(() => P._makeKmaPushMessage.call(P, ta, kmaBody('2026.09.24 07:00')));
  out.alarm['kma todayAir 19:00'] = safe(() => P._makeKmaPushMessage.call(P, ta, kmaBody('2026.09.24 19:00')));
  const noSum = kmaBody('2026.09.24 07:00'); delete noSum.current.summaryAir;
  out.alarm['kma todayAir 07:00 no summaryAir'] = safe(() => { const r = P._makeKmaPushMessage.call(P, ta, noSum); return { title: r.title, text: r.text === undefined ? '<undefined>' : r.text }; });

  // §4.2 DSF alarm fixture
  const dsfBody = (dateObj, precType) => { const cur = { date: '20260924', dateObj, skyIcon: precType ? 'cloud_rain' : 'sun_smallcloud', t1h: 0, pty: precType, rn1: 1.2,
    arpltn: { pm25Grade: 3, pm25Str: 'Unhealthy', pm10Grade: 2, pm10Str: 'Moderate' } };
    return { source: 'DSF', units: Object.assign({}, units), thisTime: [{ date: '20260923', dateObj: '2026.09.23 19:00', pty: 0 }, cur],
      daily: [
        { date: '20260923', dateObj: '2026.09.23 00:00', skyIcon: 'sun', skyAm: 'sun', skyPm: 'sun', tmn: 9.4, tmx: 17, pty: 0, pop: 0 },
        { date: '20260924', dateObj: '2026.09.24 00:00', skyIcon: 'sun_smallcloud', skyAm: 'sun_smallcloud', skyPm: 'sun_smallcloud', tmn: 10, tmx: 18.2, pty: 0, pop: 10 },
        { date: '20260925', dateObj: '2026.09.25 00:00', skyIcon: 'sun_bigcloud_rain', skyAm: 'sun_bigcloud_rain', skyPm: 'sun_bigcloud_rain', tmn: 11, tmx: 16, pty: 1, pop: 80 },
        { date: '20260926', dateObj: '2026.09.26 00:00', skyIcon: 'cloud', skyAm: 'cloud', skyPm: 'cloud', tmn: 8, tmx: 15, pty: 0, pop: 0 }],
      airInfo: { source: 'aqicn', last: cur.arpltn } }; };
  const paris = { name: 'Paris', lang: 'en', units, package: 'todayWeather' }, parisTa = Object.assign({}, paris, { package: 'todayAir' });
  out.alarm['dsf 19:00 dry'] = safe(() => P._makeDsfPushMessage.call(P, paris, dsfBody('2026.09.24 19:00', 0)));
  out.alarm['dsf 19:00 raining'] = safe(() => P._makeDsfPushMessage.call(P, paris, dsfBody('2026.09.24 19:00', 1)));
  out.alarm['dsf 08:00 dry'] = safe(() => P._makeDsfPushMessage.call(P, paris, dsfBody('2026.09.24 08:00', 0)));
  const dAir = dsfBody('2026.09.24 19:00', 0); dAir.thisTime[1].summaryAir = 'Air quality is moderate';
  out.alarm['dsf todayAir summaryAir'] = safe(() => P._makeDsfPushMessage.call(P, parisTa, dAir));
  const dNo = dsfBody('2026.09.24 19:00', 0); delete dNo.airInfo;
  out.alarm['dsf todayAir no airInfo'] = safe(() => P._makeDsfPushMessage.call(P, parisTa, dNo));

  // §2.4 _getAqiStr comparator cases
  const t = locale('ko');
  for (const [label, a] of Object.entries({
    'pm10Grade 3 only': { pm10Grade: 3, pm10Str: '나쁨' },
    'khaiGrade 3 + pm25Grade 2': { khaiGrade: 3, khaiStr: '나쁨', pm25Grade: 2, pm25Str: '보통' },
    'pm25 1 + pm10 3': { pm25Grade: 1, pm25Str: '좋음', pm10Grade: 3, pm10Str: '나쁨' },
    'all grade 2': { pm25Grade: 2, pm25Str: '보통', pm10Grade: 2, pm10Str: '보통', o3Grade: 2, o3Str: '보통', khaiGrade: 2, khaiStr: '보통' },
    'o3Grade 3 without o3Str': { pm25Grade: 1, pm25Str: '좋음', pm10Grade: 1, pm10Str: '좋음', o3Grade: 3, khaiGrade: 2, khaiStr: '보통' } })) {
    const r = P._getAqiStr.call(P, a, t); out.aqiStr[label] = { input: a, result: r === undefined ? '<undefined>' : r };
  }

  // §4.3 alert worker (poll time in UTC; state "7 h ago" relative to the fixed clock)
  const alertCase = (label, hh, mm, data, rec) => {
    const FixedDate = fixedDateClass(`2026-09-24T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
    const A = {};
    for (const n of ['_getMinsOfCurrent', '_parseWeatherAirData', '_compareWithLastInfo', '_updateAlertPush', '_convertToNotification'])
      A[n] = build(extractMethod('server/controllers/alert.push.controller.js', n), { kmaTimeLib, AqiConverter, sprintf, log, i18n, __dirname: '/stub', Date: FixedDate });
    const c = Object.assign({ time: hh * 3600 + mm * 60 }, A);
    const ago7 = new FixedDate(FixedDate.now() - 7 * 3600e3);
    const push = JSON.parse(JSON.stringify(rec), (k, v) => (v === 'AGO7' ? ago7 : v));
    const info = c._parseWeatherAirData(push, JSON.parse(JSON.stringify(data)));
    const send = c._compareWithLastInfo(push, info);
    c._updateAlertPush(push, info, send);
    const n = send === 'none' ? null : c._convertToNotification(push, info);
    out.alert[label] = { pollUtc: `${hh}:${String(mm).padStart(2, '0')}`, forecast: info.weather.forecast ? { pty: info.weather.forecast.pty, dateObj: info.weather.forecast.dateObj } : null,
      air: { name: info.air.name, grade: info.air.grade }, send, lastState: push.precipAlerts.lastState, lastGrade: push.airAlerts.lastGrade, notification: n };
  };
  const kma = (pty, rns) => ({ source: 'KMA', townName: '잠실본동', cityName: '송파구',
    current: { dateObj: '2026.09.24 14:30', pty, rns, weather: '비', stnName: '서울' }, shortestPubDate: '202609241430',
    shortest: [{ dateObj: '2026.09.24 15:00', pty: 1 }, { dateObj: '2026.09.24 16:00', pty: 1 }, { dateObj: '2026.09.24 17:00', pty: 0 }],
    short: [{ dateObj: '2026.09.24 18:00', pty: 1 }],
    airInfo: { source: 'airkorea', last: { dataTime: '2026-09-24 14:00', stationName: '송파구', pm10Grade: 2, pm10Value: 60, pm10Str: '보통', pm25Grade: 2, pm25Value: 30, pm25Str: '보통', o3Grade: 3, o3Value: 0.1, o3Str: '나쁨' } } });
  alertCase('C1', 5, 35, kma(1, true), { name: '잠실본동', lang: 'ko', airAlertsBreakPoint: 3, precipAlerts: { lastState: 1, pushTime: 'AGO7' }, airAlerts: { lastGrade: 2, pushTime: 'AGO7' } });
  alertCase('C2', 5, 17, kma(0, false), { name: '잠실본동', lang: 'ko', airAlertsBreakPoint: 3, precipAlerts: { lastState: 0 }, airAlerts: { lastGrade: 3, pushTime: 'AGO7' } });
  alertCase('C3', 5, 35, kma(0, false), { name: '잠실본동', lang: 'ko', airAlertsBreakPoint: 3, precipAlerts: { lastState: 0 }, airAlerts: { lastGrade: 3, pushTime: 'AGO7' } });
  alertCase('C4', 5, 7, kma(1, false), { name: '잠실본동', lang: 'ko', airAlertsBreakPoint: 4 });
  alertCase('C5 en', 5, 50, kma(0, false), { name: 'Jamsil', lang: 'en', airAlertsBreakPoint: 3 });

  out.inputs = { kmaFixture: kmaBody('2026.09.24 07:00'), dsfFixture: dsfBody('2026.09.24 19:00', 0), alertFixture: kma(0, false) };
  out.exercised = exercised;
  process.stdout.write(JSON.stringify(out));
}

function parent() {
  const runs = {};
  for (const tz of ZONES) {
    const r = spawnSync(process.execPath, [__filename, '--child'], { env: Object.assign({}, process.env, { TZ: tz }), encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`child ${tz} failed: ${r.stderr}`);
    runs[tz] = JSON.parse(r.stdout);
  }
  const ref = runs['Asia/Seoul'];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const checks = [];
  const check = (id, doc, expected, actual) => checks.push({ id, doc, expected, actual, match: same(expected, actual) });
  const SPP = 'docs/rewrite/server-push-and-purchase.md';
  const A = ref.alarm;
  check('4.1 KMA todayWeather 07:00', SPP + ' §4.1', { title: '집 현재: ⛅,18˚,초미세먼지 보통', text: '오늘: 맑음🌞→비☔,최저18˚(+1) 최고24˚,미세먼지 보통' }, A['kma todayWeather 07:00']);
  check('4.1 KMA todayWeather 19:00 dry', SPP + ' §4.1', { title: '집 현재: ⛅,18˚,초미세먼지 보통', text: '내일: 비☔→구름적고⛅,최저15˚(-2) 최고21˚(-4),강수확률 70%,초미세먼지 나쁨,오존 좋음' }, A['kma todayWeather 19:00 dry']);
  check('4.1 KMA todayWeather 19:00 raining (same day line without 강수확률)', SPP + ' §4.1', { title: '집 현재: ☔,18˚,초미세먼지 보통,강수량 2.5mm', text: '내일: 비☔→구름적고⛅,최저15˚(-2) 최고21˚(-4),초미세먼지 나쁨,오존 좋음' }, A['kma todayWeather 19:00 raining']);
  check('4.1 KMA todayAir 07:00', SPP + ' §4.1', { title: '집 ', text: '현재: 대기질은 보통입니다.\n오늘: 초미세먼지 평균20 보통, 미세먼지 평균40 보통' }, A['kma todayAir 07:00']);
  check('4.1 KMA todayAir 19:00', SPP + ' §4.1', { title: '집 ', text: '현재: 대기질은 보통입니다.\n내일: 초미세먼지 평균45 나쁨' }, A['kma todayAir 19:00']);
  check('4.1 KMA todayAir 07:00 without summaryAir -> text undefined', SPP + ' §4.1', { title: '집 ', text: '<undefined>' }, A['kma todayAir 07:00 no summaryAir']);
  check('4.2 DSF 19:00 pty 0', SPP + ' §4.2', { title: 'Paris Current: ⛅,0˚,PM2.5 Unhealthy', text: 'Tomorrow: ☔→☔,Lowest11˚(+1) Highest16˚(-2)' }, A['dsf 19:00 dry']);
  check('4.2 DSF 19:00 pty 1', SPP + ' §4.2', { title: 'Paris Current: ☔,0˚,PM2.5 Unhealthy,Precipitation 1.2mm', text: 'Tomorrow: ☔→☔,Lowest11˚(+1) Highest16˚(-2),Chance of precipitation 80%' }, A['dsf 19:00 raining']);
  check('4.2 DSF 08:00 pty 0', SPP + ' §4.2', { title: 'Paris Current: ⛅,0˚,PM2.5 Unhealthy', text: 'Today: ⛅→⛅,Lowest10˚(+1) Highest18˚(+1)' }, A['dsf 08:00 dry']);
  check('4.2 DSF todayAir with summaryAir', SPP + ' §4.2', { title: 'Paris ', text: 'Current: Air quality is moderate' }, A['dsf todayAir summaryAir']);
  check('4.2 DSF todayAir without airInfo throws', SPP + ' §4.2', { threw: 'airInfo is invalid' }, A['dsf todayAir no airInfo']);
  check('2.4 _getAqiStr {pm10Grade:3,pm10Str} alone -> no air item', SPP + ' §2.4', '<undefined>', ref.aqiStr['pm10Grade 3 only'].result);
  check('2.4 _getAqiStr {khaiGrade:3,pm25Grade:2} -> PM2.5 string', SPP + ' §2.4', '초미세먼지 보통', ref.aqiStr['khaiGrade 3 + pm25Grade 2'].result);
  const al = ref.alert, pick = k => ({ send: al[k].send, notification: al[k].notification, lastState: al[k].lastState, lastGrade: al[k].lastGrade });
  check('4.3 C1', SPP + ' §4.3', { send: 'air', notification: { title: '잠실본동 14:30', text: '비가 내리고 있습니다. 14시 오존이 나쁨입니다.' }, lastState: 1, lastGrade: 3 }, pick('C1'));
  check('4.3 C2', SPP + ' §4.3', { send: 'weather', notification: { title: '잠실본동 예보', text: '15시부터 비가 내릴 예정입니다. 14시 오존이 나쁨입니다.' }, lastState: 1, lastGrade: 3 }, pick('C2'));
  check('4.3 C3', SPP + ' §4.3', { send: 'none', notification: null, lastState: 0, lastGrade: 3 }, pick('C3'));
  check('4.3 C4', SPP + ' §4.3', { send: 'none', notification: null, lastState: 1, lastGrade: 3 }, pick('C4'));
  check('4.3 lang en air-only title "<name> AQI " and "14h O3 is <o3Str>."', SPP + ' §4.3', { title: 'Jamsil AQI ', text: '14h O3 is 나쁨.' }, al['C5 en'].notification);
  check('4 method: alarm outputs identical under Asia/Seoul, UTC and America/Los_Angeles', SPP + ' §4 method', true,
    ZONES.every(z => same(runs[z].alarm, ref.alarm) && same(runs[z].aqiStr, ref.aqiStr)));

  const record = {
    probe: 'server-push-text',
    evidence_label: 'synthetic execution',
    command: 'mkdir -p reports/verification/rewrite/probes && node scripts/verification/rewrite/probes/server-push-text-purchase-expiry.js > reports/verification/rewrite/probes/server-push-text-purchase-expiry.json',
    source_commit: BASELINE,
    date: '2026-10-03',
    retirement: 'Issue #2642 removes all receipt-expiry cases; retained historical records describe the prior 27 checks.',
    runtime: { node: process.version, TZ: ZONES, note: 'one child process per TZ; the Asia/Seoul run is the reference for checks' },
    source: Object.entries(ref.exercised).map(([file, fns]) => ({ file, blob_sha1: blob(file), extracted: [...new Set(fns)] }))
      .concat([{ file: 'server/lib/aqi.converter.js', blob_sha1: blob('server/lib/aqi.converter.js'), note: 'required as-is' },
        { file: 'server/lib/kmaTimeLib.js', blob_sha1: blob('server/lib/kmaTimeLib.js'), note: 'required as-is' },
        { file: 'server/locales/ko.json, server/locales/en.json', note: 'translator values' }]),
    stubs: 'no-op log; global.manager.leadingZeros; i18n.configure stub (setLocale installs a locale-file lookup; the real i18n 0.x and sprintf packages are not loaded); positional %d/%s sprintf; fixed-clock Date in the extracted functions\' scope (alert polls at the stated UTC time on 2026-09-24). Alert records with "7 h ago" carry pushTime = fixed now - 7 h. The alert database prefilter, state writes, provider submission and HTTP routes are not executed.',
    inputs: ref.inputs,
    outputs: { 'Asia/Seoul': { alarm: ref.alarm, aqiStr: ref.aqiStr, alert: ref.alert },
      differencesFromAsiaSeoul: Object.fromEntries(ZONES.filter(z => z !== 'Asia/Seoul').map(z => [z, ['alarm', 'aqiStr', 'alert'].filter(k => !same(runs[z][k], ref[k]))])) },
    checks,
    all_checks_match: checks.every(c => c.match),
    interpretation: 'Synthetic execution of historical baseline alarm and alert text builders with translation, logging and clock stubs. Payment checks are retired; prior payment records remain historical. No worker, database, push provider or HTTP endpoint runs.'
  };
  process.stdout.write(JSON.stringify(record, null, 1) + '\n');
}

if (process.argv.includes('--child')) child(); else parent();
