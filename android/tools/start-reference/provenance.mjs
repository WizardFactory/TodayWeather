#!/usr/bin/env node
// Writes start-reference/provenance.json next to the captures (run by capture.sh): the Cordova APK and the sources of
// the start page inside it with the matching client/ files and their last commits, the emulator, the display and every
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
const out = path.join(root, 'app/src/test/resources/start-reference');

// The start page (template, StartCtrl), its route and the popup service, the translations, the icon and the
// stylesheet. The stylesheet is a build output Git ignores; its tracked input is recorded.
const SOURCES = ['index.html', 'templates/start.html', 'js/controller.start.js', 'js/app.js', 'js/service.util.js', 'locales/ko.json',
    'locales/en.json', 'img/app_icon.png', 'css/ionic.app.css'];
const GENERATED_FROM = {'css/ionic.app.css': 'client/scss/ionic.app.scss'};
const {sources, inputs} = cordovaSources(apk, repo, SOURCES, GENERATED_FROM);

const files = fs.readdirSync(out, {recursive: true}).filter((f) => fs.statSync(path.join(out, f)).isFile() &&
    !['provenance.json', 'tolerances.json'].includes(f)).sort();
const provenance = {
    tool: 'android/tools/start-reference/capture.sh',
    cordovaApk: {sha256: sha256(fs.readFileSync(apk)), ...apkVersion(apk), sources},
    inputs,
    emulator: {fingerprint: adb('shell', 'getprop', 'ro.build.fingerprint'), sdk: adb('shell', 'getprop', 'ro.build.version.sdk')},
    display: '384x832 dp at density 2 (wm size 768x1664, wm density 320)',
    language: 'per-app locale ko-KR, then en-US',
    install: 'new install; the notification permission granted before the first start, location not',
    images: 'cut from the screen (screencap): the whole WebView with the access notice over the start page, then the start page',
    server: 'none; the emulator is offline',
    files: files.map((f) => ({file: f, sha256: sha256(fs.readFileSync(path.join(out, f)))})),
};
fs.writeFileSync(path.join(out, 'provenance.json'), JSON.stringify(provenance, null, 1) + '\n');
console.log(`provenance: ${files.length} files; tracked sources in the APK match client/; inputs ${inputs.map((i) => i.file).join(', ')}`);
