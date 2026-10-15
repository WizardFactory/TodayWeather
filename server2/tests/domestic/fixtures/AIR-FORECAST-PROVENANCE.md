# S15b-3c AirKorea image forecast oracle fixture

`air_forecast.json.gz` (sha256 `f8e2204592105e8b1e7113127a948d97219e55469b8bc1bea539927304ca4cf1`) holds pinned legacy-oracle results for
the S15b-3c tests (`server2/tests/domestic/air_forecast.rs`, `air_forecast_s3.rs`). It is test
data only; the server2 runtime never reads it or any legacy file.

## Recording

- Runtime: Node.js `v16.20.2`, `TZ=UTC`, get-pixels `3.3.2` with
  omggif `1.0.9` (the versions of the legacy lockfile, installed by
  `install-pixels.sh`), and for the forecast the S15b-3a oracle (`AIR-PROVENANCE.md`): Mongoose
  5.1.2 over the in-memory collection double.
- Legacy source: the repository `server/` files the forecast driver loads; their sha256 are stored
  in `forecast.source.files` (9 files).
- Inputs: synthetic GIFs written with omggif's `GifWriter` (one by hand, from review S15b3c-R2); no live image or value is copied. The
  colour tables are the live-legend tables of `server2/src/domestic/kma/source/air_forecast.rs`
  (AK 2026-10-15), handed to the legacy controller in place of its own tables
  (`ORACLE_DUST_TABLES`); the calibration is the deployed one with the 820×820 size.
- Run: `run.sh record-gif.js`, `oracle/run.sh record-forecast.js`, then `make_fixture.py`.

## What is recorded

- `gif`: 9 synthetic GIFs (`global-palette`, `sub-rectangle`, `local-palette-transparent`, `interlaced`, `short-stream`, `full-code-table`, `offset-frame-820`, `overlong-one-pixel`, `overlong-stream`): shape and the sha256 of every frame get-pixels
  returns.
- `forecast`: 6 stations (one outside the map box), 2 image sets
  (820×820, one 673×795 frame per hour at (66,10) as the live images; the second set's PM2.5 has 30
  frames), 6 announcements and 9 `getMinuDustFrcstDspth` →
  `AirkoreaHourlyForecastController.do` runs (a stored announcement skipped, a 23시 run after
  midnight, a PM10-only announcement twice, a PM2.5-only one, one with a broken PM10 image, the
  one-day removal, an announcement without forecast documents): after each run the
  `arpltnhourlyforecasts` documents (432, 432, 432, 432, 432, 432, 540, 540, 514) and the
  `getForecast` answer of every station.

## Driver source

### `record-gif.js` (sha256 `13797a19ac3c059452436a5265471fb84498f464113c2b68cc642f2f49eae807`)

