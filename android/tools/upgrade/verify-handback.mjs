#!/usr/bin/env node
// The fallback Cordova build in the rollback hand-back test (AN-17, run-handback-test.sh), driven over WebView DevTools
// through the app's own services:
//   node verify-handback.mjs check <adb-serial> <suite.xml> <expected.json>
//       the build shows the state the native app handed back in suite.xml (pulled before this build started), applied
//       it once and claimed it; expected.json names what the native edits must have produced
//       ({"names", "index", "temperatureUnit", "theme", "consent"})
//   node verify-handback.mjs edit <adb-serial>      S02, S09 and settings edits there, and an analytics grant
//   node verify-handback.mjs withdraw <adb-serial>  the analytics choice withdrawn there
// Prints what it saw as JSON; exits 1 with the differences on a mismatch. Run with the emulator offline.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {connect} from '../emulator/devtools.mjs';

const KEYS = ['cities', 'cityIndex', 'cityList', 'units', 'settingsInfo', 'pushData2', 'pushData', 'expandShortChart',
    'startVersion', 'appVersion', 'disableUpdateInfo', 'twAnalyticsConsentV1'];

/** The string entries of a SharedPreferences file. */
function suiteValues(xml) {
    const named = {quot: '"', amp: '&', lt: '<', gt: '>', apos: "'"};
    const decode = (s) => s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|quot|amp|lt|gt|apos);/g, (_, e) => named[e] ??
        String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
    const values = {};
    for (const m of xml.matchAll(/<string name="([^"]*)">([\s\S]*?)<\/string>/g)) values[decode(m[1])] = decode(m[2]);
    return values;
}

const SERVICES = `var inj = angular.element(document.body).injector();
    var WeatherInfo = inj.get('WeatherInfo'), TwStorage = inj.get('TwStorage'), Units = inj.get('Units'), Push = inj.get('Push');
    var Monetization = inj.get('Monetization'), $rootScope = inj.get('$rootScope');
    var suite = window.plugins.appPreferences.suite('group.net.wizardfactory.todayweather');
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function fetchKey(key) { return new Promise(function (ok) { suite.fetch(ok, function () { ok(null); }, key); }); }`;

// What the app holds after its start: the services' state, the stored texts and the suite's marker.
const SNAPSHOT = `(function () { ${SERVICES}
    var cities = [];
    for (var i = 0; i < WeatherInfo.getCityCount(); i++) {
        var c = WeatherInfo.getCityOfIndex(i);
        cities.push({name: c.name || null, address: c.address || null, location: c.location || null, disable: !!c.disable});
    }
    var local = {};
    ${JSON.stringify(KEYS)}.forEach(function (k) { local[k] = localStorage.getItem(k); });
    return Promise.all([fetchKey('_twHandBack'), fetchKey('twAnalyticsConsentV1')]).then(function (suiteValues) {
        return {cities: cities, cityIndex: WeatherInfo.getCityIndex(), units: Units.getAllUnits(), settingsInfo: $rootScope.settingsInfo,
            // loadPushInfo holds the times as Dates, which DevTools returns as {}: their JSON is the stored text.
            pushList: JSON.parse(JSON.stringify(Push.pushData.pushList)), fcmToken: Push.pushData.fcmToken,
            choice: Monetization.getCollectionChoice(),
            applied: localStorage.getItem('twHandBackApplied'), local: local, marker: suiteValues[0], suiteConsent: suiteValues[1]};
    });
})()`;

// S02: 부산 (index 2) deleted as OnDeleteCity does, 대전 added and selected; S09: an alarm at 09:00 for 대전 (index 2);
// settings: °F and the dark theme; the menu's analytics grant.
const EDIT = `(function () { ${SERVICES}
    if (WeatherInfo.getCityOfIndex(2).name !== '부산') { throw new Error('unexpected place ' + WeatherInfo.getCityOfIndex(2).name); }
    if (Push.hasPushInfo(2)) { Push.removePushListByCityIndex(2); }
    WeatherInfo.removeCity(2);
    WeatherInfo.addCity({name: '대전', address: '대한민국 대전광역시', country: 'KR', location: {lat: 36.35, long: 127.38},
        currentPosition: false});
    WeatherInfo.setCityIndex(WeatherInfo.getCityCount() - 1);
    Push.updatePushListByCityIndex([Push.newPushAlarm(2, 2, 9 * 3600, [true, true, true, true, true, true, true])], 2);
    Units.setUnit('temperatureUnit', 'F');
    Units.saveUnits();
    $rootScope.settingsInfo.theme = 'dark';
    TwStorage.set('settingsInfo', $rootScope.settingsInfo);
    return new Promise(function (resolve) { Monetization.setCollectionEnabled(true, resolve); })
        // The suite writes are asynchronous, and WebView storage reaches its files later still.
        .then(function () { return wait(6000); })
        .then(function () { return fetchKey('twAnalyticsConsentV1'); })
        .then(function (mirrored) {
            return {choice: Monetization.getCollectionChoice(), mirrored: mirrored, places: WeatherInfo.getCityCount(),
                cityIndex: WeatherInfo.getCityIndex()};
        });
})()`;

