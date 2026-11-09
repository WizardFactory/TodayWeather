#!/usr/bin/env node
// Writes nation-reference/provenance.json next to the captures; capture.sh runs it. The file records:
// - the Cordova APK, and the sources of the nationwide and warning pages inside it, with the matching client/ files
//   and their last commits;
// - the emulator and the display;
// - every capture with its SHA-256.
// check-sources.mjs (tools/emulator) compares the tracked sources with client/.
//   node provenance.mjs <emulator-serial> <cordova-debug.apk> <android-dir>
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {apkVersion, cordovaSources, sha256} from '../emulator/cordova-sources.mjs';

const [serial, apk, root] = process.argv.slice(2);
if (!/^emulator-\d+$/.test(serial || '')) throw new Error('pass an emulator serial');
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args]).toString().trim();
const repo = path.resolve(root, '..');
const out = path.join(root, 'app/src/test/resources/nation-reference');

// The sources recorded:
// - the three pages (templates and controllers) and their request (service.weatherutil.js);
// - the menu (index.html, SettingCtrl's clickMenu) and the loading template (app.js);
// - the units and theme lists used for the unit and theme states;
// - the translations, the stylesheet, the image theme map and the map image.
// The stylesheet is a build output Git ignores; its tracked input is recorded.
const SOURCES = ['index.html', 'templates/nation.html', 'templates/nation-air.html', 'templates/kma-special.html',
    'js/controller.nation.js', 'js/controller.nation.air.js', 'js/controller.kma.special.js', 'js/controller.settingctrl.js',
    'js/controller.units.js', 'js/controller.setting.radio.js', 'js/service.weatherutil.js', 'js/app.js',
    'locales/ko.json', 'locales/en.json', 'data/theme.js', 'css/ionic.app.css', 'img/kr.png'];
const GENERATED_FROM = {'css/ionic.app.css': 'client/scss/ionic.app.scss'};
const {sources, inputs} = cordovaSources(apk, repo, SOURCES, GENERATED_FROM);

const files = fs.readdirSync(out, {recursive: true}).filter((f) => fs.statSync(path.join(out, f)).isFile() &&
    !['provenance.json', 'tolerances.json'].includes(f)).sort();
const provenance = {
    tool: 'android/tools/nation-reference/capture.sh',
    cordovaApk: {sha256: sha256(fs.readFileSync(apk)), ...apkVersion(apk), sources},
    inputs,
    emulator: {fingerprint: adb('shell', 'getprop', 'ro.build.fingerprint'), sdk: adb('shell', 'getprop', 'ro.build.version.sdk')},
    display: '384x832 dp at density 2 (wm size 768x1664, wm density 320)',
    language: 'per-app locale ko-KR, then en-KR (English with the region Korea, so the Korean menu rows show)',
    images: 'cut from the screen (screencap): S10 and S11 from the top of the page to 20 CSS px under the map; S12 and the ' +
        'loading, empty and failed states as the screen shows them; each S12 card whole (stitched when taller than the ' +
        'screen under the header)',
    server: 'a stand-in inside the WebView: corpus fixture kma-seoul for the place, corpus inputs nation.json for ' +
        '/v000903/nation/KR and special.json for /v000903/kma/special; an empty answer, a 500 and a 4 s late answer where ' +
        'a state needs one',
    place: 'kma-seoul (회현동)',
    files: files.map((f) => ({file: f, sha256: sha256(fs.readFileSync(path.join(out, f)))})),
};
fs.writeFileSync(path.join(out, 'provenance.json'), JSON.stringify(provenance, null, 1) + '\n');
console.log(`provenance: ${files.length} files; tracked nation sources in the APK match client/; inputs ${inputs.map((i) => i.file).join(', ')}`);
