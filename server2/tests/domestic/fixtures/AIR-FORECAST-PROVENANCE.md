# S15b-3c AirKorea image forecast oracle fixture

`air_forecast.json.gz` (sha256 `619e9c5a9c22d5dac07c7806c0961514f3a69085fceeb2ec2b8ae7629b64e593`) holds pinned legacy-oracle results for
the S15b-3c tests (`server2/tests/domestic/air_forecast.rs`, `air_forecast_s3.rs`). It is test
data only; the server2 runtime never reads it or any legacy file. The parity target is legacy
master `91c77fcb` and later (#2757, "Restore AirKorea image-derived hourly forecasts").

## Recording

- Runtime: Node.js `v16.20.2`, `TZ=UTC`, get-pixels `3.3.2` with
  omggif `1.0.9` (the versions of the legacy lockfile, installed by
  `install-pixels.sh`), and for the forecast the S15b-3a oracle (`AIR-PROVENANCE.md`): Mongoose
  5.1.2 over the in-memory collection double.
- Legacy source (sha256 of each file the drivers load or name):

| File | sha256 |
| --- | --- |
| `server/config/config.js` | `3977339b7e62ecf94de7647b5c57ca0d6160cda2ab86df26c1b3e3eb9f65e11d` |
| `server/controllers/airkorea.dust.image.controller.js` | `2ae64ea3ae7ce5c4c9bcf03f3df09285dbffd603c57cf67adcf43536a20b524a` |
| `server/controllers/airkorea.hourly.forecast.controller.js` | `d18c7e99d807be929af352e434c05004b12e2da467f219307d1a09f2fa6d9bdf` |
| `server/controllers/img.hourly.forecast.controller.js` | `1c343d20e535179487db98f93fd9e15f2d30a2f1535ec8a3370c4466c9bf0c9a` |
| `server/lib/airkorea.finedust.image.parser.js` | `341254133c009169e4bf2d8582b53d12a2472c29dddcf9715ef89a79f3b0915b` |
| `server/lib/airkoreaImageLayout.js` | `2a673a81f138494928af6491669192358d0a197e3d9ed927ff1c1d5b2e31ad8c` |
| `server/lib/aqi.converter.js` | `75755a5e87941c0d6f0f3675b85cc70d8d252342dcc14f4b6a7232e61ddf0a73` |
| `server/lib/kmaTimeLib.js` | `e17dc2941e7e03701cebbe05b4cb077d771d9ed022af8a618057a99bb1b5ec61` |
| `server/models/arpltn.hourly.forecast.js` | `673fdec0cec3532acd0deeae431c2eeaa49ec0318ebc5ff64ba21fb93585936c` |
| `server/models/modelMinuDustFrcst.js` | `d2db8cb416e26db18f3caf55ab391c3accc0d8311ba7e6c34c11d3355441dfe4` |
| `server/models/modelMsrStnInfo.js` | `b927f78a17d54fb930bb2400d6730bd711000a6846dea7bd639a799a927ff040` |
| `server/test/offline/air-harness.js` | `10681bd1b9b52148fdf6460ea15231a385dbba13153ebc44e555ff8d2bb81c9d` |
| `server/test/offline/airkorea-image-harness.js` | `cfbc4fd4afcfb48bb12c22c179551914ec5f398d22e245c919535935508f4bc5` |
| `server/test/offline/airkorea-image.test.js` | `1f6436439721f84a613adf11f4b1deb36d13b06b7b5e4fc5c3ca6229fbe633a5` |

- Inputs: synthetic GIFs written with omggif's `GifWriter` (one by hand, from review
  S15b3c-R2); no live image or value is copied. The forecast GIFs have the characterized layout
  (an 820×820 canvas, 48 frames of 673×795 at (66,10), the 36-band legend at x 680) and are
  served to get-pixels for their 23-cycle URLs; `config.image.airkorea_korea_image` is the master
  `config.js` default with no `AIRKOREA_KOREA_IMAGE_*` set. The regression cases use the #2757
  harness itself (`server/test/offline/airkorea-image-harness.js`: synthetic pixels and memory
  models).
- Run: `run.sh record-gif.js`, `oracle/run.sh record-forecast.js`, `oracle/run.sh
  record-harness.js`, then `make_fixture.py`.

## What is recorded

- `gif`: 9 synthetic GIFs (`global-palette`, `sub-rectangle`, `local-palette-transparent`, `interlaced`, `short-stream`, `full-code-table`, `offset-frame-820`, `overlong-one-pixel`, `overlong-stream`): shape and the sha256 of every frame get-pixels
  returns.