```js
/* S15b-3c GIF decoder oracle (task evidence): synthetic GIFs (omggif 1.0.9 GifWriter, then
 * byte patches for interlace and a short stream) decoded by get-pixels 3.3.2 exactly as legacy
 * `airkorea.finedust.image.parser` calls it (`getPixels(buffer, 'image/gif', cb)`). Records each
 * case's bytes, shape and the sha256 of every frame's RGBA buffer. Deterministic, no network.
 * Run: run.sh record-gif.js <out.json> */
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const getPixels = require('get-pixels');
const {GifWriter} = require('omggif');

let seed = 12345;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
function palette(n, k) {
    const p = [];
    for (let i = 0; i < n; i++) p.push(((i * 37 + k * 11) & 255) << 16 | ((i * 91 + k) & 255) << 8 | ((i * 53 + 7 * k) & 255));
    return p;
}
function writer(width, height, gopts, frames) {
    const buf = Buffer.alloc(width * height * frames.length * 4 + 4096 * frames.length + 4096);
    const gw = new GifWriter(buf, width, height, gopts);
    for (const f of frames) gw.addFrame(f.x, f.y, f.w, f.h, f.pixels, f.opts || {});
    return Buffer.from(buf.slice(0, gw.end()));
}
function indices(n, colours, fn) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(fn ? fn(i) : Math.floor(rand() * colours));
    return out;
}
/** The offset of the n-th Image Descriptor (0x2c) of a writer-made GIF. */
function descriptor(buf, n) {
    let p = 13 + ((buf[10] & 0x80) ? 3 * (1 << ((buf[10] & 7) + 1)) : 0);
    let seen = 0;
    while (p < buf.length) {
        const b = buf[p];
        if (b === 0x21) {
            p += 2;
            while (buf[p] !== 0) p += buf[p] + 1;
            p += 1;
        } else if (b === 0x2c) {
            if (seen === n) return p;
            seen++;
            const pf = buf[p + 9];
            p += 10 + ((pf & 0x80) ? 3 * (1 << ((pf & 7) + 1)) : 0);
            p += 1;
            while (buf[p] !== 0) p += buf[p] + 1;
            p += 1;
        } else return -1;
    }
    return -1;
}
const cases = [];
// 1. Two full frames over a global palette.
cases.push(['global-palette', writer(20, 15, {palette: palette(16, 1)},
    [{x: 0, y: 0, w: 20, h: 15, pixels: indices(300, 16)}, {x: 0, y: 0, w: 20, h: 15, pixels: indices(300, 16)}])]);
// 2. A frame rectangle at an offset (the rest of its buffer stays zero).
cases.push(['sub-rectangle', writer(20, 15, {palette: palette(8, 2)},
    [{x: 3, y: 2, w: 11, h: 9, pixels: indices(99, 8)}, {x: 0, y: 0, w: 20, h: 15, pixels: indices(300, 8)}])]);
// 3. A local palette frame and a transparent index (kept for the following frame too).
cases.push(['local-palette-transparent', writer(16, 12, {palette: palette(4, 3)},
    [{x: 0, y: 0, w: 16, h: 12, pixels: indices(192, 4), opts: {transparent: 2}},
     {x: 1, y: 1, w: 12, h: 9, pixels: indices(108, 32), opts: {palette: palette(32, 4)}},
     {x: 0, y: 0, w: 16, h: 12, pixels: indices(192, 4)}])]);
// 4. An interlaced frame of 13 rows (the descriptor's interlace bit set on writer data: the
//    decoder places the stored rows in pass order).
{
    const b = writer(10, 13, {palette: palette(8, 5)}, [{x: 0, y: 0, w: 10, h: 13, pixels: indices(130, 8, i => Math.floor(i / 10) % 8)}]);
    const d = descriptor(b, 0);
    b[d + 9] |= 0x40;
    cases.push(['interlaced', b]);
}
// 5. A short stream: the descriptor promises two more rows than the data holds (index 0).
{
    const b = writer(12, 12, {palette: palette(8, 6)}, [{x: 0, y: 0, w: 12, h: 10, pixels: indices(120, 8)}]);
    const d = descriptor(b, 0);
    b[d + 7] = 12;
    cases.push(['short-stream', b]);
}
// 6. 256 colours over 160x120 with random indices: the code table fills and clear codes follow.
cases.push(['full-code-table', writer(160, 120, {palette: palette(256, 7)},
    [{x: 0, y: 0, w: 160, h: 120, pixels: indices(19200, 256)}, {x: 0, y: 0, w: 160, h: 120, pixels: indices(19200, 256)}])]);
// 7. Map-like frames: an 820x820 screen with a 673x795 frame at (66,10), as the live GIFs.
cases.push(['offset-frame-820', writer(820, 820, {palette: palette(64, 8)},
    [{x: 66, y: 10, w: 673, h: 795, pixels: indices(673 * 795, 64, i => (Math.floor((i % 673) / 40) + Math.floor(i / 673 / 50)) % 64)}])]);
// 8. A one-pixel frame whose stream is longer than the frame (review S15b3c-R2): omggif drops the
//    store past the index buffer (a typed-array write) and stops at the next longer code.
cases.push(['overlong-one-pixel', Buffer.from('47494638396134033403800000000000ffffff2c0000000001000100000202440a003b', 'hex')]);
// 9. A stream longer than its frame: the descriptor promises 10x6 for 10x10 of data.
{
    const b = writer(10, 10, {palette: palette(8, 9)}, [{x: 0, y: 0, w: 10, h: 10, pixels: indices(100, 8, i => (i * 7) % 8)}]);
    const d = descriptor(b, 0);
    b[d + 7] = 6;
    cases.push(['overlong-stream', b]);
}

const out = {schema: 1, oracle: {node: process.version, getPixels: require('get-pixels/package.json').version,
    omggif: require('omggif/package.json').version}, cases: []};
(async () => {
    for (const [name, buf] of cases) {
        const result = await new Promise(resolve => getPixels(buf, 'image/gif', (err, px) => {
            if (err) return resolve({error: String(err)});
            const frames = [];
            const size = px.shape[1] * px.shape[2] * 4;
            for (let f = 0; f < px.shape[0]; f++) {
                frames.push(crypto.createHash('sha256').update(Buffer.from(px.data.buffer, px.data.byteOffset + f * size, size)).digest('hex'));
            }
            resolve({shape: px.shape, frames});
        }));
        out.cases.push(Object.assign({name, gif: buf.toString('base64')}, result));
        console.log(name, JSON.stringify(result.shape || result.error));
    }
    fs.writeFileSync(process.argv[2], JSON.stringify(out));
})();

```

### `oracle/record-forecast.js` (sha256 `7ae266be78d4836145a651e21a6902591adf58cba07cac74ab4ea8f5efdf4d9a`)

