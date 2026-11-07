#!/usr/bin/env node
// Writes LevelDB fixtures with the real LevelDB library (classic-level) for LevelDbReaderTest, in the
// layout Chromium uses for localStorage (key `_https://localhost\0` + 1 + Latin-1 name; values with a
// 0 (UTF-16LE) or 1 (Latin-1) prefix). Expected values are read back through LevelDB itself.
//   cd android/tools/leveldb-fixtures && npm ci && node generate.mjs
// Output: android/core-storage/src/test/resources/leveldb/<case>/ and <case>.expected.json
import {ClassicLevel} from 'classic-level';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../core-storage/src/test/resources/leveldb');
const prefix = Buffer.concat([Buffer.from('_https://localhost'), Buffer.from([0, 1])]);
const key = (name) => Buffer.concat([prefix, Buffer.from(name, 'latin1')]);
const latin1 = (s) => Buffer.concat([Buffer.from([1]), Buffer.from(s, 'latin1')]);
const utf16 = (s) => Buffer.concat([Buffer.from([0]), Buffer.from(s, 'utf16le')]);
const opts = {keyEncoding: 'buffer', valueEncoding: 'buffer'};

// Opening a LevelDB replays and may compact its log, so the oracle reads a copy and the fixture keeps
// the files exactly as written.
async function expected(original) {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'tw-ldb-'));
    fs.cpSync(original, dir, {recursive: true});
    const db = new ClassicLevel(dir, opts);
    await db.open();
    const out = {};
    for await (const [k, v] of db.iterator()) {
        if (!k.subarray(0, prefix.length).equals(prefix)) continue;
        out[k.subarray(prefix.length).toString('latin1')] = v[0] === 0 ? v.subarray(1).toString('utf16le') : v.subarray(1).toString('latin1');
    }
    await db.close();
    fs.rmSync(dir, {recursive: true, force: true});
    return out;
}

async function obsoleteTableLeftOver() {
    const dir = path.join(OUT, 'obsolete-table');
    fs.rmSync(dir, {recursive: true, force: true});
    let db = new ClassicLevel(dir, opts);
    await db.open();
    await db.put(key('cities'), utf16('["서울"]'));
    await db.put(key('units'), latin1('{"temperatureUnit":"C"}'));
    await db.put(key('expandShortChart'), latin1('true'));
    await db.compactRange(Buffer.alloc(0), Buffer.from([0xff]));
    await db.close();
    // Keep a copy of the first table: after the next compaction it is obsolete.
    const saved = fs.readdirSync(dir).filter((f) => f.endsWith('.ldb')).map((f) => [f, fs.readFileSync(path.join(dir, f))]);
    db = new ClassicLevel(dir, opts);
    await db.open();
    await db.del(key('expandShortChart'));
    await db.put(key('cities'), utf16('["서울","London"]'));
    await db.compactRange(Buffer.alloc(0), Buffer.from([0xff]));
    await db.close();
    const exp = await expected(dir);
    // Leave the obsolete table behind, as a crash before file removal would.
    for (const [f, data] of saved) if (!fs.existsSync(path.join(dir, f))) fs.writeFileSync(path.join(dir, f), data);
    for (const f of fs.readdirSync(dir)) if (f === 'LOCK' || f === 'LOG' || f.startsWith('LOG.old')) fs.rmSync(path.join(dir, f));
    return exp;
}

async function tableAndNewerLog() {
    const dir = path.join(OUT, 'table-and-log');
    fs.rmSync(dir, {recursive: true, force: true});
    let db = new ClassicLevel(dir, opts);
    await db.open();
    for (let i = 0; i < 200; i++) await db.put(key(`filler${i}`), latin1('x'.repeat(200)));
    await db.put(key('cityIndex'), latin1('1'));
    await db.compactRange(Buffer.alloc(0), Buffer.from([0xff]));
    await db.put(key('cityIndex'), latin1('2')); // newer value, only in the log
    await db.del(key('filler0'));
    await db.close();
    const exp = await expected(dir);
    for (const f of fs.readdirSync(dir)) if (f === 'LOCK' || f === 'LOG' || f.startsWith('LOG.old')) fs.rmSync(path.join(dir, f));
    return exp;
}

fs.mkdirSync(OUT, {recursive: true});
for (const [name, make] of [['obsolete-table', obsoleteTableLeftOver], ['table-and-log', tableAndNewerLog]]) {
    const exp = await make();
    fs.writeFileSync(path.join(OUT, `${name}.expected.json`), JSON.stringify(exp, Object.keys(exp).sort(), 1) + '\n');
    console.log(name, Object.keys(exp).length, 'keys');
}
