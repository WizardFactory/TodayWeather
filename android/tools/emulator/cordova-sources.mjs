// The Cordova sources that a set of references was captured from (chart, shell, forecast, air, settings, nation, privacy,
// start and places references): each file of the APK's www with the matching client/www file, whether Git tracks it and its last
// commit. Build outputs that Git ignores (gulp sass of client/scss, Bower) name the tracked input they come from,
// which is recorded instead, so that check-sources.mjs works on a clean checkout.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** The provenance files that check-sources.mjs verifies, relative to android/, with the tool that rewrites each. */
export const REFERENCE_SETS = [
    {name: 'chart', provenance: 'core-domain/src/test/resources/chart-reference/provenance.json', tool: 'android/tools/chart-reference/capture.sh'},
    {name: 'shell', provenance: 'app/src/test/resources/shell-reference/provenance.json', tool: 'android/tools/shell-reference/capture.sh'},
    {name: 'forecast', provenance: 'app/src/test/resources/forecast-reference/provenance.json', tool: 'android/tools/forecast-reference/capture.sh'},
    {name: 'air', provenance: 'app/src/test/resources/air-reference/provenance.json', tool: 'android/tools/air-reference/capture.sh'},
    {name: 'settings', provenance: 'app/src/test/resources/settings-reference/provenance.json', tool: 'android/tools/settings-reference/capture.sh'},
    {name: 'nation', provenance: 'app/src/test/resources/nation-reference/provenance.json', tool: 'android/tools/nation-reference/capture.sh'},
    {name: 'privacy', provenance: 'app/src/test/resources/privacy-reference/provenance.json', tool: 'android/tools/privacy-reference/capture.sh'},
    {name: 'start', provenance: 'app/src/test/resources/start-reference/provenance.json', tool: 'android/tools/start-reference/capture.sh'},
    {name: 'places', provenance: 'app/src/test/resources/places-reference/provenance.json', tool: 'android/tools/places-reference/capture.sh'},
];

/**
 * [files] (paths under www/) in the APK against client/www of the checkout at [repo]. [generatedFrom] maps an
 * ignored build output to its tracked input. Throws when the APK was not built from this checkout.
 */
export function cordovaSources(apk, repo, files, generatedFrom) {
    const git = (...args) => execFileSync('git', ['-C', repo, ...args]).toString().trim();
    const tracked = (file) => git('ls-files', '--', file) !== '';
    const sources = files.map((file) => {
        const inApk = execFileSync('unzip', ['-p', apk, `assets/www/${file}`], {maxBuffer: 1 << 26});
        const entry = {file: `client/www/${file}`, apkSha256: sha256(inApk), tracked: tracked(`client/www/${file}`)};
        if (generatedFrom[file]) entry.generatedFrom = generatedFrom[file];
        const local = path.join(repo, 'client/www', file);
        if (fs.existsSync(local)) {
            entry.clientSha256 = sha256(fs.readFileSync(local));
            entry.matchesClient = entry.clientSha256 === entry.apkSha256;
            if (entry.tracked) entry.lastCommit = git('log', '-1', '--format=%H', '--', `client/www/${file}`);
        }
        return entry;
    });
    const notTracked = sources.filter((s) => !s.tracked && !s.generatedFrom).map((s) => s.file);
    if (notTracked.length) throw new Error(`untracked sources without a tracked input: ${notTracked.join(', ')}`);
    const mismatched = sources.filter((s) => s.tracked && !s.matchesClient).map((s) => s.file);
    if (mismatched.length) throw new Error(`the APK was not built from this checkout: ${mismatched.join(', ')} differ from client/`);
    const inputs = [...new Set(Object.values(generatedFrom))].map((file) => ({file, sha256: sha256(fs.readFileSync(path.join(repo, file))),
        lastCommit: git('log', '-1', '--format=%H', '--', file)}));
    return {sources, inputs};
}

/** versionCode and versionName of the APK (aapt2 of the newest installed build tools). */
export function apkVersion(apk) {
    const sdk = process.env.ANDROID_HOME || path.join(process.env.HOME, 'Library/Android/sdk');
    const aapt2 = fs.readdirSync(path.join(sdk, 'build-tools')).sort().reverse().map((v) => path.join(sdk, 'build-tools', v, 'aapt2'))
        .find((p) => fs.existsSync(p));
    const badging = execFileSync(aapt2, ['dump', 'badging', apk]).toString();
    const version = badging.match(/versionCode='(\d+)' versionName='([^']*)'/);
    return {versionCode: version && version[1], versionName: version && version[2]};
}
