#!/usr/bin/env node
// Fails when a tracked Cordova source differs from the one a set of references was captured from (the
// provenance.json of chart-reference and shell-reference, cordova-sources.mjs): the files in client/www and the
// inputs of the build outputs Git ignores (client/scss/ionic.app.scss for the stylesheet, client/bower.json for
// D3 and Ionic). So a client change cannot leave the native tests comparing with an outdated Cordova screen.
// Runs on a clean checkout (CI job with client/); recapture with the set's capture.sh.
//   node android/tools/emulator/check-sources.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {REFERENCE_SETS, sha256} from './cordova-sources.mjs';

const android = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Matrix sets retain their own APK/source provenance rather than inheriting an
// old baseline's claim. Coverage validation separately requires every manifest entry.
const matrixRoot = path.join(android, 'app/src/test/resources/parity-reference');
const matrix = fs.existsSync(matrixRoot) ? fs.readdirSync(matrixRoot, {recursive: true})
    .filter(f => f.endsWith('/provenance.json')).map(f => ({
        name: `parity/${f.slice(0, -'/provenance.json'.length)}`,
        provenance: path.relative(android, path.join(matrixRoot, f)),
        tool: 'android/tools/parity-reference/capture.sh',
    })) : [];
let failed = false;
for (const set of [...REFERENCE_SETS, ...matrix]) {
    const provenance = JSON.parse(fs.readFileSync(path.join(android, set.provenance), 'utf8'));
    const checks = [
        ...provenance.cordovaApk.sources.filter((s) => s.tracked).map((s) => ({file: s.file, sha256: s.clientSha256})),
        ...provenance.inputs.map((i) => ({file: i.file, sha256: i.sha256})),
    ];
    const stale = checks.filter((c) => {
        const file = path.join(android, '..', c.file);
        return !fs.existsSync(file) || sha256(fs.readFileSync(file)) !== c.sha256;
    });
    if (stale.length) {
        failed = true;
        console.error(`${set.name} references are older than ${stale.map((c) => c.file).join(', ')}; ` +
            `build the Cordova debug APK from this revision and run ${set.tool}`);
    } else {
        console.log(`${set.name} sources unchanged since the capture (${checks.length} tracked files)`);
    }
}
if (failed) process.exit(1);
