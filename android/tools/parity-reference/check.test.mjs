import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {verifyMatrix} from './check.mjs';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-parity-check-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const dir = path.join(root, '320x694/example');
    fs.mkdirSync(path.join(dir, 'ko-KR'), {recursive: true});
    const viewport = {nominal: {width: 320, height: 694}, webView: {width: 320, height: 624, screenWidth: 320,
        screenHeight: 694, dpr: 2, language: 'ko-KR'}, origin: {x: 0, y: 92}};
    fs.writeFileSync(path.join(dir, 'ko-KR/viewport.json'), JSON.stringify(viewport));
    // Real one-pixel PNG; geometry belongs to the viewport record, not arbitrary crop dimensions.
    fs.writeFileSync(path.join(dir, 'ko-KR/example.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64'));
    const provenance = {cordovaApk: {sha256: '1'.repeat(64), sources: [{file: 'client/www/js/app.js'}]},
        files: ['ko-KR/example.png', 'ko-KR/viewport.json'].map(file => ({file, sha256: sha(fs.readFileSync(path.join(dir, file)))}))};
    fs.writeFileSync(path.join(dir, 'provenance.json'), JSON.stringify(provenance));
    fs.writeFileSync(path.join(dir, 'tolerances.json'), JSON.stringify({cases: {'ko-KR/example': {strong: 0.01, mean: 2, heightDifference: 0}}}));
    const manifest = {sizes: ['320x694'], languages: ['ko-KR'], sets: {example: {cases: [{image: '{lang}/example.png', tolerance: '{lang}/example'}]}}};
    return {root, dir, manifest, provenance, viewport};
}
test('a complete, source-bound declared comparison passes', t => {
    const f = fixture(t);
    assert.deepEqual(verifyMatrix(f.root, f.manifest), {comparisons: 1, problems: []});
});
test('missing image, modified capture and missing tolerance cannot pass', t => {
    const f = fixture(t);
    fs.appendFileSync(path.join(f.dir, 'ko-KR/example.png'), 'changed');
    assert.match(verifyMatrix(f.root, f.manifest).problems.join('\n'), /hash differs/);
    fs.unlinkSync(path.join(f.dir, 'ko-KR/example.png'));
    assert.ok(verifyMatrix(f.root, f.manifest).problems.length);
    fs.writeFileSync(path.join(f.dir, 'ko-KR/example.png'), 'wrong');
    fs.writeFileSync(path.join(f.dir, 'tolerances.json'), '{"cases":{}}');
    assert.match(verifyMatrix(f.root, f.manifest).problems.join('\n'), /invalid\/missing tolerance/);
});
test('even rehashed evidence cannot claim a wrong nominal size or language', t => {
    const f = fixture(t);
    f.viewport.webView.screenWidth = 360;
    const file = 'ko-KR/viewport.json';
    fs.writeFileSync(path.join(f.dir, file), JSON.stringify(f.viewport));
    f.provenance.files.find(x => x.file === file).sha256 = sha(fs.readFileSync(path.join(f.dir, file)));
    fs.writeFileSync(path.join(f.dir, 'provenance.json'), JSON.stringify(f.provenance));
    assert.match(verifyMatrix(f.root, f.manifest).problems.join('\n'), /display differs/);
    f.viewport.webView.screenWidth = 320;
    f.viewport.webView.language = 'en-US';
    fs.writeFileSync(path.join(f.dir, file), JSON.stringify(f.viewport));
    f.provenance.files.find(x => x.file === file).sha256 = sha(fs.readFileSync(path.join(f.dir, file)));
    fs.writeFileSync(path.join(f.dir, 'provenance.json'), JSON.stringify(f.provenance));
    assert.match(verifyMatrix(f.root, f.manifest).problems.join('\n'), /wrong language/);
});
test('duplicate or escaping provenance entries are rejected', t => {
    const f = fixture(t);
    f.provenance.files.push({file: '../outside.png', sha256: '0'.repeat(64)});
    fs.writeFileSync(path.join(f.dir, 'provenance.json'), JSON.stringify(f.provenance));
    assert.match(verifyMatrix(f.root, f.manifest).problems.join('\n'), /invalid\/duplicate/);
});
