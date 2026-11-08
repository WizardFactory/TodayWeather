// Screen captures for the emulator reference tools (shell-reference, forecast-reference): the screen as the user sees
// it (screencap), where the WebView sits on it, and PNG cuts of device-pixel areas. DevTools screenshots are not used:
// on 2026-11-08 they drew the English menu's rows 2.5 dp shorter than the page's layout and the screen.
import {execFileSync} from 'node:child_process';
import zlib from 'node:zlib';

/** A PNG of RGB rows, each prefixed by filter byte 0. */
function encode(width, height, rows) {
    const chunk = (type, data) => {
        const head = Buffer.alloc(8);
        head.writeUInt32BE(data.length, 0);
        head.write(type, 4, 'latin1');
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0);
        return Buffer.concat([head, data, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(rows, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
}

export class Screen {
    constructor(serial) {
        if (!/^emulator-\d+$/.test(serial || '')) throw new Error('pass an emulator serial; physical devices are not allowed');
        const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], {maxBuffer: 256 << 20});
        /** The screen in RGBA (screencap without -p: width, height, format and, from Android 10, a color space word). */
        this.screen = function screen() {
            const raw = adb('exec-out', 'screencap');
            const width = raw.readUInt32LE(0), height = raw.readUInt32LE(4);
            if (raw.readUInt32LE(8) !== 1) throw new Error('screencap is not RGBA_8888');
            return {width, height, rgba: raw.subarray(raw.length - width * height * 4)};
        }

        /** Where the WebView is on the screen, in device pixels. */
        this.webViewOrigin = function webViewOrigin() {
            // The dump fails while the screen does not settle (an animation); it gets three tries a second apart.
            for (let attempt = 1; ; attempt++) {
                try {
                    adb('shell', 'uiautomator', 'dump', '/data/local/tmp/tw-window.xml');
                    break;
                } catch (e) {
                    if (attempt === 3) throw e;
                    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
                }
            }
            const xml = adb('exec-out', 'cat', '/data/local/tmp/tw-window.xml').toString();
            adb('shell', 'rm', '/data/local/tmp/tw-window.xml');
            const m = /class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]/.exec(xml);
            if (!m) throw new Error('no WebView in the window dump');
            return {x: Number(m[1]), y: Number(m[2])};
        }

        /** An RGB PNG of a device-pixel area of a screen. */
        this.png = function png(shot, area) {
            const stride = area.width * 3 + 1;
            const rows = Buffer.alloc(stride * area.height);
            for (let y = 0; y < area.height; y++) {
                for (let x = 0; x < area.width; x++) {
                    const from = ((area.y + y) * shot.width + area.x + x) * 4;
                    shot.rgba.copy(rows, y * stride + 1 + x * 3, from, from + 3);
                }
            }
            return encode(area.width, area.height, rows);
        }

        /** An RGB PNG of device-pixel areas of several screens, stacked top to bottom (a block taller than the screen). */
        this.pngStack = function pngStack(pieces) {
            const width = pieces[0].area.width;
            if (pieces.some((p) => p.area.width !== width)) throw new Error('stacked pieces differ in width');
            const height = pieces.reduce((h, p) => h + p.area.height, 0);
            const stride = width * 3 + 1;
            const rows = Buffer.alloc(stride * height);
            let y0 = 0;
            for (const {shot, area} of pieces) {
                for (let y = 0; y < area.height; y++) {
                    for (let x = 0; x < width; x++) {
                        const from = ((area.y + y) * shot.width + area.x + x) * 4;
                        shot.rgba.copy(rows, (y0 + y) * stride + 1 + x * 3, from, from + 3);
                    }
                }
                y0 += area.height;
            }
            return encode(width, height, rows);
        };
    }
}
