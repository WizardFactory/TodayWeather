// Command (run from the repository root, offline, plain Node):
//   node reports/rewrite-verification/probes/server-kmatimelib-timezones.js > reports/rewrite-verification/probes/server-kmatimelib-timezones.json
//
// Synthetic execution: requires only server/lib/kmaTimeLib.js (pure helpers, no requires) with a no-op
// global log, and evaluates the time encodings listed in docs/rewrite/data-model-reference.md §4 under
// TZ=Asia/Seoul, UTC and America/New_York. The script re-runs itself once per zone as a child process of
// the same Node binary. Fixed instants only; no database, scraper, provider or server start.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const LIB = 'server/lib/kmaTimeLib.js';
const ZONES = ['Asia/Seoul', 'UTC', 'America/New_York'];
const FIXED = '2026-03-08T12:00:00Z'; // US DST start day (spring forward at 2026-03-08T07:00Z in America/New_York)

function child() {
  global.log = { info() {}, warn() {}, error() {}, debug() {}, verbose() {}, silly() {} };
  const t = require(path.join(ROOT, LIB));
  const iso = d => (d instanceof Date && !isNaN(d)) ? d.toISOString() : String(d);
  const wall = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const span = endIso => { const e = new Date(endIso), s = new Date(e.getTime()); s.setDate(s.getDate() - 10); return (e - s) / 3600000; };
  const r = {
    tz: process.env.TZ,
    "getKoreaDateObj('202603081500')": iso(t.getKoreaDateObj('202603081500')),
    "convertStringToDate('202603081500')": iso(t.convertStringToDate('202603081500')),
    "convertStringToDate('20260308')": iso(t.convertStringToDate('20260308')),
    "new Date('2026-03-08 15:00') (AirKorea shape)": iso(new Date('2026-03-08 15:00')),
    "new Date('2026.03.08.15:00') (scraper shape)": iso(new Date('2026.03.08.15:00')),
    "convertKoreaStr2Date('2026년 03월 08일 15시 00분')": iso(t.convertKoreaStr2Date('2026년 03월 08일 15시 00분')),
    'toTimeZone(9, fixed).getHours()': t.toTimeZone(9, new Date(FIXED)).getHours(),
    'toTimeZone(9, fixed) stored instant': iso(t.toTimeZone(9, new Date(FIXED))),
    'getKoreaTimeString(fixed)': t.getKoreaTimeString(new Date(FIXED)),
    'getPast8DaysTime(fixed)': iso(t.getPast8DaysTime(new Date(FIXED))),
    'getPast8DaysTime(fixed) hours before fixed': (Date.parse(FIXED) - t.getPast8DaysTime(new Date(FIXED))) / 3600000,
    'setDate(-10) span ending 2026-03-15T12:00Z (h)': span('2026-03-15T12:00:00Z'),
    'setDate(-10) span ending 2026-11-08T12:00Z (h)': span('2026-11-08T12:00:00Z'),
    // Additional: toTimeZone at 2026-03-08T06:30Z (01:30 EST, before the New York spring-forward); KST wall clock is 15:30.
    'toTimeZone(9, 2026-03-08T06:30Z) local wall reading': wall(t.toTimeZone(9, new Date('2026-03-08T06:30:00Z')))
  };
  process.stdout.write(JSON.stringify(r));
}

