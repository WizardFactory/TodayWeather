#!/usr/bin/env node
// Writes push-reference/provenance.json next to the captures (run by capture.sh): the Cordova APK and the sources of
// S09 inside it with the matching client/ files and their last commits, the emulator, the display and every
// capture with its SHA-256. check-sources.mjs (tools/emulator) compares the tracked sources with client/.
//   node provenance.mjs <emulator-serial> <cordova-debug.apk> <android-dir>
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {apkVersion, cordovaSources, sha256} from '../emulator/cordova-sources.mjs';

const [serial, apk, root] = process.argv.slice(2);
if (!/^emulator-\d+$/.test(serial || '')) throw new Error('pass an emulator serial');
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args]).toString().trim();
const repo = path.resolve(root, '..');
const out = path.join(root, 'app/src/test/resources/push-reference');

// S09 (template, PushCtrl), the push service and its plugin wrapper, TabCtrl (O06, O07), the route, the translations, the
// stylesheet and the two Bower libraries (the time picker and the hour bar with its skin), build outputs Git ignores whose
// tracked inputs are recorded.
const SOURCES = ['index.html', 'templates/setting-push.html', 'js/controller.push.js', 'js/service.push.js', 'js/service.firebase.js',
    'js/controller.tabctrl.js', 'js/app.js', 'locales/ko.json', 'locales/en.json', 'css/ionic.app.css',
    'lib/ionic-timepicker/dist/ionic-timepicker.bundle.min.js', 'lib/ion.rangeSlider/js/ion.rangeSlider.min.js',
    'lib/ion.rangeSlider/css/ion.rangeSlider.css', 'lib/ion.rangeSlider/css/ion.rangeSlider.skinFlat.css', 'lib/ion.rangeSlider/img/sprite-skin-flat.png'];
const GENERATED_FROM = {'css/ionic.app.css': 'client/scss/ionic.app.scss'};
for (const file of SOURCES.filter((f) => f.startsWith('lib/'))) GENERATED_FROM[file] = 'client/bower.json';
const {sources, inputs} = cordovaSources(apk, repo, SOURCES, GENERATED_FROM);

const files = fs.readdirSync(out, {recursive: true}).filter((f) => fs.statSync(path.join(out, f)).isFile() &&
    !['provenance.json', 'tolerances.json'].includes(f)).sort();
const provenance = {
    tool: 'android/tools/push-reference/capture.sh',
    cordovaApk: {sha256: sha256(fs.readFileSync(apk)), ...apkVersion(apk), sources},
    inputs,
    emulator: {fingerprint: adb('shell', 'getprop', 'ro.build.fingerprint'), sdk: adb('shell', 'getprop', 'ro.build.version.sdk')},
    display: '384x832 dp at density 2 (wm size 768x1664, wm density 320)',
    language: 'per-app locale ko-KR, then en-US',
    install: 'new install; the notification permission granted before the first start',
    images: 'cut from the screen (screencap): the whole WebView in the seven states',
    server: 'a stand-in inside the WebView: corpus fixture kma-seoul for the weather, 200 for push requests (requests.json, the token replaced); the emulator is offline',
    files: files.map((f) => ({file: f, sha256: sha256(fs.readFileSync(path.join(out, f)))})),
};
fs.writeFileSync(path.join(out, 'provenance.json'), JSON.stringify(provenance, null, 1) + '\n');
console.log(`provenance: ${files.length} files; tracked sources in the APK match client/; inputs ${inputs.map((i) => i.file).join(', ')}`);
