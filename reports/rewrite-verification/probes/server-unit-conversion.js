// Command (run from the repository root, offline, plain Node):
//   node reports/rewrite-verification/probes/server-unit-conversion.js > reports/rewrite-verification/probes/server-unit-conversion.json
//
// Synthetic execution for the unit-conversion gap (final critic FIN-1). server/lib/unitConverter.js is pure
// (no requires) and is required as-is with a recording global log. ControllerTown24h._convertWeatherData
// (server/controllers/controllerTown24h.js), ControllerWWUnits._convertThisTimeWeather and its two helpers
// (server/controllers/worldWeather/controller.ww.units.js) and the client ForecastCtrl $scope.getTemp
// (client/www/js/controller.forecastctrl.js) are extracted verbatim from source text and evaluated with
// stubbed scope; the controller files themselves are never required (they load Mongo models).
// Synthetic numeric inputs only; no request, database or client rendering.
'use strict';
process.env.TZ = 'Asia/Seoul';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../../..');
const src = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const blob = rel => { const b = fs.readFileSync(path.join(ROOT, rel)); return crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'); };
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;
const exercised = {};
function extractAt(file, marker, name) {
  const s = src(file); const at = s.indexOf(marker);
  if (at < 0) throw new Error('missing ' + marker);
  let i = s.indexOf('{', at), depth = 0;
  for (; i < s.length; i++) { if (s[i] === '{') depth++; else if (s[i] === '}') { depth--; if (depth === 0) break; } }
  (exercised[file] = exercised[file] || []).push(`${name}: L${lineOf(s, at)}-L${lineOf(s, i)}`);
  const code = s.slice(at, i + 1);
  return code.slice(code.indexOf('function'));
}
const build = (code, scope) => { const n = Object.keys(scope); return new Function(...n, 'return (' + code + ');')(...n.map(k => scope[k])); };
const show = v => (Object.is(v, -0) ? '-0' : v === undefined ? '<undefined>' : v);
const json = v => JSON.stringify(v);

const logged = [];
global.log = { error: m => logged.push('error: ' + m), warn: m => logged.push('warn: ' + m), info() {}, debug() {}, verbose() {}, silly() {} };
const UnitConverter = require(path.join(ROOT, 'server/lib/unitConverter.js'));
const uc = new UnitConverter();
const kmaTimeLib = require(path.join(ROOT, 'server/lib/kmaTimeLib.js'));
const cv = (from, to, v) => uc.convertUnits(from, to, v);

// 1. Factor table: output for val 1 and 10 and the per-unit factor read from source.
const FACTORS = [
  ['C', 'F', 'val/(5/9)+32'], ['F', 'C', '(val-32)/(9/5)'],
  ['mph', 'km/h', 1.609344], ['mph', 'm/s', 0.44704], ['mph', 'kt', 0.868976], ['mph', 'bft', 'band(round1(val*0.44704))'],
  ['km/h', 'mph', 0.621371], ['km/h', 'm/s', 0.277778], ['km/h', 'kt', 0.539957], ['km/h', 'bft', 'band(round1(val*0.277778))'],
  ['m/s', 'mph', 2.236936], ['m/s', 'km/h', 3.6], ['m/s', 'kt', 1.943844], ['m/s', 'bft', 'band(val)'],
  ['kt', 'mph', 1.150779], ['kt', 'km/h', 1.852], ['kt', 'm/s', 0.514444], ['kt', 'bft', 'band(round1(val*0.514444))'],
  ['bft', 'm/s', 'lower band edge'], ['bft', 'mph', 'edge*2.236936'], ['bft', 'km/h', 'edge*3.6'], ['bft', 'kt', 'edge*1.943844'],
  ['mmHg', 'inHg', 0.03937], ['mmHg', 'hPa', 1.333224], ['inHg', 'mmHg', 25.4], ['inHg', 'hPa', 33.863882],
  ['hPa', 'mmHg', 0.750062], ['hPa', 'inHg', 0.02953], ['hPa', 'mb', 'identity'],
  ['km', 'mi', 0.621371], ['mi', 'km', 1.609344], ['mm', 'in', 0.03937], ['in', 'mm', 25.4]];
const factorTable = FACTORS.map(([from, to, k]) => ({ from, to, factor: k, 'convert(1)': show(cv(from, to, 1)), 'convert(10)': show(cv(from, to, 10)),
  'convert(12.34)': show(cv(from, to, 12.34)),
  formulaHolds: typeof k !== 'number' ? null : [1, 10, 12.34, -1, 0.05, 1013.25].every(v => Object.is(cv(from, to, v), parseFloat((v * k).toFixed(1)))) }));

// 2. Beaufort bands (m/s source: no rounding) and pre-rounding for other sources.
const bands = [0.29, 0.3, 1.49, 1.5, 3.29, 3.3, 5.49, 5.5, 7.99, 8.0, 10.79, 10.8, 13.89, 13.9, 17.19, 17.2, 20.69, 20.7, 24.49, 24.5, 28.39, 28.4, 32.59, 32.6, -1];
const beaufort = bands.map(ms => ({ ms, bft: cv('m/s', 'bft', ms) }));
const preRound = [
  { from: 'km/h', val: 1.07, rawMs: 1.07 * 0.277778, bftFromRawMs: cv('m/s', 'bft', 1.07 * 0.277778), bft: cv('km/h', 'bft', 1.07) },
  { from: 'mph', val: 3.3, rawMs: 3.3 * 0.44704, bftFromRawMs: cv('m/s', 'bft', 3.3 * 0.44704), bft: cv('mph', 'bft', 3.3) },
  { from: 'kt', val: 2.9, rawMs: 2.9 * 0.514444, bftFromRawMs: cv('m/s', 'bft', 2.9 * 0.514444), bft: cv('kt', 'bft', 2.9) }];

// 3. KMA path: ControllerTown24h._convertWeatherData (Fahrenheit floor, precipitation branch, sentinels).
const convertWeatherData = build(extractAt('server/controllers/controllerTown24h.js', 'ControllerTown24h.prototype._convertWeatherData = function', '_convertWeatherData'), { UnitConverter, log: global.log });
const kmaRun = (wData, query) => { const w = JSON.parse(JSON.stringify(wData)); convertWeatherData.call({}, w, query);
  return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, show(v)])); };