```js
/* S15b-3c AirKorea image forecast oracle (task evidence, not a repository tool). No network.
 * Legacy `AirkoreaHourlyForecastController.do(dataTime)` (master code, Mongoose 5.1.2 over the
 * in-memory collection double) decodes synthetic 820x820 GIFs (omggif GifWriter; local files given
 * to the real get-pixels 3.3.2 as `imageUrl[6]`/`[7]`) with the deployed calibration and the colour
 * tables read from the current legend (AK 2026-10-15). Records every run's collection and the
 * `getForecast` answer of every station.
 * Run: run.sh record-forecast.js <out.json> */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
if (process.version !== 'v16.20.2') throw new Error('Pinned oracle Node v16.20.2 required');
if (process.env.TZ !== 'UTC') throw new Error('TZ=UTC required');
assert.strictEqual(require('mongoose/package.json').version, '5.1.2');
assert.strictEqual(require('get-pixels/package.json').version, '3.3.2');
const {GifWriter} = require('omggif');

global.ORACLE_GET_PIXELS = require('get-pixels');
global.ORACLE_IMAGE_CONFIG = {airkorea_korea_image: {
    coordi: {top_lat: '39.3769', bottom_lat: '32.6942', left_lon: '123.9523', right_lon: '130.6741'},
    size: {width: '820', height: '820'},
    pixel_pos: {left: '78', right: '663', top: '80', bottom: '798'}},
    kaq_korea_image: {coordi: {}, size: {}, pixel_pos: {}, so2_pixel_pos: {}},
    kaq_korea_modelimg_image: {coordi: {}, size: {}, pixel_pos: {}}};
// The legend colours and values (server2 COLORS_PM10 / COLORS_PM25).
const PM10 = [[105,0,0,600],[130,0,0,320],[155,0,0,280],[180,0,0,260],[205,0,0,240],[230,0,0,220],[255,0,0,200],
    [255,60,60,190],[255,90,90,180],[255,120,120,170],[255,150,150,160],[100,100,0,151],[115,115,0,143],[131,131,0,136],
    [146,146,0,129],[162,162,0,122],[177,177,0,115],[193,193,0,108],[208,208,0,101],[224,224,0,94],[240,240,0,87],
    [0,118,0,81],[0,138,0,75],[0,157,0,70],[0,177,0,65],[0,195,0,60],[0,216,0,55],[0,234,0,50],[0,254,0,45],
    [100,254,100,40],[149,254,149,35],[53,150,249,31],[75,162,244,24],[100,175,240,18],[135,192,232,12],[152,201,228,6]];
const PM25 = [[105,0,0,500],[130,0,0,200],[155,0,0,170],[180,0,0,160],[205,0,0,150],[230,0,0,140],[255,0,0,120],
    [255,60,60,110],[255,90,90,100],[255,120,120,90],[255,150,150,80],[100,100,0,76],[115,115,0,70],[131,131,0,65],
    [146,146,0,60],[162,162,0,55],[177,177,0,50],[193,193,0,46],[208,208,0,42],[224,224,0,39],[240,240,0,37],
    [0,118,0,36],[0,138,0,33],[0,157,0,31],[0,177,0,29],[0,195,0,27],[0,216,0,25],[0,234,0,23],[0,254,0,21],
    [100,254,100,19],[149,254,149,17],[53,150,249,16],[76,162,244,12],[100,175,240,9],[135,192,232,6],[152,201,228,3]];
const table = t => t.map(([r, g, b, val]) => ({r, g, b, val}));
global.ORACLE_DUST_TABLES = {pm10: table(PM10), pm25: table(PM25)};

const L = require('./legacy');
// kmaTimeLib formatting uses the Manager's leadingZeros (a global in the legacy process).
global.manager = {leadingZeros: (n, digits) => { n = n.toString(); return n.length < digits ? '0'.repeat(digits - n.length) + n : n; }};
const ej = L.fake.ejson;
const RealDate = Date;
let NOW = 0;
class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(NOW); }
    static now() { return NOW; }
}
const cb2p = fn => new Promise(resolve => fn((err, v) => resolve({err, v})));

// Stations: inside the map (exact colour, a neighbour colour, alternating misses), outside the
// box, and one at the map's top-left corner region.
const STATIONS = [['중구', 37.5665, 126.978], ['부산진구', 35.1796, 129.0756], ['제주', 33.4996, 126.5312],
    ['울릉도', 37.4845, 130.9057], ['대전', 36.35, 127.38], ['백령도', 37.97, 124.71]];
const CAL = {top_lat: 39.3769, bottom_lat: 32.6942, left_lon: 123.9523, right_lon: 130.6741, left: 78, right: 663, top: 80, bottom: 798};
function pixel(lat, lon) {
    const dw = (CAL.right_lon - CAL.left_lon) / (CAL.right - CAL.left), dh = (CAL.top_lat - CAL.bottom_lat) / (CAL.bottom - CAL.top);
    return [parseInt((lon - CAL.left_lon) / dw) + CAL.left, parseInt((CAL.top_lat - lat) / dh) + CAL.top];
}
// Palette: index 0 background grey, 1 a non-table grey, then the PM10 and PM2.5 legend colours.
const COLORS = [[240, 240, 240], [200, 200, 200]];
for (const [r, g, b] of PM10.concat(PM25)) if (!COLORS.some(c => c[0] === r && c[1] === g && c[2] === b)) COLORS.push([r, g, b]);
while (COLORS.length < 128) COLORS.push([1, 2, COLORS.length]);
const PALETTE = COLORS.map(([r, g, b]) => r << 16 | g << 8 | b);
const colorIndex = ([r, g, b]) => COLORS.findIndex(c => c[0] === r && c[1] === g && c[2] === b);

/** An 820x820 GIF with one 673x795 frame at (66,10) per hour, as the live images. */
function gif(code, set, frames) {
    const T = code === 'pm10' ? PM10 : PM25;
    const [fx, fy, fw, fh] = [66, 10, 673, 795];
    const buf = Buffer.alloc(820 * 820 * frames * 2 + (1 << 20));
    const gw = new GifWriter(buf, 820, 820, {palette: PALETTE, loop: 0});
    for (let f = 0; f < frames; f++) {
        const px = new Array(fw * fh).fill(0);
        const put = (x, y, idx) => { if (x >= fx && x < fx + fw && y >= fy && y < fy + fh) px[(y - fy) * fw + (x - fx)] = idx; };
        const block = (x, y, idx) => { for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) put(x + dx, y + dy, idx); };
        const [ax, ay] = pixel(STATIONS[0][1], STATIONS[0][2]);
        block(ax, ay, colorIndex(T[(f * 3 + set * 5) % 36]));
        // 부산진구: a non-table centre block with one table pixel at the j = 10 offset (-3, -2).
        const [bx, by] = pixel(STATIONS[1][1], STATIONS[1][2]);
        block(bx, by, 1);
        put(bx - 3, by - 2, colorIndex(T[(f + set) % 36]));
        // 제주: no table colour in even frames (the hour is not stored).
        const [cx, cy] = pixel(STATIONS[2][1], STATIONS[2][2]);
        block(cx, cy, f % 2 === 0 ? 1 : colorIndex(T[((35 - f) % 36 + 36) % 36]));
        const [dx, dy] = pixel(STATIONS[4][1], STATIONS[4][2]);
        block(dx, dy, colorIndex(T[(f * 7 + set) % 36]));
        const [ex, ey] = pixel(STATIONS[5][1], STATIONS[5][2]);
        block(ex, ey, colorIndex(T[(set * 11 + 2) % 36]));
        gw.addFrame(fx, fy, fw, fh, px, {delay: 50});
    }
    return Buffer.from(buf.slice(0, gw.end()));
}

(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's15b3c-'));
    const sets = [];
    for (const set of [0, 1]) {
        // PM2.5 of the second set has fewer frames than hours (the later hours are not stored).
        const files = {pm10: gif('pm10', set, 48), pm25: gif('pm25', set, set === 1 ? 30 : 48)};
        const paths = {};
        for (const code of ['pm10', 'pm25']) {
            paths[code] = path.join(dir, `set${set}-${code}.gif`);
            fs.writeFileSync(paths[code], files[code]);
        }
        sets.push({files, paths});
    }
    const MsrStn = L.load('models/modelMsrStnInfo.js');
    L.fake.attach(MsrStn);
    const Frcst = L.load('models/modelMinuDustFrcst.js');
    L.fake.attach(Frcst);
    const Hourly = L.load('models/arpltn.hourly.forecast.js');
    const coll = L.fake.attach(Hourly);
    for (const [stationName, lat, lon] of STATIONS) {
        await cb2p(cb => new MsrStn({stationName, geo: [lon, lat], addr: stationName}).save(cb));
    }
    // Announcements with the state of each image (review S15b3c-R5): `image`, `absent` (the
    // document has no image URL: `getDustImage` skips that pollutant), `nodoc` (no document of that
    // code) or `broken` (a URL get-pixels cannot read: the whole run stores nothing).
    const announce = [['2026-10-14 17시 발표', 0, 'image', 'image'], ['2026-10-14 23시 발표', 1, 'image', 'image'],
        ['2026-10-15 05시 발표', 0, 'image', 'image'], ['2026-10-15 11시 발표', 1, 'image', 'absent'],
        ['2026-10-15 17시 발표', 0, 'nodoc', 'image'], ['2026-10-15 23시 발표', 1, 'broken', 'image']];
    const missing = path.join(dir, 'missing.gif');
    for (const [dataTime, set, pm10, pm25] of announce) {
        for (const [code, state] of [['PM10', pm10], ['PM25', pm25]]) {
            if (state === 'nodoc') continue;
            const url = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'];
            const own = state === 'broken' ? missing : sets[set].paths[code.toLowerCase()];
            if (code === 'PM10') {
                if (state !== 'absent') url.push(own, sets[set].paths.pm25, 'u9');
            } else {
                url.push(sets[set].paths.pm10);
                if (state !== 'absent') url.push(own, 'u9');
            }
            await cb2p(cb => new Frcst({dataTime, informCode: code, informData: dataTime.slice(0, 10), imageUrl: url}).save(cb));
        }
    }
    const Ctrl = L.load('controllers/airkorea.hourly.forecast.controller.js');
    const Base = L.load('controllers/img.hourly.forecast.controller.js');
    // Runs (KST): a 17시 announcement processed that day, its repeat (skipped), the 23시 one after
    // midnight, the 05시 one with the first images again, the PM10-only 11시 one twice (not
    // skipped: no PM2.5 rows), the PM2.5-only 17시 one, the 23시 one with a broken PM10 image, then
    // a later run removing old rows for an announcement without forecast documents.
    const runs = [['2026-10-14 17시 발표', Date.UTC(2026, 9, 14, 8, 2)], ['2026-10-14 17시 발표', Date.UTC(2026, 9, 14, 9, 2)],
        ['2026-10-14 23시 발표', Date.UTC(2026, 9, 14, 15, 30)], ['2026-10-15 05시 발표', Date.UTC(2026, 9, 14, 20, 2)],
        ['2026-10-15 11시 발표', Date.UTC(2026, 9, 15, 2, 2)], ['2026-10-15 11시 발표', Date.UTC(2026, 9, 15, 3, 2)],
        ['2026-10-15 17시 발표', Date.UTC(2026, 9, 15, 8, 2)], ['2026-10-15 23시 발표', Date.UTC(2026, 9, 15, 14, 30)],
        ['2026-10-16 11시 발표', Date.UTC(2026, 9, 16, 2, 2)]];
    const out = {schema: 1, oracle: {node: process.version, tz: process.env.TZ, mongoose: '5.1.2', getPixels: '3.3.2'},
        calibration: global.ORACLE_IMAGE_CONFIG.airkorea_korea_image, stations: STATIONS,
        sets: sets.map(s => ({pm10: s.files.pm10.toString('base64'), pm25: s.files.pm25.toString('base64')})),
        announcements: announce, runs: []};
    for (const [dataTime, now] of runs) {
        NOW = now;
        global.Date = FakeDate;
        await new Promise(resolve => {
            const ctrl = new Ctrl();
            ctrl._removeOldData = function () {
                Base.prototype._removeOldData.call(this);
                setTimeout(resolve, 100);
            };
            ctrl.do(dataTime);
        });
        global.Date = RealDate;
        const answers = [];
        for (const [stationName] of STATIONS) {
            const r = await cb2p(cb => (new Ctrl()).getForecast(stationName, cb));
            answers.push({stationName, result: ej(r.v.map(d => { const o = Object.assign({}, d); delete o._id; return o; }))});
        }
        out.runs.push({dataTime, now, docs: ej(coll.docs.map(d => { const o = Object.assign({}, d); delete o._id; return o; })), answers});
        console.log('run', dataTime, new RealDate(now).toISOString(), 'rows', coll.docs.length);
    }
    out.source = {files: Object.fromEntries(Object.entries(L.sourceFiles).sort())};
    fs.writeFileSync(process.argv[2], JSON.stringify(out));
    fs.rmSync(dir, {recursive: true});
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

```