const WITHDRAW = `(function () { ${SERVICES}
    return new Promise(function (resolve) { Monetization.setCollectionEnabled(false, resolve); })
        .then(function () { return wait(6000); })
        .then(function () { return fetchKey('twAnalyticsConsentV1'); })
        .then(function (mirrored) {
            return {choice: Monetization.getCollectionChoice(), stored: localStorage.getItem('twAnalyticsConsentV1'), mirrored: mirrored};
        });
})()`;

const [mode, serial, suiteFile, expectedJson] = process.argv.slice(2);
if (!['check', 'edit', 'withdraw'].includes(mode)) throw new Error('mode: check, edit or withdraw');
const page = await connect(serial);
await page.settled();
const problems = [];
const same = (what, actual, expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) problems.push(`${what}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
};
let result;
if (mode === 'check') {
    const suite = suiteValues(fs.readFileSync(suiteFile, 'utf8'));
    const expected = JSON.parse(expectedJson);
    const handed = JSON.parse(suite._twHandBack);
    same('hand-back marker', [handed.schema, handed.writer, handed.complete, handed.keys], [1, 'native', true, KEYS]);
    const seen = await page.evaluate(SNAPSHOT);
    // The services show the handed-back state.
    const cities = JSON.parse(suite.cities).map((c) => [c.name || null, c.address || null, c.location || null, !!c.disable]);
    same('places', seen.cities.map((c) => [c.name, c.address, c.location, c.disable]), cities);
    same('place names', seen.cities.map((c) => c.name), expected.names);
    same('selected place', seen.cityIndex, Number(suite.cityIndex));
    same('expected selection', seen.cityIndex, expected.index);
    same('units', seen.units, JSON.parse(suite.units));
    same('temperature unit', seen.units.temperatureUnit, expected.temperatureUnit);
    same('settings', seen.settingsInfo, JSON.parse(suite.settingsInfo));
    same('theme', seen.settingsInfo.theme, expected.theme);
    const pushData2 = JSON.parse(suite.pushData2);
    same('alarms and alerts', seen.pushList, pushData2.pushList);
    same('FCM token', seen.fcmToken, pushData2.fcmToken);
    same('analytics choice', seen.choice, expected.consent);
    same('legacy alarms', seen.local.pushData, null);
    // Applied once, then claimed with the next generation.
    same('applied generation', seen.applied, String(handed.generation));
    const claim = seen.marker && JSON.parse(seen.marker);
    same('claim', claim && [claim.schema, claim.generation, claim.writer, claim.complete, claim.keys], [1, handed.generation + 1, 'cordova', true, KEYS]);
    // The stored texts: equal to the hand-back unless the app rewrote a key at its start (listed for the record).
    const rewritten = KEYS.filter((k) => seen.local[k] !== (suite[k] ?? null));
    result = {generation: handed.generation, seen, rewritten: rewritten.map((k) => ({key: k, handed: suite[k] ?? null, stored: seen.local[k]}))};
} else if (mode === 'edit') {
    result = await page.evaluate(EDIT);
    same('analytics choice', result.choice, true);
    same('mirrored choice', result.mirrored, 'true');
    same('places', result.places, 3);
    same('selected place', result.cityIndex, 2);
} else {
    result = await page.evaluate(WITHDRAW);
    same('analytics choice', result.choice, false);
    same('stored choice', result.stored, 'false');
    same('mirrored choice', result.mirrored, 'false');
}
page.close();
execFileSync('adb', ['-s', serial, 'forward', '--remove', 'tcp:9339']);
process.stdout.write(JSON.stringify({mode, problems, result}, null, 1) + '\n');
if (problems.length) {
    process.stderr.write(problems.join('\n') + '\n');
    process.exit(1);
}
