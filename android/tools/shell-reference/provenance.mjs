#!/usr/bin/env node
// Writes shell-reference/provenance.json next to the captures (run by capture.sh): the Cordova APK and the shell
// sources inside it with the matching client/ files and their last commits, the emulator, the display and every
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
const out = path.join(root, 'app/src/test/resources/shell-reference');

// Shell sources in the APK: the side menu (index.html), tab bar and forecast header templates, the controllers
// behind them, the translations shown, the stylesheet, and Ionic's script (title placement) and icon font. The
// stylesheet and Ionic are build outputs that Git ignores; their tracked inputs are recorded instead.
const SOURCES = ['index.html', 'templates/tabs-android.html', 'templates/tab-forecast.html', 'js/app.js',
    'js/controller.settingctrl.js', 'js/controller.tabctrl.js', 'locales/ko.json', 'locales/en.json', 'css/ionic.app.css',
    'lib/ionic/js/ionic.bundle.js', 'lib/ionic/fonts/ionicons.ttf'];
const GENERATED_FROM = {'css/ionic.app.css': 'client/scss/ionic.app.scss', 'lib/ionic/js/ionic.bundle.js': 'client/bower.json',
    'lib/ionic/fonts/ionicons.ttf': 'client/bower.json'};
const {sources, inputs} = cordovaSources(apk, repo, SOURCES, GENERATED_FROM);

const files = fs.readdirSync(out, {recursive: true}).filter((f) => fs.statSync(path.join(out, f)).isFile() &&
    !['provenance.json', 'tolerances.json'].includes(f)).sort();
const provenance = {
    tool: 'android/tools/shell-reference/capture.sh',
    cordovaApk: {sha256: sha256(fs.readFileSync(apk)), ...apkVersion(apk), sources},
    inputs,
    emulator: {fingerprint: adb('shell', 'getprop', 'ro.build.fingerprint'), sdk: adb('shell', 'getprop', 'ro.build.version.sdk')},
    display: '384x832 dp at density 2 (wm size 768x1664, wm density 320)',
    languages: 'per-app locales ko-KR and en-US',
    images: 'cut from the screen (screencap) at the element rects of <theme>.json',
    files: files.map((f) => ({file: f, sha256: sha256(fs.readFileSync(path.join(out, f)))})),
};
fs.writeFileSync(path.join(out, 'provenance.json'), JSON.stringify(provenance, null, 1) + '\n');
console.log(`provenance: ${files.length} files; tracked shell sources in the APK match client/; inputs ${inputs.map((i) => i.file).join(', ')}`);