### `oracle/legacy.js` (sha256 `66a02c93a20b6beaeaa0efbf68873ad21d8a44de835f45bfcbf22688b71af31d`)

```js
/* Load legacy server modules offline for the S15b store oracle (task evidence, not a repository
 * tool). Network modules are replaced by stubs that throw; `global.log` is silent; Mongoose 5.1.2
 * models get the in-memory collection double. */
'use strict';
const Module = require('module');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const fake = require('./fakemongo');

const root = path.resolve(process.env.TW_REPO || path.join(__dirname, '../../../..'));
const server = path.join(root, 'server');
const sourceFiles = {};
const rawRead = fs.readFileSync;
fs.readFileSync = function (file, ...args) {
    const out = rawRead.call(fs, file, ...args);
    const abs = path.resolve(String(file));
    if (abs.startsWith(server + path.sep)) {
        sourceFiles[path.relative(root, abs)] = crypto.createHash('sha256').update(rawRead.call(fs, abs)).digest('hex');
    }
    return out;
};
const noNetwork = () => { throw new Error('network access is not allowed in the oracle'); };
const stubs = {
    request: Object.assign(noNetwork, {get: noNetwork, post: noNetwork, defaults: () => noNetwork}),
    dnscache: () => ({}),
    // S15b-3: image and AWS modules are loaded by kecoRequester but never used offline.
    // S15b-3c: the forecast section decodes local synthetic GIFs with the real get-pixels.
    'get-pixels': (...a) => global.ORACLE_GET_PIXELS ? global.ORACLE_GET_PIXELS(...a) : noNetwork(),
    'aws-sdk': {S3: function () { this.upload = noNetwork; this.listObjectsV2 = noNetwork; }, config: {update() {}}},
    // S15b-3b: a section may answer GETs deterministically (the Kakao address-search stub).
    axios: {get: (...a) => global.ORACLE_AXIOS_GET ? global.ORACLE_AXIOS_GET(...a) : noNetwork(), post: noNetwork},
};
const rawLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (stubs[request]) return stubs[request];
    // The utilities create a Winston/Logentries logger that writes files: use the silent log.
    if (/lib\/log(\.js)?$/.test(request)) {
        return function () { return global.log; };
    }
    if (/config\/config(\.js)?$/.test(request)) {
        return {db: {version: '2.0', path: '', options: {}}, keyString: {kakao_keys: '["oracle-kakao-key"]'}, mode: 'service', serviceServer: {}, gather: {},
            image: global.ORACLE_IMAGE_CONFIG || {airkorea_korea_image: {coordi: {}, size: {}, pixel_pos: {}},
                kaq_korea_image: {coordi: {}, size: {}, pixel_pos: {}, so2_pixel_pos: {}},
                kaq_korea_modelimg_image: {coordi: {}, size: {}, pixel_pos: {}}}};
    }
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (resolved.startsWith(server + path.sep) && resolved.endsWith('.js')) {
        sourceFiles[path.relative(root, resolved)] = crypto.createHash('sha256').update(rawRead.call(fs, resolved)).digest('hex');
    }
    const loaded = rawLoad.apply(this, arguments);
    // S15b-3c: the colour tables of the image controller replaced (AK 2026-10-15) when a section
    // provides them; everything else of the controller runs unchanged.
    if (global.ORACLE_DUST_TABLES && resolved.endsWith(path.join('controllers', 'airkorea.dust.image.controller.js'))) {
        if (!loaded.__oraclePatched) {
            const Patched = function () {
                loaded.call(this);
                this.colorTable_pm10 = global.ORACLE_DUST_TABLES.pm10;
                this.colorTable_pm25 = global.ORACLE_DUST_TABLES.pm25;
                return this;
            };
            Patched.prototype = loaded.prototype;
            Patched.__oraclePatched = true;
            loaded.__patched = Patched;
            loaded.__oraclePatched = true;
        }
        return loaded.__patched;
    }
    return loaded;
};
const silent = () => {};
global.log = {error: silent, warn: silent, info: silent, verbose: silent, debug: silent, silly: silent};

function load(rel) { return require(path.join(server, rel)); }
module.exports = {root, server, load, fake, sourceFiles};

```

