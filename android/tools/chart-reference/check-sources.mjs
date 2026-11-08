#!/usr/bin/env node
// Fails when a Cordova chart source in client/www differs from the one the chart references were captured
// from (chart-reference/provenance.json), so a client change cannot leave the native chart tests comparing
// with an outdated Cordova chart. Run in the CI job that has client/; recapture with capture.sh.
//   node android/tools/chart-reference/check-sources.mjs
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const android = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const provenance = JSON.parse(fs.readFileSync(path.join(android, 'core-domain/src/test/resources/chart-reference/provenance.json'), 'utf8'));
const stale = provenance.cordovaApk.sources.filter((s) => {
    const file = path.join(android, '..', s.file);
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== s.apkSha256;
});
if (stale.length) {
    console.error(`chart references are older than ${stale.map((s) => s.file).join(', ')}; ` +
        'build the Cordova debug APK from this revision and run android/tools/chart-reference/capture.sh');
    process.exit(1);
}
console.log(`chart sources unchanged since the capture (${provenance.cordovaApk.sources.length} files)`);
