/* S15b-3 air store oracle driver (task evidence, not a repository tool). Runs legacy AirKorea
 * collectors and readers with Mongoose 5.1.2 and the in-memory collection double. No network.
 * Run: run.sh record-air.js <out.json.gz>
 */
'use strict';
const L = require('./legacy');
const fs = require('fs'), zlib = require('zlib'), assert = require('assert');
const mongoose = require('mongoose');
if (process.version !== 'v16.20.2') throw new Error('Pinned oracle Node v16.20.2 required');
if (process.env.TZ !== 'UTC') throw new Error('TZ=UTC required');
assert.strictEqual(require('mongoose/package.json').version, '5.1.2');
const out = {schema: 1, oracle: {node: process.version, tz: process.env.TZ, mongoose: '5.1.2'}};
const ej = L.fake.ejson;
(async () => {
    Object.assign(out, await require('./sections-air').air(L, {mongoose, ej}));
    out.source = {files: Object.fromEntries(Object.entries(L.sourceFiles).sort())};
    const json = JSON.stringify(out);
    fs.writeFileSync(process.argv[2], zlib.gzipSync(Buffer.from(json), {level: 9, mtime: 0}));
    console.log('recorded air', json.length);
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
