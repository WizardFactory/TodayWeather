#!/usr/bin/env node
// Writes air-reference/provenance.json next to the captures (run by capture.sh): the Cordova APK and the S05 sources
// inside it with the matching client/ files and their last commits, the emulator, the display and every capture with
// its SHA-256. check-sources.mjs (tools/emulator) compares the tracked sources with client/.
//   node provenance.mjs <emulator-serial> <cordova-debug.apk> <android-dir>
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {apkVersion, cordovaSources, sha256} from '../emulator/cordova-sources.mjs';

const [serial, apk, root] = process.argv.slice(2);
if (!/^emulator-\d+$/.test(serial || '')) throw new Error('pass an emulator serial');
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args]).toString().trim();
const repo = path.resolve(root, '..');
const out = path.join(root, 'app/src/test/resources/air-reference');

// S05 sources in the APK: the template, AirCtrl, TabCtrl (standards, colors, icons, sizes, tab handlers), the chart
// directive in app.js and D3, the services, the units page's standard names, the Korean translations, the stylesheet
// and the image theme map. Build outputs that Git ignores record their tracked inputs.
const SOURCES = ['templates/tab-air.html', 'templates/tabs-android.html', 'js/controller.air.js', 'js/controller.tabctrl.js',
    'js/app.js', 'js/service.weatherutil.js', 'js/service.weatherinfo.js', 'js/controller.units.js', 'locales/ko.json',
    'data/theme.js', 'css/ionic.app.css', 'lib/d3/d3.js'];
const GENERATED_FROM = {'css/ionic.app.css': 'client/scss/ionic.app.scss', 'lib/d3/d3.js': 'client/bower.json'};
const {sources, inputs} = cordovaSources(apk, repo, SOURCES, GENERATED_FROM);

const files = fs.readdirSync(out, {recursive: true}).filter((f) => fs.statSync(path.join(out, f)).isFile() &&
    !['provenance.json', 'tolerances.json'].includes(f)).sort();
const provenance = {
    tool: 'android/tools/air-reference/capture.sh',
    cordovaApk: {sha256: sha256(fs.readFileSync(apk)), ...apkVersion(apk), sources},
    inputs,
    emulator: {fingerprint: adb('shell', 'getprop', 'ro.build.fingerprint'), sdk: adb('shell', 'getprop', 'ro.build.version.sdk')},
    display: '384x832 dp at density 2 (wm size 768x1664, wm density 320)',
    language: 'per-app locale ko-KR',
    images: 'cut from the screen (screencap) at the block rects of <state>/air.json',
    places: 'kma-seoul (회현동), then vc-london (런던) and kma-jeju without air data (연동) added and selected: AN-02 corpus inputs',
    files: files.map((f) => ({file: f, sha256: sha256(fs.readFileSync(path.join(out, f)))})),
};
fs.writeFileSync(path.join(out, 'provenance.json'), JSON.stringify(provenance, null, 1) + '\n');
console.log(`provenance: ${files.length} files; tracked S05 sources in the APK match client/; inputs ${inputs.map((i) => i.file).join(', ')}`);