const Q = (o) => Object.assign({ temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa', distanceUnit: 'km', precipitationUnit: 'mm', airUnit: 'airkorea' }, o);
const kmaRow = { t1h: 0.5, tmx: -0.5, tmn: -10.3, sensorytem: -50, rn1: 12.5, r06: -1, s06: -1, wsd: -1, hPa: -1, visibility: -1 };
const kma = {
  input: kmaRow,
  'F,in,mph,inHg,mi': kmaRun(kmaRow, Q({ temperatureUnit: 'F', precipitationUnit: 'in', windSpeedUnit: 'mph', pressureUnit: 'inHg', distanceUnit: 'mi' })),
  'F,in,m/s,inHg,mi': kmaRun(kmaRow, Q({ temperatureUnit: 'F', precipitationUnit: 'in', pressureUnit: 'inHg', distanceUnit: 'mi' })),
  'C,in,km/h': kmaRun(kmaRow, Q({ precipitationUnit: 'in', windSpeedUnit: 'km/h' })),
  'C,in,kt': kmaRun(kmaRow, Q({ precipitationUnit: 'in', windSpeedUnit: 'kt' })),
  'C,in,bft': kmaRun(kmaRow, Q({ precipitationUnit: 'in', windSpeedUnit: 'bft' })),
  'defaults (C,mm,m/s,hPa,km)': kmaRun(kmaRow, Q({}))
};

// 4. World path: ControllerWWUnits._convertThisTimeWeather copies temp_f (no floor).
const wwFile = 'server/controllers/worldWeather/controller.ww.units.js';
const ww = {
  _convertWindDirToWdd: build(extractAt(wwFile, 'ControllerWWUnits.prototype._convertWindDirToWdd = function', '_convertWindDirToWdd'), {}),
  _decideHumidityIcon: build(extractAt(wwFile, 'ControllerWWUnits.prototype._decideHumidityIcon = function', '_decideHumidityIcon'), {})
};
ww._convertThisTimeWeather = build(extractAt(wwFile, 'ControllerWWUnits.prototype._convertThisTimeWeather = function', '_convertThisTimeWeather'), { UnitConverter, kmaTimeLib, log: global.log });
const worldIn = { temp_c: 0.5, temp_f: 32.9, ftemp_c: -1.2, ftemp_f: 29.8, humid: 50, precip: 12.5, windSpd_ms: 3.3, press: 1013.2, vis: 10, windDir: 0, precType: 0, date: new Date('2026-09-25T03:00:00Z') };
const worldOut = Object.assign({}, worldIn); ww._convertThisTimeWeather(worldOut, Q({ temperatureUnit: 'F', precipitationUnit: 'in', windSpeedUnit: 'mph', pressureUnit: 'inHg', distanceUnit: 'mi' }));

// 5. Client display: ForecastCtrl $scope.getTemp rounds in Fahrenheit.
const getTemp = build(extractAt('client/www/js/controller.forecastctrl.js', '$scope.getTemp = function', '$scope.getTemp'), { Units: { getUnit: () => 'F' } });
const getTempC = build(extractAt('client/www/js/controller.forecastctrl.js', '$scope.getTemp = function', '$scope.getTemp'), { Units: { getUnit: () => 'C' } });
const display = { kmaF: { server: kma['F,in,mph,inHg,mi'].t1h, displayed: getTemp(kma['F,in,mph,inHg,mi'].t1h) },
  worldF: { server: worldOut.t1h, displayed: getTemp(worldOut.t1h) }, celsius05: getTempC(0.5), f32_5: getTemp(32.5), fMinus0_5: getTemp(-0.5) };

// 6. Sentinel outcomes.
const sentinels = {
  "convertUnits('mm','in',-1)": { value: show(cv('mm', 'in', -1)), json: json({ v: cv('mm', 'in', -1) }) },
  "convertUnits('m/s','mph',-1)": show(cv('m/s', 'mph', -1)),
  "convertUnits('m/s','km/h',-1)": show(cv('m/s', 'km/h', -1)),
  "convertUnits('m/s','kt',-1)": show(cv('m/s', 'kt', -1)),
  "convertUnits('m/s','bft',-1)": show(cv('m/s', 'bft', -1)),
  "convertUnits('hPa','inHg',-1)": { value: show(cv('hPa', 'inHg', -1)), json: json({ v: cv('hPa', 'inHg', -1) }) },
  "convertUnits('hPa','mmHg',-1)": show(cv('hPa', 'mmHg', -1)),
  "convertUnits('km','mi',-1)": show(cv('km', 'mi', -1)),
  "convertUnits('C','F',-50)": show(cv('C', 'F', -50)),
  "convertUnits('mm','in',undefined)": show(cv('mm', 'in', undefined)),
  "convertUnits('mm','in',null)": show(cv('mm', 'in', null)),
  'KMA s06 -1 (cm) with precipitationUnit in': kma['F,in,mph,inHg,mi'].s06,
  'KMA s06 -1 with default units': kma['defaults (C,mm,m/s,hPa,km)'].s06,
  'KMA wsd -1 with windSpeedUnit bft': kma['C,in,bft'].wsd
};
// Additional precision observation: 1-decimal inches hide light precipitation.
const precision = Object.fromEntries([0.1, 1.2, 1.3, 2.5].map(mm => [`${mm} mm -> in`, show(cv('mm', 'in', mm))]));

// 7. A04: the precipitation branch passes toWindUnit; _convertPrecipitation ignores `to`.
const a04 = { "convertUnits('mm','m/s',12.5)": cv('mm', 'm/s', 12.5), "convertUnits('mm','in',12.5)": cv('mm', 'in', 12.5),
  kmaRn1ByWindUnit: Object.fromEntries(['mph', 'm/s', 'km/h', 'kt', 'bft'].map(w => [w, kmaRun({ rn1: 12.5 }, Q({ precipitationUnit: 'in', windSpeedUnit: w })).rn1])) };

// 8. Additional observation added at the bd6640f2 re-baseline (not a check): since 2116c6bf, v000903 makeResult
// passes result.short through server/lib/history/policy.js hourlyResponse after convertUnits. policy.js has no
// requires and is loaded as-is. The row values are synthetic; _convertSummaryTo3H can set rn1 -1 on recovered rows.
const POLICY = 'server/lib/history/policy.js';
const policy = require(path.join(ROOT, POLICY));
const recoveredRow = { historyObservation: { source: 'KMA_ASOS', fields: ['t1h'] }, t1h: 12.3, rn1: -1, r06: -1, s06: -1, pty: -1 };
const plainRow = { t1h: 12.3, rn1: -1, r06: -1, s06: -1, pty: -1 };
const project = (row, query) => { const w = JSON.parse(JSON.stringify(row)); convertWeatherData.call({}, w, query);
  const after = Object.fromEntries(['rn1', 'r06', 's06'].map(k => [k, show(w[k])]));
  const wire = JSON.parse(JSON.stringify(policy.hourlyResponse([w])[0]));
  return { afterConvertUnits: after, wire: Object.fromEntries(['rn1', 'r06', 's06'].map(k => [k, k in wire ? wire[k] : '<omitted>'])) }; };
const hourlyProjection = {
  'recovered row, precipitationUnit mm (default)': project(recoveredRow, Q({})),
  'recovered row, precipitationUnit in': project(recoveredRow, Q({ precipitationUnit: 'in' })),
  'row without historyObservation, precipitationUnit in': project(plainRow, Q({ precipitationUnit: 'in' }))
};

const checks = [];
const check = (id, doc, expected, actual) => checks.push({ id, doc, expected, actual, match: JSON.stringify(expected) === JSON.stringify(actual) });
const FIN1 = 'docs/rewrite/domain-glossary.md#8-unit-conversion (V05, D42, FIN-1)';
check('every numeric factor conversion equals parseFloat((val*k).toFixed(1))', FIN1, true, factorTable.filter(r => r.formulaHolds !== null).every(r => r.formulaHolds));
check('Beaufort bands 0.3/1.5/3.3/5.5/8.0/10.8/13.9/17.2/20.7/24.5/28.4/32.6 m/s (lower edge inclusive)', FIN1,
  [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 0], beaufort.map(b => b.bft));
check('non-m/s sources are rounded to 1 decimal before banding', FIN1, [1, 2, 2], preRound.map(p => p.bft));
check('KMA Fahrenheit: 0.5 C -> 32.9 -> Math.floor 32', FIN1, { convertOnly: 32.9, kmaT1h: 32 }, { convertOnly: cv('C', 'F', 0.5), kmaT1h: kma['F,in,mph,inHg,mi'].t1h });
check('KMA temperature sentinel -50 is skipped', 'server/controllers/controllerTown24h.js _convertWeatherData', -50, kma['F,in,mph,inHg,mi'].sensorytem);
check('world Fahrenheit t1h is the stored temp_f (no floor)', FIN1, 32.9, worldOut.t1h);
check('client getTemp in F: KMA 32 displays 32, world 32.9 displays 33', FIN1, { kma: 32, world: 33 }, { kma: display.kmaF.displayed, world: display.worldF.displayed });
check("A04 output-neutral: convertUnits('mm','m/s',12.5) == convertUnits('mm','in',12.5) == 0.5", FIN1 + '; docs/rewrite/decisions-and-open-questions.md A04', [0.5, 0.5],
  [a04["convertUnits('mm','m/s',12.5)"], a04["convertUnits('mm','in',12.5)"]]);
check('A04: KMA rn1 12.5 mm -> 0.5 in for every wind unit', FIN1, { mph: 0.5, 'm/s': 0.5, 'km/h': 0.5, kt: 0.5, bft: 0.5 }, a04.kmaRn1ByWindUnit);
check('sentinel -1 mm -> -0 in, serialized as JSON 0', FIN1, { value: '-0', json: '{"v":0}' }, sentinels["convertUnits('mm','in',-1)"]);
check('sentinel -1 m/s -> -2.2 mph', FIN1, -2.2, sentinels["convertUnits('m/s','mph',-1)"]);
check('sentinel -1 hPa -> -0 inHg', FIN1, { value: '-0', json: '{"v":0}' }, sentinels["convertUnits('hPa','inHg',-1)"]);
check('KMA s06 -1 -> -10 mm -> -0.4 in', FIN1, -0.4, sentinels['KMA s06 -1 (cm) with precipitationUnit in']);

const record = {
  probe: 'server-unit-conversion',
  evidence_label: 'synthetic execution',
  command: 'node reports/rewrite-verification/probes/server-unit-conversion.js > reports/rewrite-verification/probes/server-unit-conversion.json',
  source_commit: 'bd6640f22c1029c35e8937b108be4b50ea89361a',
  date: '2026-09-25',
  rebaseline: { previous_source_commit: 'ff7acf3996ccb66c912d2ed4710cf300197d6966',
    note: 'Re-baselined 2026-09-25 from ff7acf39 to bd6640f2. controllerTown24h.js changed upstream (2116c6bf: makeResult adds historyStatus and passes short through history/policy.hourlyResponse), but _convertWeatherData is text-identical and moved from L2093-L2156 to L2094-L2157. unitConverter.js, controller.ww.units.js, controllerWorldWeather.js, kmaTimeLib.js and controller.forecastctrl.js have the same blob hashes. Inputs, outputs and all 13 checks are identical to the ff7acf39 run; additional_observation is new in this run.',
    node16_cross_check: 'Also run on 2026-09-25 with Node v16.20.2, the server runtime pinned by server/.nvmrc and package.json engines since c80ee014: every output and check was identical; only runtime.node differed. That run is not the stored record.' },
  runtime: { node: process.version, TZ: process.env.TZ },
  source: [{ file: 'server/lib/unitConverter.js', blob_sha1: blob('server/lib/unitConverter.js'),
    lines: 'L16-L34 _convertTemperature, L36-L76 _getBeaufort, L78-L94 _convertBeaufortToMs, L96-L182 _convertWindSpeed, L184-L223 _convertPressure, L225-L232 _convertDistance, L234-L241 _convertPrecipitation, L243-L272 convertUnits, L278-L281 getDefaultValueList', note: 'required as-is' }]
    .concat(Object.entries(exercised).map(([file, fns]) => ({ file, blob_sha1: blob(file), extracted: [...new Set(fns)] })))
    .concat([{ file: 'server/lib/kmaTimeLib.js', blob_sha1: blob('server/lib/kmaTimeLib.js'), note: 'required as-is (convertDateToYYYYMMDD in the world path)' },
      { file: 'server/controllers/worldWeather/controllerWorldWeather.js', lines: 'L2838-L2839', note: 'source reading only: temp_f = parseFloat(summary.temp.toFixed(1)); the world input temp_f 32.9 is synthetic' },
      { file: POLICY, blob_sha1: blob(POLICY), lines: 'L163-L180 hourlyResponse', note: 'required as-is (no requires); additional_observation only' },
      { file: 'server/routes/v000903/route.kma.v000903.js', lines: 'L59-L60', note: 'source reading only: convertUnits, insertStrForData, getSummaryAfterUnitConverter, makeResult order; not executed' },
      { file: 'server/controllers/controllerTown24h.js', lines: 'L1629', note: 'source reading only: makeResult sets result.short = hourlyResponse(req.short); not executed' },
      { file: 'server/controllers/controllerTown.js', lines: 'L1298-L1301, L4795-L4803', note: 'source reading only: mergeHourly runs only when config.history.readEnabled (ASOS_HISTORY_READ_ENABLED=true); on a recovered 3 h row _convertSummaryTo3H sets pty/lgt to -1 when no hourly value is usable and rn1 to -1 unless all three are usable, and copies historyObservation; not executed' }]),
  inputs: { kmaRow, worldThisTime: worldIn, beaufortSamplesMs: bands, preRoundSamples: preRound.map(p => ({ from: p.from, val: p.val })) },
  outputs: { factorTable, beaufort, preRound, kma, world: Object.fromEntries(Object.entries(worldOut).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : show(v)])),
    display, sentinels, precision, a04, logged },
  checks,
  all_checks_match: checks.every(c => c.match),
  additional_observation: {
    call: 'ControllerTown24h._convertWeatherData then history/policy.hourlyResponse on one short row (the v000903 order; insertStrForData and getSummaryAfterUnitConverter, which run between them, are not executed)',
    inputs: { recoveredRow, plainRow },
    results: hourlyProjection,
    note: 'Added at the bd6640f2 re-baseline; not one of the checks. hourlyResponse omits rn1/r06/s06 (and their *Str) on rows that carry historyObservation when the value is not a finite number >= 0. It runs after unit conversion, so with precipitationUnit in a -1 rn1 or r06 sentinel has already become -0, passes the < 0 test and serializes as 0, while s06 (-1 cm -> -10 mm -> -0.4 in) is omitted. With the default mm all three are omitted. Rows without historyObservation keep their converted sentinels. Recovered rows exist only when ASOS_HISTORY_READ_ENABLED is true; no request chain, database or recovered document was used.'
  },
  interpretation: 'Synthetic execution of the checked-in unit converter and of the KMA and world per-record conversion functions extracted from source, plus the client getTemp display helper, on synthetic values. It confirms the FIN-1 statements: fixed factors with 1-decimal rounding; the Beaufort bands, with non-m/s sources rounded before banding; KMA Fahrenheit values floored after conversion while the world path passes stored temp_f through and the client rounds in Fahrenheit (0.5 C shows 32 on the KMA path, a stored 32.9 F shows 33 on the world path); A04 changes no output because _convertPrecipitation ignores its target; sentinel -1 values become -0 (JSON 0), -2.2 or -0.4 depending on the unit. Two further outcomes are not in the FIN-1 text: a -1 m/s wind sentinel becomes Beaufort 0 (calm), and 0.1-1.2 mm of precipitation becomes 0 in. It does not run a request chain, so which fields reach a response in each unit, and whether any deployed response actually carried these values, is outside this probe. Re-run at bd6640f2: _convertWeatherData is text-identical to ff7acf39 and every check result is unchanged. The new additional_observation shows that the upstream hourly projection (2116c6bf; described in docs/architecture/mobile-api.md) does not omit a converted -0 inch rain sentinel on a recovered row.'
};
process.stdout.write(JSON.stringify(record, null, 1) + '\n');
