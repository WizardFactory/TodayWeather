#!/usr/bin/env node
// Writes settings-reference/provenance.json next to the captures (run by capture.sh): the Cordova APK and the sources
// of the settings pages inside it with the matching client/ files and their last commits, the emulator, the display and
// every capture with its SHA-256. check-sources.mjs (tools/emulator) compares the tracked sources with client/.
//   node provenance.mjs <emulator-serial> <cordova-debug.apk> <android-dir>
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {apkVersion, cordovaSources, sha256} from '../emulator/cordova-sources.mjs';

const [serial, apk, root] = process.argv.slice(2);
if (!/^emulator-\d+$/.test(serial || '')) throw new Error('pass an emulator serial');
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args]).toString().trim();
const repo = path.resolve(root, '..');
const out = path.join(root, 'app/src/test/resources/settings-reference');

// The settings pages (S07, S08), the menu and its popup (index.html, SettingCtrl), the weather page they change, the
// translations, the stylesheet and the image theme map. The stylesheet is a build output Git ignores; its tracked input
// is recorded.
const SOURCES = ['index.html', 'templates/units.html', 'templates/setting-radio.html', 'templates/tab-forecast.html',
    'js/controller.settingctrl.js', 'js/controller.units.js', 'js/controller.setting.radio.js', 'js/controller.forecastctrl.js',
    'js/controller.tabctrl.js', 'js/service.push.js', 'js/service.weatherutil.js', 'js/service.weatherinfo.js', 'js/app.js',
    'locales/ko.json', 'locales/en.json', 'data/theme.js', 'css/ionic.app.css'];
const GENERATED_FROM = {'css/ionic.app.css': 'client/scss/ionic.app.scss'};
const {sources, inputs} = cordovaSources(apk, repo, SOURCES, GENERATED_FROM);

const files = fs.readdirSync(out, {recursive: true}).filter((f) => fs.statSync(path.join(out, f)).isFile() &&
    !['provenance.json', 'tolerances.json'].includes(f)).sort();
const provenance = {
    tool: 'android/tools/settings-reference/capture.sh',
    cordovaApk: {sha256: sha256(fs.readFileSync(apk)), ...apkVersion(apk), sources},
    inputs,
    emulator: {fingerprint: adb('shell', 'getprop', 'ro.build.fingerprint'), sdk: adb('shell', 'getprop', 'ro.build.version.sdk')},
    display: '384x832 dp at density 2 (wm size 768x1664, wm density 320)',
    language: 'per-app locale ko-KR, then en-US',
    images: 'cut from the screen (screencap): a settings page from its top to 20 CSS px under its list, the About state whole, ' +
        'the weather page block by block (tools/emulator/page-blocks.mjs)',
    server: 'a stand-in inside the WebView: corpus fixtures kma-seoul (°C) and kma-seoul-f (°F) by the requested units, ' +
        'photo.png (photo.mjs) for every sky of the feed, 200 for the push list',
    place: 'kma-seoul (회현동) with an alarm and a token',
    files: files.map((f) => ({file: f, sha256: sha256(fs.readFileSync(path.join(out, f)))})),
};
fs.writeFileSync(path.join(out, 'provenance.json'), JSON.stringify(provenance, null, 1) + '\n');
console.log(`provenance: ${files.length} files; tracked settings sources in the APK match client/; inputs ${inputs.map((i) => i.file).join(', ')}`);
