#!/usr/bin/env node
// Fails when a tracked Cordova chart source differs from the one the chart references were captured from
// (chart-reference/provenance.json): the directives, controllers, templates and theme map in client/www, and
// the inputs of the build outputs Git ignores (client/scss/ionic.app.scss for the stylesheet, client/bower.json
// for D3). So a client change cannot leave the native chart tests comparing with an outdated Cordova chart.
// Runs on a clean checkout (CI job with client/); recapture with capture.sh.
//   node android/tools/chart-reference/check-sources.mjs
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const android = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const provenance = JSON.parse(fs.readFileSync(path.join(android, 'core-domain/src/test/resources/chart-reference/provenance.json'), 'utf8'));
const checks = [
    ...provenance.cordovaApk.sources.filter((s) => s.tracked).map((s) => ({file: s.file, sha256: s.clientSha256})),
    ...provenance.inputs.map((i) => ({file: i.file, sha256: i.sha256})),
];
const stale = checks.filter((c) => {
    const file = path.join(android, '..', c.file);
    return !fs.existsSync(file) || createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== c.sha256;
});
if (stale.length) {
    console.error(`chart references are older than ${stale.map((c) => c.file).join(', ')}; ` +
        'build the Cordova debug APK from this revision and run android/tools/chart-reference/capture.sh');
    process.exit(1);
}
console.log(`chart sources unchanged since the capture (${checks.length} tracked files)`);
