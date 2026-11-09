#!/usr/bin/env node
// Writes the synthetic weather photo the settings references show in the photo theme (photo.png): the capture serves
// it to the Cordova build as the feed's only photo (a data URL) and the native tests draw the same file. A sky
// gradient with blocks of color near the edges and the center, so a photo cropped or placed differently shows.
//   node photo.mjs <android-dir>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const [root] = process.argv.slice(2);
const W = 480, H = 320;
const rows = Buffer.alloc((W * 3 + 1) * H);
const blocks = [[0, 0, 60, 40, [200, 60, 40]], [W - 60, 0, 60, 40, [40, 160, 60]], [0, H - 40, 60, 40, [230, 200, 40]],
    [W - 60, H - 40, 60, 40, [120, 40, 160]], [W / 2 - 40, H / 2 - 30, 80, 60, [250, 250, 250]]];
for (let y = 0; y < H; y++) {
    rows[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
        let c = [40 + Math.round(80 * y / H), 90 + Math.round(100 * y / H), 170 + Math.round(60 * x / W)];
        for (const [bx, by, bw, bh, color] of blocks) if (x >= bx && x < bx + bw && y >= by && y < by + bh) c = color;
        rows.set(c, y * (W * 3 + 1) + 1 + x * 3);
    }
}
const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr.set([8, 2, 0, 0, 0], 8);
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(path.join(root, 'app/src/test/resources/settings-reference/photo.png'), png);
console.log(`photo.png ${W}x${H}, ${png.length} bytes`);
