// Optional size-scoped output for the AN-18 reference matrix. Historical capture
// commands keep their existing paths; the matrix supplies one root per set/size.
import fs from 'node:fs';
import path from 'node:path';

export const PARITY_SIZES = ['384x832', '360x780', '412x892', '320x694'];

export function referenceRoot(root, set) {
    return process.env.TW_REFERENCE_ROOT || path.join(root, 'app/src/test/resources', `${set}-reference`);
}

/** Reject display/body mismatches before screenshots become reference evidence. */
export function measuredView(size, view, origin) {
    if (!PARITY_SIZES.includes(size)) throw new Error(`unsupported nominal size: ${size}`);
    const [width, height] = size.split('x').map(Number);
    if (view.screenWidth !== width || view.screenHeight !== height || view.dpr !== 2 || view.width !== width) {
        throw new Error(`display differs from ${size} at density 2: ${JSON.stringify(view)}`);
    }
    const values = [view.height, origin.x, origin.y];
    if (values.some(v => !Number.isFinite(v)) || view.height <= 0 || origin.x < 0 || origin.y < 0 ||
        origin.x + view.width * view.dpr > width * 2 || origin.y + view.height * view.dpr > height * 2) {
        throw new Error(`WebView outside nominal display: ${JSON.stringify({view, origin})}`);
    }
    return {nominal: {width, height}, webView: view, origin};
}

export async function recordView(dt, screenshots, out) {
    if (!process.env.TW_REFERENCE_SIZE) return;
    const view = await dt.evaluate(`({width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
        screenWidth: screen.width, screenHeight: screen.height, language: navigator.language})`);
    const geometry = measuredView(process.env.TW_REFERENCE_SIZE, view, screenshots.webViewOrigin());
    fs.mkdirSync(out, {recursive: true});
    fs.writeFileSync(path.join(out, 'viewport.json'), JSON.stringify(geometry, null, 2) + '\n');
}