function parent() {
  const runs = {};
  for (const tz of ZONES) {
    const p = spawnSync(process.execPath, [__filename, '--child'], { env: Object.assign({}, process.env, { TZ: tz }), encoding: 'utf8' });
    if (p.status !== 0) throw new Error(`child ${tz} failed: ${p.stderr}`);
    runs[tz] = JSON.parse(p.stdout);
  }
  const rows = Object.keys(runs[ZONES[0]]).filter(k => k !== 'tz');
  const table = rows.map(call => Object.assign({ call }, Object.fromEntries(ZONES.map(z => [z, runs[z][call]]))));
  // Documented values from docs/rewrite/data-model-reference.md §4.4 (Z instants written as full ISO strings).
  const documented = {
    "getKoreaDateObj('202603081500')": ['2026-03-08T06:00:00.000Z', '2026-03-08T06:00:00.000Z', '2026-03-08T06:00:00.000Z'],
    "convertStringToDate('202603081500')": ['2026-03-08T06:00:00.000Z', '2026-03-08T15:00:00.000Z', '2026-03-08T19:00:00.000Z'],
    "convertStringToDate('20260308')": ['2026-03-07T15:00:00.000Z', '2026-03-08T00:00:00.000Z', '2026-03-08T05:00:00.000Z'],
    "new Date('2026-03-08 15:00') (AirKorea shape)": ['2026-03-08T06:00:00.000Z', '2026-03-08T15:00:00.000Z', '2026-03-08T19:00:00.000Z'],
    "new Date('2026.03.08.15:00') (scraper shape)": ['2026-03-08T06:00:00.000Z', '2026-03-08T15:00:00.000Z', '2026-03-08T19:00:00.000Z'],
    'toTimeZone(9, fixed).getHours()': [21, 21, 21],
    'toTimeZone(9, fixed) stored instant': ['2026-03-08T12:00:00.000Z', '2026-03-08T21:00:00.000Z', '2026-03-09T01:00:00.000Z'],
    'getKoreaTimeString(fixed)': ['202603082100', '202603082100', '202603082100'],
    'getPast8DaysTime(fixed)': ['2026-02-27T12:00:00.000Z', '2026-02-27T12:00:00.000Z', '2026-02-27T12:00:00.000Z'],
    'setDate(-10) span ending 2026-03-15T12:00Z (h)': [240, 240, 239]
  };
  const checks = Object.entries(documented).map(([call, exp]) => {
    const actual = ZONES.map(z => runs[z][call]);
    return { id: call, doc: 'docs/rewrite/data-model-reference.md §4.4', expected: Object.fromEntries(ZONES.map((z, i) => [z, exp[i]])),
      actual: Object.fromEntries(ZONES.map((z, i) => [z, actual[i]])), match: JSON.stringify(exp) === JSON.stringify(actual) };
  });
  const span = ZONES.map(z => runs[z]['setDate(-10) span ending 2026-11-08T12:00Z (h)']);
  checks.push({ id: 'setDate(-10) across the fall-back change gives 241 h in America/New_York', doc: 'docs/rewrite/verification-matrix.md V33 (239/241 h)',
    expected: { 'Asia/Seoul': 240, UTC: 240, 'America/New_York': 241 }, actual: Object.fromEntries(ZONES.map((z, i) => [z, span[i]])), match: JSON.stringify(span) === JSON.stringify([240, 240, 241]) });
  checks.push({ id: 'getPast8DaysTime subtracts 216 h (9 days)', doc: 'docs/rewrite/data-model-reference.md §2 retention row',
    expected: 216, actual: runs['UTC']['getPast8DaysTime(fixed) hours before fixed'], match: ZONES.every(z => runs[z]['getPast8DaysTime(fixed) hours before fixed'] === 216) });

  const record = {
    probe: 'server-kmatimelib-timezones',
    evidence_label: 'synthetic execution',
    command: 'node reports/rewrite-verification/probes/server-kmatimelib-timezones.js > reports/rewrite-verification/probes/server-kmatimelib-timezones.json',
    source_commit: 'bd6640f22c1029c35e8937b108be4b50ea89361a',
    date: '2026-09-25',
    rebaseline: { previous_source_commit: 'ff7acf3996ccb66c912d2ed4710cf300197d6966',
      note: 'Re-baselined 2026-09-25 from ff7acf39 to bd6640f2. kmaTimeLib.js, kmaScraper.js and kecoRequester.js have the same blob hashes at both commits; inputs, outputs, the additional observation and all 12 checks are identical to the ff7acf39 run.',
      node16_cross_check: 'Also run on 2026-09-25 with Node v16.20.2, the server runtime pinned by server/.nvmrc and package.json engines since c80ee014: every output and check was identical; only runtime.node differed. That run is not the stored record.' },
    runtime: { node: process.version, TZ: ZONES, note: 'one child process per TZ' },
    source: [{ file: LIB, blob_sha1: (b => crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'))(fs.readFileSync(path.join(ROOT, LIB))),
      lines: 'L14-L36 convertStringToDate, L89-L97 toTimeZone, L352-L362 convertKoreaStr2Date, L364-L374 leadingZeros, L385-L397 getPast8DaysTime, L404-L406 getKoreaDateObj, L414-L428 getKoreaTimeString' },
      { file: '(V8 built-in)', lines: 'new Date(<non-ISO string>) and Date.prototype.setDate, the parsers used by server/lib/kmaScraper.js L94/L416 and server/lib/kecoRequester.js L279/L1263' }],
    inputs: { fixedInstant: FIXED, kstText: ['202603081500', '20260308', '2026-03-08 15:00', '2026.03.08.15:00', '2026년 03월 08일 15시 00분'],
      spanEnds: ['2026-03-15T12:00:00Z', '2026-11-08T12:00:00Z'], dstEdgeInstant: '2026-03-08T06:30:00Z' },
    outputs: table,
    checks,
    all_checks_match: checks.every(c => c.match),
    additional_observation: {
      call: 'toTimeZone(9, 2026-03-08T06:30Z) local wall reading',
      results: Object.fromEntries(ZONES.map(z => [z, runs[z]['toTimeZone(9, 2026-03-08T06:30Z) local wall reading']])),
      kstWallClock: '2026-03-08 15:30',
      note: 'data-model-reference.md §4.1 (E3) and §4.4 cite this observation. This run shows the DST-edge effect for one instant: in America/New_York the offset read before shifting (EST) differs from the one used by the getters (EDT), so the local reading is one hour off the KST wall clock.'
    },
    interpretation: 'Synthetic execution of the pure kmaTimeLib helpers and of V8 date parsing under three process time zones. It reproduces every row of the data-model-reference.md §4.4 table and the 239/241 h setDate(-10) spans named in V33: E2 (getKoreaDateObj) and the getKoreaTimeString rendering are zone-independent; E4 local-constructor parses (convertStringToDate, convertKoreaStr2Date and the AirKorea/scraper string shapes) move with the host offset; E3 (toTimeZone) keeps a KST local reading away from DST edges but stores a zone-dependent instant. It does not show which zone any deployed gather, scrape or service process used, and no stored document was read. Re-run at bd6640f2: the probed files are identical to ff7acf39 and every result is unchanged. Modules added upstream after ff7acf39 (server/lib/history/policy.js L34-L52 instant/key and server/lib/midForecastPolicy.js L48-L78 timestamp/date/addDays/publication) build KST keys with Date.UTC and a fixed +9 h offset rather than kmaTimeLib (observed source; not executed by this probe).'
  };
  process.stdout.write(JSON.stringify(record, null, 1) + '\n');
}

if (process.argv.includes('--child')) child(); else parent();
