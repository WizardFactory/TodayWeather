// Command (run from the repository root, offline, plain Node):
//   node reports/rewrite-verification/probes/server-airkorea-station-merge.js > reports/rewrite-verification/probes/server-airkorea-station-merge.json
//
// Synthetic execution for the station-merge gap (final critic FIN-3). arpltnController._checkArpltnDataValid,
// _checkDateTime and _mergeArpltnList are extracted verbatim from server/controllers/kecoController.js source
// text and evaluated with a no-op log. kecoController.js itself is never required (it loads Mongo models and
// the AirKorea requester), so the MsrStnInfo $near query, the 24 h Arpltn query and the stnList sort are not
// executed. Inputs are synthetic per-station latest records (arpltnList[i][0]) with AirKorea-style
// 'YYYY-MM-DD HH:MM' dataTime strings; a missing pollutant is an absent field, as kecoRequester.js L283-L295
// deletes NaN values. Process time zone is pinned to Asia/Seoul because dataTime is parsed as local time.
'use strict';
process.env.TZ = 'Asia/Seoul';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../../..');
const FILE = 'server/controllers/kecoController.js';
const text = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
const lineOf = idx => text.slice(0, idx).split('\n').length;
const extracted = [];
function extract(name) {
  const at = text.indexOf(`arpltnController.${name} = function`);
  if (at < 0) throw new Error('missing ' + name);
  let i = text.indexOf('{', at), depth = 0;
  for (; i < text.length; i++) { if (text[i] === '{') depth++; else if (text[i] === '}') { depth--; if (depth === 0) break; } }
  extracted.push(`${name}: L${lineOf(at)}-L${lineOf(i)}`);
  const code = text.slice(at, i + 1);
  return code.slice(code.indexOf('function'));
}
const log = { error() {}, warn() {}, info() {}, debug() {}, verbose() {}, silly() {} };
const K = {};
for (const n of ['_checkArpltnDataValid', '_checkDateTime', '_mergeArpltnList'])
  K[n] = new Function('log', 'return (' + extract(n) + ');')(log);

const NOW_ISO = '2026-09-25T12:00:00+09:00';
const kst = hoursAgo => { const d = new Date(Date.parse(NOW_ISO) - hoursAgo * 3600e3);
  const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const FULL = { coValue: 0.4, coGrade: 1, khaiValue: 60, khaiGrade: 2, no2Value: 0.02, no2Grade: 1, o3Value: 0.03, o3Grade: 1, pm10Value: 40, pm10Grade: 2, pm25Value: 20, pm25Grade: 2, so2Value: 0.003, so2Grade: 1 };
const station = (name, hoursAgo, overrides, omit) => { const r = Object.assign({ stationName: name, mangName: '도시대기', dataTime: kst(hoursAgo) }, FULL, overrides || {});
  (omit || []).forEach(k => delete r[k]); return r; };
const merge = list => { const now = new Date(NOW_ISO); const r = K._mergeArpltnList(list.map(s => [s]), now);
  const shown = r === undefined ? '<undefined>' : Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === undefined ? '<undefined>' : v]));
  return { result: shown, raw: r, currentTimeAfterMerge: now.toISOString() }; };

const scenarios = {};
// A: the FIN-3 case. Nearest 9 h old (complete); 14 h old without pm10; 22 h old without pm10.
const A = [station('S1-nearest', 9), station('S2', 14, {}, ['pm10Value', 'pm10Grade']), station('S3', 22, { so2Value: 0.009 }, ['pm10Value', 'pm10Grade'])];
scenarios['A 9/14/22 h, pm10 missing at S2 and S3'] = { input: A, ...merge(A) };
// B: same, but the 22 h old station has pm10.
const B = [station('S1-nearest', 9), station('S2', 14, {}, ['pm10Value', 'pm10Grade']), station('S3', 22, { pm10Value: 85, pm10Grade: 3 })];
scenarios['B 9/14/22 h, pm10 only at S3'] = { input: B, ...merge(B) };
// C: all three fresh (1/2/3 h); nearest lacks pm25 -> donor fill from S2.
const C = [station('S1-nearest', 1, {}, ['pm25Value', 'pm25Grade']), station('S2', 2, { pm25Value: 33, pm25Grade: 2 }), station('S3', 3)];
scenarios['C 1/2/3 h, pm25 missing at S1'] = { input: C, ...merge(C) };

// D: acceptance of one record by list position: fillers aged 30 h are rejected at positions 1-3.
const ages = [7.5, 8.5, 15.5, 16.5, 23.5];
const acceptance = ages.map(age => {
  const row = { ageHours: age };
  for (let k = 1; k <= 3; k++) {
    const list = [...Array(k - 1).keys()].map(i => station('filler' + (i + 1), 30)).concat([station('T', age)]);
    const r = merge(list).result;
    row['position' + k] = r !== '<undefined>' && r.stationName === 'T' ? 'accepted' : 'rejected';
  }
  return row;
});

