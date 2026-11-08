#!/usr/bin/env node
// Writes chart-reference/provenance.json next to the captures (run by capture.sh): the Cordova APK and the
// chart sources inside it (with the matching client/ files and their last commits when the checkout has
// client/), the emulator and WebView, the display per size and every capture with its SHA-256.
//   node provenance.mjs <emulator-serial> <cordova-debug.apk> <android-dir>
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [serial, apk, root] = process.argv.slice(2);
if (!/^emulator-\d+$/.test(serial || '')) throw new Error('pass an emulator serial');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args]).toString().trim();
const repo = path.resolve(root, '..');
const git = (...args) => execFileSync('git', ['-C', repo, ...args]).toString().trim();

// Chart sources in the APK: the directives, controllers, templates, styles, D3 and the image theme map. The
// stylesheet and D3 are build outputs that Git ignores (gulp sass of client/scss, Bower); their tracked inputs
// are recorded instead, so check-sources.mjs works on a clean checkout.
const SOURCES = ['js/app.js', 'js/controller.forecastctrl.js', 'js/controller.tabctrl.js', 'js/service.weatherutil.js',
    'js/service.weatherinfo.js', 'templates/tab-forecast.html', 'templates/tab-dailyforecast.html', 'css/ionic.app.css',
    'lib/d3/d3.js', 'data/theme.js'];
const GENERATED_FROM = {'css/ionic.app.css': 'client/scss/ionic.app.scss', 'lib/d3/d3.js': 'client/bower.json'};
const tracked = (file) => execFileSync('git', ['-C', repo, 'ls-files', '--', file]).toString().trim() !== '';
const sources = SOURCES.map((file) => {
    const inApk = execFileSync('unzip', ['-p', apk, `assets/www/${file}`], {maxBuffer: 1 << 26});
    const entry = {file: `client/www/${file}`, apkSha256: sha(inApk), tracked: tracked(`client/www/${file}`)};
    if (GENERATED_FROM[file]) entry.generatedFrom = GENERATED_FROM[file];
    const local = path.join(repo, 'client/www', file);
    if (fs.existsSync(local)) {
        entry.clientSha256 = sha(fs.readFileSync(local));
        entry.matchesClient = entry.clientSha256 === entry.apkSha256;
        if (entry.tracked) entry.lastCommit = git('log', '-1', '--format=%H', '--', `client/www/${file}`);
    }
    return entry;
});
const notTracked = sources.filter((s) => !s.tracked && !s.generatedFrom).map((s) => s.file);
if (notTracked.length) throw new Error(`untracked chart sources without a tracked input: ${notTracked.join(', ')}`);
const mismatched = sources.filter((s) => s.tracked && !s.matchesClient).map((s) => s.file);
if (mismatched.length) throw new Error(`the APK was not built from this checkout: ${mismatched.join(', ')} differ from client/`);
const inputs = Object.values(GENERATED_FROM).map((file) => ({file, sha256: sha(fs.readFileSync(path.join(repo, file))),
    lastCommit: git('log', '-1', '--format=%H', '--', file)}));
const d3Version = (execFileSync('unzip', ['-p', apk, 'assets/www/lib/d3/d3.js'], {maxBuffer: 1 << 26}).toString()
    .match(/version: "([^"]+)"/) || [])[1];

const badging = execFileSync(fs.readdirSync(path.join(process.env.ANDROID_HOME || path.join(process.env.HOME, 'Library/Android/sdk'), 'build-tools'))
    .sort().reverse().map((v) => path.join(process.env.ANDROID_HOME || path.join(process.env.HOME, 'Library/Android/sdk'), 'build-tools', v, 'aapt2'))
    .find((p) => fs.existsSync(p)), ['dump', 'badging', apk]).toString();
const version = badging.match(/versionCode='(\d+)' versionName='([^']*)'/);

const files = (dir) => fs.readdirSync(dir, {recursive: true}).filter((f) => !fs.statSync(path.join(dir, f)).isDirectory()).sort();
const sceneRoot = path.join(root, 'core-domain/src/test/resources/chart-reference');
const sizes = fs.readdirSync(sceneRoot).filter((d) => /^\d+x\d+$/.test(d)).sort();
const captured = files(sceneRoot).filter((f) => /^\d+x\d+\//.test(f));

const provenance = {
    tool: 'android/tools/chart-reference/capture.sh',
    capturedAt: sizes.map((s) => JSON.parse(fs.readFileSync(path.join(sceneRoot, s, 'capture.json'), 'utf8')).capturedAt).sort()[0],
    cordovaApk: {sha256: sha(fs.readFileSync(apk)), versionCode: version && version[1], versionName: version && version[2], d3Version, sources},
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
