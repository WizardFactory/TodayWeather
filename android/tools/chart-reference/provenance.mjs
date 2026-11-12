#!/usr/bin/env node
// Writes chart-reference/provenance.json next to the captures (run by capture.sh): the Cordova APK and the
// chart sources inside it (with the matching client/ files and their last commits when the checkout has
// client/), the emulator and WebView, the display per size and every capture with its SHA-256.
//   node provenance.mjs <emulator-serial> <cordova-debug.apk> <android-dir>
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {apkVersion, cordovaSources, sha256 as sha} from '../emulator/cordova-sources.mjs';

const [serial, apk, root] = process.argv.slice(2);
if (!/^emulator-\d+$/.test(serial || '')) throw new Error('pass an emulator serial');
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args]).toString().trim();
const repo = path.resolve(root, '..');

// Chart sources in the APK: the directives, controllers, templates, styles, D3 and the image theme map. The
// stylesheet and D3 are build outputs that Git ignores; their tracked inputs are recorded instead.
const SOURCES = ['js/app.js', 'js/controller.forecastctrl.js', 'js/controller.tabctrl.js', 'js/service.weatherutil.js',
    'js/service.weatherinfo.js', 'templates/tab-forecast.html', 'templates/tab-dailyforecast.html', 'css/ionic.app.css',
    'lib/d3/d3.js', 'data/theme.js', ...(process.env.TW_REFERENCE_SIZE ? ['locales/ko.json', 'locales/en.json'] : [])];
const GENERATED_FROM = {'css/ionic.app.css': 'client/scss/ionic.app.scss', 'lib/d3/d3.js': 'client/bower.json'};
const {sources, inputs} = cordovaSources(apk, repo, SOURCES, GENERATED_FROM);
const d3Version = (execFileSync('unzip', ['-p', apk, 'assets/www/lib/d3/d3.js'], {maxBuffer: 1 << 26}).toString()
    .match(/version: "([^"]+)"/) || [])[1];

const version = apkVersion(apk);

const files = (dir) => fs.readdirSync(dir, {recursive: true}).filter((f) => !fs.statSync(path.join(dir, f)).isDirectory()).sort();
const sceneRoot = process.env.TW_REFERENCE_ROOT || path.join(root, 'core-domain/src/test/resources/chart-reference');
const sizes = fs.readdirSync(sceneRoot).filter((d) => process.env.TW_REFERENCE_SIZE ? /^(ko-KR|en-US)$/.test(d) : /^\d+x\d+$/.test(d)).sort();
const captured = files(sceneRoot).filter((f) => process.env.TW_REFERENCE_SIZE ? /^(ko-KR|en-US)\//.test(f) : /^\d+x\d+\//.test(f));

const provenance = {
    tool: process.env.TW_REFERENCE_SIZE ? 'android/tools/parity-reference/capture.sh' : 'android/tools/chart-reference/capture.sh',
    capturedAt: sizes.map((s) => JSON.parse(fs.readFileSync(path.join(sceneRoot, s, 'capture.json'), 'utf8')).capturedAt).sort()[0],
    cordovaApk: {sha256: sha(fs.readFileSync(apk)), ...version, d3Version, sources},
    inputs,
    emulator: {fingerprint: adb('shell', 'getprop', 'ro.build.fingerprint'), sdk: adb('shell', 'getprop', 'ro.build.version.sdk'),
        locale: adb('shell', 'getprop', 'persist.sys.locale') || adb('shell', 'getprop', 'ro.product.locale')},
    displays: Object.fromEntries(sizes.map((s) => [s, JSON.parse(fs.readFileSync(path.join(sceneRoot, s, 'capture.json'), 'utf8'))])),
    fixtures: 'AN-02 corpus (core-domain/src/test/resources/corpus): conversion/<name>.json input or inputs/<inputFile>; kma-seoul-sharp is kma-seoul with current.liveTime "2400"',
    files: captured.map((f) => ({file: f, sha256: sha(fs.readFileSync(path.join(sceneRoot, f)))})),
};
fs.writeFileSync(path.join(sceneRoot, 'provenance.json'), JSON.stringify(provenance, null, 1) + '\n');
console.log(`provenance: ${captured.filter((f) => f.endsWith('.json')).length} scene files, ${captured.filter((f) => f.endsWith('.png')).length} captures; ` +
    `tracked chart sources in the APK match client/; inputs ${inputs.map((i) => i.file).join(', ')}`);