const a = scenarios['A 9/14/22 h, pm10 missing at S2 and S3'].raw;
const b = scenarios['B 9/14/22 h, pm10 only at S3'].raw;
const checks = [];
const check = (id, expected, actual) => checks.push({ id, doc: 'docs/rewrite/server-response-assembly.md#station-selection-and-merge (A46, FIN-3)',
  expected, actual, match: JSON.stringify(expected) === JSON.stringify(actual) });
check('9-hour-old nearest station rejected; 14-hour-old station becomes the base record', { base: 'S2', dataTime: kst(14) }, { base: a.stationName, dataTime: a.dataTime });
check('pm10StationName set to the 22-hour-old donor although it has no pm10Value', { pm10StationName: 'S3', hasPm10Value: false, pm10ValueKeyPresent: true },
  { pm10StationName: a.pm10StationName, hasPm10Value: a.pm10Value !== undefined, pm10ValueKeyPresent: Object.prototype.hasOwnProperty.call(a, 'pm10Value') });
check('22-hour-old station value merged when it has the pollutant', { pm10Value: 85, pm10Grade: 3, pm10StationName: 'S3', base: 'S2' },
  { pm10Value: b.pm10Value, pm10Grade: b.pm10Grade, pm10StationName: b.pm10StationName, base: b.stationName });
check('k-th candidate accepted when younger than 8*k hours (cumulative -8 h per call)',
  [['accepted', 'accepted', 'accepted'], ['rejected', 'accepted', 'accepted'], ['rejected', 'accepted', 'accepted'], ['rejected', 'rejected', 'accepted'], ['rejected', 'rejected', 'accepted']],
  acceptance.map(r => [r.position1, r.position2, r.position3]));
check('the Date passed in is mutated by -8 h per _checkDateTime call', '2026-09-24T03:00:00.000Z', scenarios['A 9/14/22 h, pm10 missing at S2 and S3'].currentTimeAfterMerge);

const blob = (b => crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'))(fs.readFileSync(path.join(ROOT, FILE)));
const record = {
  probe: 'server-airkorea-station-merge',
  evidence_label: 'synthetic execution',
  command: 'node reports/rewrite-verification/probes/server-airkorea-station-merge.js > reports/rewrite-verification/probes/server-airkorea-station-merge.json',
  source_commit: 'bd6640f22c1029c35e8937b108be4b50ea89361a',
  date: '2026-09-25',
  rebaseline: { previous_source_commit: 'ff7acf3996ccb66c912d2ed4710cf300197d6966',
    note: 'Re-baselined 2026-09-25 from ff7acf39 to bd6640f2. kecoController.js has the same blob hash at both commits; inputs, outputs and all 5 checks are identical to the ff7acf39 run. controllerTown.js changed upstream, but the getKeco middleware is text-identical and moved from L2606-L2614 to L2562-L2570.',
    node16_cross_check: 'Also run on 2026-09-25 with Node v16.20.2, the server runtime pinned by server/.nvmrc and package.json engines since c80ee014: every output and check was identical; only runtime.node differed. That run is not the stored record.' },
  runtime: { node: process.version, TZ: process.env.TZ },
  source: [{ file: FILE, blob_sha1: blob, extracted },
    { file: 'server/controllers/controllerTown.js', lines: 'L2562-L2570', note: 'source reading only: getKeco passes new Date() and assigns arpltnObj.arpltn to req.current.arpltn; not executed' },
    { file: 'server/controllers/kecoController.js', lines: 'L129-L166, L389-L435', note: 'source reading only: 24 h Arpltn window, MsrStnInfo $near limit 6 $maxDistance 1, slice(0,3) and the stnList comparator; not executed' }],
  inputs: { now: NOW_ISO, stationTemplate: FULL, note: 'each list entry is the latest record of one station, nearest first; missing pollutants are absent fields' },
  outputs: { scenarios: Object.fromEntries(Object.entries(scenarios).map(([k, v]) => [k, { input: v.input, result: v.result, currentTimeAfterMerge: v.currentTimeAfterMerge }])),
    acceptanceByPosition: acceptance },
  checks,
  all_checks_match: checks.every(c => c.match),
  interpretation: 'Synthetic execution of the three kecoController merge helpers extracted from source, with fixed synthetic station records under TZ=Asia/Seoul. It confirms the FIN-3 reading: _checkDateTime moves the shared Date back 8 h on every call, so the k-th candidate station is accepted when its record is younger than 8*k hours (a 9-hour-old nearest station is rejected while 14- and 22-hour-old stations are used); _mergeArpltnList copies the first accepted station and fills each missing pollutant from later accepted stations, and it records <pollutant>StationName even when the donor has no value. It does not execute the Mongo station query, the 24 h record window, the stnList ordering or the response assembly, so the probe does not show which stations a real location gets or what a deployed response contained. Re-run at bd6640f2: kecoController.js is identical to ff7acf39 and every result is unchanged.'
};
process.stdout.write(JSON.stringify(record, null, 1) + '\n');