### `oracle/fakemongo.js` (sha256 `af919f3cc3c934edb3963eefde7f04dfac68a2aeaaf399be0a482bd680e78ad8`)

```js
/* In-memory MongoDB collection double for the S15b store oracle (task evidence, not a repository
 * tool). Implements the driver calls the legacy savers make through Mongoose 5.1.2 (find with
 * sort/limit/projection, update with upsert/multi, updateMany, remove) with MongoDB < 5.0 field
 * order (existing fields keep their position, new fields are appended in update order) and a
 * BSON round trip (undefined -> null, integral numbers in int32 lose -0). */
'use strict';
let nextId = 1;
function bson(v) {
    if (v === undefined) return null;
    if (v === null) return null;
    if (v instanceof Date) return new Date(v.getTime());
    if (typeof v === 'number') return Number.isInteger(v) && v >= -2147483648 && v <= 2147483647 ? (v === 0 ? 0 : v) : v;
    if (Array.isArray(v)) return v.map(bson);
    if (typeof v === 'object') {
        if (v._bsontype === 'ObjectID' || v._bsontype === 'ObjectId') return v;
        const o = {};
        for (const k of Object.keys(v)) o[k] = bson(v[k]);
        return o;
    }
    return v;
}
function get(doc, path) {
    let cur = doc;
    for (const p of path.split('.')) {
        if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
        cur = cur[p];
    }
    return cur;
}
function cmp(a, b) {
    const n = x => x instanceof Date ? x.getTime() : x;
    a = n(a); b = n(b);
    if (a === b) return 0;
    if (a === undefined || a === null) return -1;
    if (b === undefined || b === null) return 1;
    return a < b ? -1 : 1;
}
function eq(a, b) {
    if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
    if (a && typeof a === 'object' && b && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
    if ((a === undefined || a === null) && b === null) return true;
    return a === b;
}
function matchValue(v, cond) {
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond) &&
        Object.keys(cond).length && Object.keys(cond).every(k => k[0] === '$')) {
        return Object.keys(cond).every(op => {
            const c = cond[op];
            switch (op) {
                case '$lte': return v !== undefined && v !== null && cmp(v, c) <= 0;
                case '$lt': return v !== undefined && v !== null && cmp(v, c) < 0;
                case '$gte': return v !== undefined && v !== null && cmp(v, c) >= 0;
                case '$gt': return v !== undefined && v !== null && cmp(v, c) > 0;
                case '$ne': return !eq(v, c);
                case '$in': return c.some(x => eq(v, x));
                case '$nin': return !c.some(x => eq(v, x));
                default: throw new Error('fakemongo: unsupported operator ' + op);
            }
        });
    }
    return eq(v, cond);
}
function matches(doc, q) {
    return Object.keys(q || {}).every(k => {
        if (k === '$or') return q[k].some(sub => matches(doc, sub));
        if (k === '$and') return q[k].every(sub => matches(doc, sub));
        return matchValue(get(doc, k), q[k]);
    });
}
function setPath(doc, path, value) {
    const parts = path.split('.');
    let cur = doc;
    for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] === undefined || cur[parts[i]] === null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
        cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = bson(value);
}
function unsetPath(doc, path) {
    const parts = path.split('.');
    let cur = doc;
    for (let i = 0; i < parts.length - 1; i++) { cur = cur && cur[parts[i]]; }
    if (cur && typeof cur === 'object') delete cur[parts[parts.length - 1]];
}
function apply(doc, update, inserting) {
    for (const op of Object.keys(update)) {
        const body = update[op];
        if (op === '$set' || (op === '$setOnInsert' && inserting)) {
            for (const k of Object.keys(body)) setPath(doc, k, body[k]);
        } else if (op === '$unset') {
            for (const k of Object.keys(body)) unsetPath(doc, k);
        } else if (op === '$inc') {
            for (const k of Object.keys(body)) setPath(doc, k, (get(doc, k) || 0) + body[k]);
        } else if (op === '$push' || op === '$pushAll') {
            for (const k of Object.keys(body)) {
                const v = body[k];
                const add = op === '$pushAll' ? v : (v && typeof v === 'object' && v.$each ? v.$each : [v]);
                const cur = get(doc, k);
                setPath(doc, k, (Array.isArray(cur) ? cur : []).concat(add));
            }
        } else if (op === '$setOnInsert') {
            // not inserting
        } else if (op[0] === '$') {
            throw new Error('fakemongo: unsupported update ' + op);
        }
    }
}
function project(doc, projection) {
    const out = {};
    const excluded = Object.keys(projection || {}).filter(k => !projection[k]);
    const included = Object.keys(projection || {}).filter(k => projection[k] && k !== '_id');
    for (const k of Object.keys(doc)) {
        if (included.length ? !(included.includes(k) || (k === '_id' && projection._id !== 0)) : excluded.includes(k)) continue;
        out[k] = bson(doc[k]);
    }
    return out;
}
class FakeCollection {
    constructor(name) { this.name = name; this.docs = []; this.log = []; }
    find(query, options, cb) {
        if (typeof options === 'function') { cb = options; options = {}; }
        options = options || {};
        // 2d `$near` (S15b-3): planar distance over [lon, lat], `$maxDistance` inclusive, ascending
        // distance, natural order for ties; the remaining conditions filter as usual.
        let near = null;
        query = Object.assign({}, query || {});
        for (const k of Object.keys(query)) {
            const c = query[k];
            if (c && typeof c === 'object' && !Array.isArray(c) && c.$near) { near = {k, c}; delete query[k]; }
        }
        let list = this.docs.filter(d => matches(d, query));
        if (near) {
            const [x0, y0] = near.c.$near;
            const dist = d => { const g = get(d, near.k); return Array.isArray(g) ? Math.hypot(g[0] - x0, g[1] - y0) : Infinity; };
            list = list.map((d, i) => ({d, i, r: dist(d)}))
                .filter(e => e.r <= (near.c.$maxDistance === undefined ? Infinity : near.c.$maxDistance))
                .sort((a, b) => a.r - b.r || a.i - b.i).map(e => e.d);
        }
        const sort = options.sort;
        if (sort) {
            const keys = Array.isArray(sort) ? sort : Object.keys(sort).map(k => [k, sort[k]]);
            list = list.slice().sort((a, b) => {
                for (const [k, dir] of keys) { const c = cmp(get(a, k), get(b, k)); if (c) return dir < 0 ? -c : c; }
                return 0;
            });
        }
        if (options.limit) list = list.slice(0, options.limit);
        const out = list.map(d => project(d, options.projection || options.fields));
        const cursor = {toArray: done => done(null, out)};
        if (cb) cb(null, cursor);
        return cursor;
    }
    _update(query, update, options, many) {
        options = options || {};
        const hits = this.docs.filter(d => matches(d, query));
        const targets = many ? hits : hits.slice(0, 1);
        for (const d of targets) apply(d, update, false);
        if (!targets.length && options.upsert) {
            // S15b-3b: an upsert whose query names an existing _id is a duplicate key (E11000).
            if (query && query._id !== undefined && this.docs.some(d => d._id === query._id)) {
                const err = new Error('E11000 duplicate key error collection: ' + this.name);
                err.code = 11000;
                return {error: err};
            }
            const doc = {_id: 'oid' + (nextId++)};
            for (const k of Object.keys(query)) {
                if (k[0] === '$') continue;
                const v = query[k];
                if (v && typeof v === 'object' && !(v instanceof Date) && Object.keys(v).some(x => x[0] === '$')) continue;
                setPath(doc, k, v);
            }
            apply(doc, update, true);
            this.docs.push(doc);
            this.log.push({op: 'insert', query, update});
            return {result: {n: 1, nModified: 0, upserted: [doc._id]}, n: 1};
        }
        this.log.push({op: 'update', query, update, n: targets.length});
        return {result: {n: targets.length, nModified: targets.length}, n: targets.length, nModified: targets.length};
    }
    update(query, update, options, cb) {
        if (typeof options === 'function') { cb = options; options = {}; }
        const r = this._update(query, update, options, options && options.multi);
        if (cb) process.nextTick(() => cb(null, r));
        return Promise.resolve(r);
    }
    updateOne(q, u, o, cb) { if (typeof o === 'function') { cb = o; o = {}; } const r = this._update(q, u, o, false); if (cb) process.nextTick(() => r.error ? cb(r.error) : cb(null, r)); return r.error ? Promise.reject(r.error) : Promise.resolve(r); }
    updateMany(q, u, o, cb) { if (typeof o === 'function') { cb = o; o = {}; } const r = this._update(q, u, o, true); if (cb) process.nextTick(() => cb(null, r)); return Promise.resolve(r); }
    remove(query, options, cb) {
        if (typeof options === 'function') { cb = options; options = {}; }
        const before = this.docs.length;
        this.docs = this.docs.filter(d => !matches(d, query));
        const r = {result: {n: before - this.docs.length}};
        if (cb) process.nextTick(() => cb(null, r));
        return Promise.resolve(r);
    }
    deleteMany(q, o, cb) { return this.remove(q, o, cb); }
    ensureIndex(...args) { const cb = args.find(a => typeof a === 'function'); if (cb) process.nextTick(() => cb(null, 'idx')); }
    createIndex(...args) { return this.ensureIndex(...args); }
    insert(docs, options, cb) {
        if (typeof options === 'function') { cb = options; options = {}; }
        (Array.isArray(docs) ? docs : [docs]).forEach(d => this.docs.push(bson(d)));
        if (cb) process.nextTick(() => cb(null, {result: {n: 1}}));
    }
    insertOne(doc, options, cb) { return this.insert(doc, options, cb); }
    insertMany(docs, options, cb) { return this.insert(docs, options, cb); }
}
/** Attach a fake driver collection to a Mongoose model (no connection, no buffering). */
function attach(model) {
    const fake = new FakeCollection(model.collection.name);
    model.collection.buffer = false;
    model.collection.collection = fake;
    return fake;
}
function ejson(v) {
    if (v instanceof Date) return {$date: v.getTime()};
    if (Array.isArray(v)) return v.map(ejson);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = ejson(v[k]); return o; }
    if (typeof v === 'number' && !isFinite(v)) return {$number: String(v)};
    return v;
}
module.exports = {FakeCollection, attach, ejson, bson};

```