- `forecast`: 8 stations (exact colours, a ring search, tolerance matches and
  misses, a per-frame legend shade, two outside the box, the map's top-left corner),
  6 images (a broken-legend and a 47-frame one among them),
  7 announcements and 9 `getMinuDustFrcstDspth` →
  `AirkoreaHourlyForecastController.do` runs (a stored announcement, its skip, a second
  announcement over the same images, a 17-cycle path, the next 23-cycle images, a missing PM2.5
  path, a broken legend frame, a 47-frame image, a removal run without documents): after each run
  the legacy error (if any), the `arpltnhourlyforecasts` documents
  (528, 528, 528, 528, 792, 726, 660, 594, 396) and the `getForecast` answer of every station.
- `harness`: the 29 cases of `server/test/offline/airkorea-image.test.js` (each
  invalid or missing path, shape, legend, calibration and palette case, the month rollover and the
  `do` skip), each with the rows stored or the rejection.

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

### `oracle/record-forecast.js` (sha256 `a9eefff227b1d4d18e82c5927a3f784f1d1b7544d07f303939852341007be8dd`)

```js
/* S15b-3c AirKorea image forecast oracle, legacy master after #2757 (task evidence, not a
 * repository tool). No network. Legacy `AirkoreaHourlyForecastController.do(dataTime)` (Mongoose
 * 5.1.2 over the in-memory collection double) runs over synthetic GIFs of the characterized layout
 * (omggif GifWriter: an 820x820 canvas, 48 frames of 673x795 at (66,10), the 36-band legend at
 * x 680) served to the real get-pixels 3.3.2 for their 23-cycle URLs, with the config.js defaults.
 * Records every run's collection and the `getForecast` answer of every station.
 * Run: run.sh record-forecast.js <out.json> */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
if (process.version !== 'v16.20.2') throw new Error('Pinned oracle Node v16.20.2 required');
if (process.env.TZ !== 'UTC') throw new Error('TZ=UTC required');
assert.strictEqual(require('mongoose/package.json').version, '5.1.2');
assert.strictEqual(require('get-pixels/package.json').version, '3.3.2');
const {GifWriter} = require('omggif');
const getPixels = require('get-pixels');

// The images by URL: get-pixels receives the bytes (no network); an unknown URL fails as a 404.
const files = {};
global.ORACLE_GET_PIXELS = (url, type, cb) => files[url] ? getPixels(files[url], type, cb) : cb(new Error('HTTP 404'));
// `config.image.airkorea_korea_image` of master config.js with no AIRKOREA_KOREA_IMAGE_* set.
global.ORACLE_IMAGE_CONFIG = {airkorea_korea_image: {
    coordi: {top_lat: '39.3769', bottom_lat: '32.6942', left_lon: '123.9523', right_lon: '130.6741'},
    size: {width: '820', height: '820'},
    pixel_pos: {left: '77', right: '663', top: '75', bottom: '794'}},
    kaq_korea_image: {coordi: {}, size: {}, pixel_pos: {}, so2_pixel_pos: {}},
    kaq_korea_modelimg_image: {coordi: {}, size: {}, pixel_pos: {}}};
const L = require('./legacy');
global.manager = {leadingZeros: (n, digits) => { n = n.toString(); return n.length < digits ? '0'.repeat(digits - n.length) + n : n; }};
const ej = L.fake.ejson;
const RealDate = Date;
let NOW = 0;
class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(NOW); }
    static now() { return NOW; }
}
const cb2p = fn => new Promise(resolve => fn((err, v) => resolve({err, v})));

// `airkoreaImageLayout.colours` (the characterized legend).
const NOMINAL = [[105,0,0],[130,0,0],[155,0,0],[180,0,0],[205,0,0],[230,0,0],[255,0,0],
    [255,60,60],[255,90,90],[255,120,120],[255,150,150],[100,100,0],[115,115,0],[131,131,0],
    [146,146,0],[162,162,0],[177,177,0],[193,193,0],[208,208,0],[224,224,0],[240,240,0],
    [0,118,0],[0,138,0],[0,157,0],[0,177,0],[0,195,0],[0,216,0],[0,234,0],[0,254,0],
    [100,254,100],[149,254,149],[53,150,249],[76,162,244],[100,175,240],[135,192,232],[152,201,228]];
// Palette: background, a non-legend grey, the legend, band 21 four levels greener (a legend
// shade of frame 14 and a station colour), band 31 four levels redder (a tolerance match), band 5
// five levels off (no match), white (a broken legend band).
const COLORS = [[240,240,240],[200,200,200]].concat(NOMINAL, [[0,122,0],[57,150,249],[235,0,0],[255,255,255]]);
while (COLORS.length < 64) COLORS.push([1, 2, COLORS.length]);
const PALETTE = COLORS.map(([r, g, b]) => r << 16 | g << 8 | b);
const BAND = i => 2 + i, GREEN21 = 38, RED31 = 39, OFF5 = 40, WHITE = 41;

// Stations: exact colours, a ring search, tolerance matches with misses, a per-frame legend
// shade, outside the box (two: east of it and on its southern edge), the map's top-left corner.
const STATIONS = [['중구', 37.5665, 126.978], ['부산진구', 35.1796, 129.0756], ['제주', 33.4996, 126.5312],
    ['울릉도', 37.4845, 130.9057], ['대전', 36.35, 127.38], ['백령도', 37.97, 124.71],
    ['남쪽끝', 32.6942, 127.0], ['모서리', 39.3769, 123.9523]];
const CAL = {top_lat: 39.3769, bottom_lat: 32.6942, left_lon: 123.9523, right_lon: 130.6741, left: 77, right: 663, top: 75, bottom: 794};
function pixel(lat, lon) {
    const dw = (CAL.right_lon - CAL.left_lon) / (CAL.right - CAL.left), dh = (CAL.top_lat - CAL.bottom_lat) / (CAL.bottom - CAL.top);
    return [Math.floor((lon - CAL.left_lon) / dw) + CAL.left, Math.floor((CAL.top_lat - lat) / dh) + CAL.top];
}

/** A characterized animation: `frames` frames of 673x795 at (66,10) on an 820x820 canvas. */
function gif(code, set, options = {}) {
    const frames = options.frames || 48, shift = code === 'pm10' ? 0 : 3;
    const [fx, fy, fw, fh] = [66, 10, 673, 795];
    const buf = Buffer.alloc(820 * 820 * frames * 2 + (1 << 20));
    const gw = new GifWriter(buf, 820, 820, {palette: PALETTE, loop: 0});
    for (let f = 0; f < frames; f++) {
        const px = new Array(fw * fh).fill(0);
        const put = (x, y, idx) => { if (x >= fx && x < fx + fw && y >= fy && y < fy + fh) px[(y - fy) * fw + (x - fx)] = idx; };
        const block = (x, y, idx) => { for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) put(x + dx, y + dy, idx); };
        for (let y = 74; y < 775; y++) {
            const band = Math.min(35, Math.floor((y - 74) * 36 / 701));
            let idx = BAND(band);
            if (f === 14 && band === 21) idx = GREEN21;
            if (options.badLegend && f === 47 && band === 10) idx = WHITE;
            for (let x = 678; x <= 682; x++) put(x, y, idx);
        }
        const at = name => pixel(...STATIONS.find(s => s[0] === name).slice(1));
        let [x, y] = at('중구');
        block(x, y, BAND((f * 3 + set * 5 + shift) % 36));
        [x, y] = at('부산진구');
        block(x, y, 1);
        put(x - 2, y + 1, BAND((f + set + shift) % 36));
        put(x + 2, y + 2, BAND((f + set + 7) % 36));
        [x, y] = at('제주');
        block(x, y, f % 2 === 0 ? RED31 : OFF5);
        [x, y] = at('대전');
        block(x, y, GREEN21);
        [x, y] = at('백령도');
        block(x, y, BAND((set * 11 + 2 + shift) % 36));
        [x, y] = at('모서리');
        put(x, y, 1);
        put(x - 1, y - 1, BAND(0));
        put(x + 1, y + 1, BAND(f % 36));
        gw.addFrame(fx, fy, fw, fh, px, {delay: 50});
    }
    return Buffer.from(buf.slice(0, gw.end()));
}
const url = (code, day, hour = '23') => 'https://www.airkorea.or.kr/dustImage/' + day + '/' + hour + '/09km/AQF.' +
    day.replace(/\//g, '') + '.NIER_09_01.' + (code === 'pm25' ? 'PM2P5' : 'PM10') + '.2days.ani.gif';

(async () => {
    const images = [gif('pm10', 0), gif('pm25', 0), gif('pm10', 1), gif('pm25', 1),
        gif('pm10', 1, {badLegend: true}), gif('pm10', 0, {frames: 47})];
    const byUrl = {[url('pm10', '2026/10/14')]: 0, [url('pm25', '2026/10/14')]: 1, [url('pm10', '2026/10/15')]: 2,
        [url('pm25', '2026/10/15')]: 3, [url('pm10', '2026/10/16')]: 4, [url('pm25', '2026/10/16')]: 1,
        [url('pm10', '2026/10/17')]: 5, [url('pm25', '2026/10/17')]: 1};
    for (const [u, i] of Object.entries(byUrl)) files[u] = images[i];
    const MsrStn = L.load('models/modelMsrStnInfo.js');
    L.fake.attach(MsrStn);
    const Frcst = L.load('models/modelMinuDustFrcst.js');
    L.fake.attach(Frcst);
    const Hourly = L.load('models/arpltn.hourly.forecast.js');
    const coll = L.fake.attach(Hourly);
    for (const [stationName, lat, lon] of STATIONS) {
        await cb2p(cb => new MsrStn({stationName, geo: [lon, lat], addr: stationName}).save(cb));
    }
    // Announcements with the URLs their documents name (null: the document has no image URL).
    const announce = [
        ['2026-10-15 05시 발표', url('pm10', '2026/10/14'), url('pm25', '2026/10/14')],
        ['2026-10-15 11시 발표', url('pm10', '2026/10/14'), url('pm25', '2026/10/14')],
        ['2026-10-15 17시 발표', url('pm10', '2026/10/15', '17'), url('pm25', '2026/10/15', '17')],
        ['2026-10-15 23시 발표', url('pm10', '2026/10/15'), url('pm25', '2026/10/15')],
        ['2026-10-16 05시 발표', url('pm10', '2026/10/15'), null],
        ['2026-10-16 11시 발표', url('pm10', '2026/10/16'), url('pm25', '2026/10/16')],
        ['2026-10-16 17시 발표', url('pm10', '2026/10/17'), url('pm25', '2026/10/17')]];
    for (const [dataTime, pm10, pm25] of announce) {
        const pm10Urls = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', pm10, 'u8', 'u9'];
        const pm25Urls = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'].concat(pm25 ? [pm25, 'u9'] : []);
        await cb2p(cb => new Frcst({dataTime, informCode: 'PM10', informData: dataTime.slice(0, 10), imageUrl: pm10Urls}).save(cb));
        await cb2p(cb => new Frcst({dataTime, informCode: 'PM25', informData: dataTime.slice(0, 10), imageUrl: pm25Urls}).save(cb));
    }
    const Ctrl = L.load('controllers/airkorea.hourly.forecast.controller.js');
    const Base = L.load('controllers/img.hourly.forecast.controller.js');
    // Runs (UTC instants): 05시 stored, its repeat skipped, 11시 over the same images, a 17-cycle
    // rejected, 23시 over the next images, a pair missing PM2.5, a broken legend frame, a 47-frame
    // image, then a removal run for an announcement without documents.
    const runs = [['2026-10-15 05시 발표', Date.UTC(2026, 9, 14, 20, 30)], ['2026-10-15 05시 발표', Date.UTC(2026, 9, 14, 21, 30)],
        ['2026-10-15 11시 발표', Date.UTC(2026, 9, 15, 2, 30)], ['2026-10-15 17시 발표', Date.UTC(2026, 9, 15, 8, 30)],
        ['2026-10-15 23시 발표', Date.UTC(2026, 9, 15, 14, 30)], ['2026-10-16 05시 발표', Date.UTC(2026, 9, 15, 20, 30)],
        ['2026-10-16 11시 발표', Date.UTC(2026, 9, 16, 2, 30)], ['2026-10-16 17시 발표', Date.UTC(2026, 9, 16, 8, 30)],
        ['2026-10-17 11시 발표', Date.UTC(2026, 9, 17, 2, 30)]];
    const config = path.join(process.env.TW_REPO, 'server/config/config.js');
    const out = {schema: 2, oracle: {node: process.version, tz: process.env.TZ, mongoose: '5.1.2', getPixels: '3.3.2'},
        calibration: global.ORACLE_IMAGE_CONFIG.airkorea_korea_image, stations: STATIONS,
        images: images.map(b => b.toString('base64')), urls: byUrl, announcements: announce, runs: []};
    for (const [dataTime, now] of runs) {
        NOW = now;
        global.Date = FakeDate;
        const error = await new Promise(resolve => {
            let result;
            const ctrl = new Ctrl();
            ctrl._removeOldData = function () {
                Base.prototype._removeOldData.call(this);
                setTimeout(() => resolve(result), 100);
            };
            ctrl.do(dataTime, err => { result = err ? String(err.message || err) : null; });
        });
        global.Date = RealDate;
        const answers = [];
        for (const [stationName] of STATIONS) {
            const r = await cb2p(cb => (new Ctrl()).getForecast(stationName, cb));
            answers.push({stationName, result: ej(r.v.map(d => { const o = Object.assign({}, d); delete o._id; return o; }))});
        }
        out.runs.push({dataTime, now, error, docs: ej(coll.docs.map(d => { const o = Object.assign({}, d); delete o._id; return o; })), answers});
        console.log('run', dataTime, new RealDate(now).toISOString(), 'error', error, 'rows', coll.docs.length);
    }
    out.source = {files: Object.assign(Object.fromEntries(Object.entries(L.sourceFiles).sort()),
        {'server/config/config.js': crypto.createHash('sha256').update(fs.readFileSync(config)).digest('hex')})};
    fs.writeFileSync(process.argv[2], JSON.stringify(out));
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });

```

### `oracle/record-harness.js` (sha256 `207b94241eb405124b02f6f75e1fcc9ae77965286cc4ab5d793bf50c7cd9f707`)

```js
/* S15b-3c: the legacy #2757 image regression cases (server/test/offline/airkorea-image.test.js)
 * recorded with their own harness (task evidence, not a repository tool). No network. Each case
 * runs the master controllers over the harness's synthetic pixels and memory models; the stored
 * rows (or the rejection) are recorded for the server2 port of the same cases.
 * Run: run.sh record-harness.js <out.json> */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
if (process.version !== 'v16.20.2') throw new Error('Pinned oracle Node v16.20.2 required');
const root = process.env.TW_REPO;
const H = require(path.join(root, 'server/test/offline/airkorea-image-harness.js'));
const {harness, pixels, imagePath, invoke, pipeline} = H;

const rowJson = r => ({stationName: r.stationName, date: r.date.toISOString(), code: r.code, val: r.val,
    dataTime: r.dataTime, pubDate: r.pubDate});
async function outcome(fn) {
    try {
        const rows = await fn();
        return {rows: rows.map(rowJson)};
    } catch (error) {
        return {error: String(error && error.message || error)};
    }
}
(async () => {
    const cases = [];
    const add = async (name, setup, run) => {
        const h = harness(setup.options || {});
        const result = await outcome(() => run(h));
        cases.push(Object.assign({name, setup: setup.describe}, result, {stored: h.rows.map(rowJson)}));
    };
    const std = {pubDate: '2026-10-15 11:00', pm10: imagePath(), pm25: imagePath('pm25')};
    await add('current-calibration', {describe: {}}, h => pipeline(h));
    await add('height-830', {options: {env: {AIRKOREA_KOREA_IMAGE_SIZE_HEIGHT: '830'}}, describe: {env: {AIRKOREA_KOREA_IMAGE_SIZE_HEIGHT: '830'}}}, h => pipeline(h));
    await add('hourly-do-twice', {describe: {do: '2026-10-15 11시 발표'}}, async h => {
        await invoke(h.hourly, 'do', '2026-10-15 11시 발표');
        await invoke(h.hourly, 'do', '2026-10-15 11시 발표');
        return invoke(h.hourly, 'getForecast', 'synthetic-seoul');
    });
    {
        const env = {AIRKOREA_KOREA_IMAGE_MAP_LEFT: '80', AIRKOREA_KOREA_IMAGE_COORDI_LEFT_LON: '124'};
        const h = harness({env});
        const map = await invoke(h.parser, 'getPixelMap', imagePath(), 'image/gif', h.dust.coordinate);
        cases.push({name: 'explicit-calibration', setup: {env}, map: {left: h.parser.getImagePos().left,
            left_lon: h.parser.getDefaultCoordi().top_left.lon, map_width: map.map_width,
            map_pixel_distance_width: map.map_pixel_distance_width}});
        await add('explicit-calibration-rows', {options: {env}, describe: {env}}, h2 => pipeline(h2));
    }
    for (const [name, options, describe] of [
        ['unknown-canvas', {pixels: pixels({shape: [48, 821, 820, 4]})}, {pixels: {shape: [48, 821, 820, 4]}}],
        ['missing-frame', {pixels: pixels({shape: [47, 820, 820, 4]})}, {pixels: {shape: [47, 820, 820, 4]}}],
        ['static-image', {pixels: pixels({shape: [820, 820, 4]})}, {pixels: {shape: [820, 820, 4]}}],
        ['last-frame-bad-legend', {pixels: pixels({badLegend: true})}, {pixels: {badLegend: true}}],
        ['map-bottom-900', {env: {AIRKOREA_KOREA_IMAGE_MAP_BOTTOM: '900'}}, {env: {AIRKOREA_KOREA_IMAGE_MAP_BOTTOM: '900'}}],
        ['top-lat-32', {env: {AIRKOREA_KOREA_IMAGE_COORDI_TOP_LAT: '32'}}, {env: {AIRKOREA_KOREA_IMAGE_COORDI_TOP_LAT: '32'}}],
        ['unknown-colours', {pixels: pixels({unknown: true})}, {pixels: {unknown: true}}],
        ['palette-delta-4', {pixels: pixels({band: 21, paletteDelta: 4})}, {pixels: {band: 21, paletteDelta: 4}}],
        ['palette-delta-5', {pixels: pixels({paletteDelta: 5})}, {pixels: {paletteDelta: 5}}]
    ]) await add(name, {options, describe}, h => pipeline(h));
    {
        const paths = {pubDate: '2026-02-01 05:00', pm10: imagePath('pm10', '2026/01/31'), pm25: imagePath('pm25', '2026/01/31')};
        await add('month-rollover', {describe: {paths}}, h => pipeline(h, paths));
    }
    for (const code of ['pm10', 'pm25']) {
        const other = code === 'pm10' ? 'pm25' : 'pm10';
        for (const p of [imagePath(code, '2026/02/30'), imagePath(code).replace('AQF.20261014', 'AQF.20261013'),
            imagePath(code).replace('/23/', '/05/'), imagePath(code).replace('/23/', '/11/'), imagePath(other),
            'https://www.airkorea.or.kr/dustImage/']) {
            const paths = {pubDate: '2026-10-15 11:00', [code]: p, [other]: imagePath(other)};
            await add('invalid-' + code + ':' + p, {describe: {paths}}, h => pipeline(h, paths));
        }
        const paths = {pubDate: '2026-10-15 11:00', [other]: imagePath(other)};
        await add('missing-' + code, {describe: {paths}}, h => pipeline(h, paths));
    }
    const files = ['server/test/offline/airkorea-image-harness.js', 'server/test/offline/airkorea-image.test.js',
        'server/test/offline/air-harness.js', 'server/lib/airkoreaImageLayout.js', 'server/lib/airkorea.finedust.image.parser.js',
        'server/controllers/airkorea.dust.image.controller.js', 'server/controllers/airkorea.hourly.forecast.controller.js',
        'server/controllers/img.hourly.forecast.controller.js', 'server/config/config.js'];
    const source = Object.fromEntries(files.map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')]));
    fs.writeFileSync(process.argv[2], JSON.stringify({schema: 1, oracle: {node: process.version, tz: process.env.TZ}, source, cases}));
    console.log('cases', cases.length, cases.map(c => c.name + ':' + (c.error || (c.rows ? c.rows.length : 'map'))).join(' '));
})().catch(e => { console.error(e); process.exit(1); });

```

### `oracle/legacy.js` (sha256 `d4317568c6fb7383dd06258c251f492d23bc69aaf8ddf15aa78aba9978075432`)

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

### `make_fixture.py` (sha256 `ae4ce5a506c18cbe4891332bc2902b93b034b86a31543fbfb1f10a6a2497abec`)

```python
"""Combine the S15b-3c oracle outputs into server2/tests/domestic/fixtures/air_forecast.json.gz."""
import gzip, json, os
W = '/Users/ak/paseo/TodayWeather/.claude/worktrees/agent-a7c6632304cb7b2fc/'
O = W + 'reports/sdlc/issue-2742-s15b3c/out/'
d = {'schema': 2, 'gif': json.load(open(O + 'gif.json'))}
d['forecast'] = json.load(open(O + 'forecast.json'))
d['harness'] = json.load(open(O + 'harness.json'))
raw = json.dumps(d, ensure_ascii=False, separators=(',', ':')).encode()
open(W + 'server2/tests/domestic/fixtures/air_forecast.json.gz', 'wb').write(gzip.compress(raw, mtime=0))
print('fixture', len(raw), 'bytes', sorted(d))

```