### `install-pixels.sh` (sha256 `dd41d5cf8d5f3e4ee87cd5260261dedb536f9f791631e03fa979a7af71164ab3`)

```sh
#!/bin/bash
# Local oracle dependency for S15b-3c: get-pixels 3.3.2 (legacy lockfile) with the pinned Node 16.20.2.
set -euo pipefail
D=/Users/ak/paseo/TodayWeather/.claude/worktrees/agent-a7c6632304cb7b2fc/reports/sdlc/issue-2742-s15b3c/pixels
NODE_BIN=/Users/ak/paseo/TodayWeather/.claude/worktrees/agent-ace04ae166293bfbe/reports/sdlc/issue-2700-s15/oracle/node-v16.20.2-darwin-arm64/bin
export PATH="$NODE_BIN:$PATH"
mkdir -p "$D"
cd "$D"
[ -f package.json ] || npm init -y >/dev/null
npm install --ignore-scripts --no-audit --no-fund get-pixels@3.3.2 omggif@1.0.9 ndarray@1.0.18
npm ls --depth=1

```

### `make_fixture.py` (sha256 `2e2a5b7fd4f4a42fdcf4717642e3c9e94f56267e2720ddeb552cfda897f5c7fc`)

```python
"""Combine the S15b-3c oracle outputs into server2/tests/domestic/fixtures/air_forecast.json.gz."""
import gzip, json, os
W = '/Users/ak/paseo/TodayWeather/.claude/worktrees/agent-a7c6632304cb7b2fc/'
O = W + 'reports/sdlc/issue-2742-s15b3c/out/'
d = {'schema': 1, 'gif': json.load(open(O + 'gif.json'))}
if os.path.exists(O + 'forecast.json'):
    d['forecast'] = json.load(open(O + 'forecast.json'))
raw = json.dumps(d, ensure_ascii=False, separators=(',', ':')).encode()
open(W + 'server2/tests/domestic/fixtures/air_forecast.json.gz', 'wb').write(gzip.compress(raw, mtime=0))
print('fixture', len(raw), 'bytes', sorted(d))

```
