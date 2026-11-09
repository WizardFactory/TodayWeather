// WebView DevTools access for the emulator capture tools (chart-reference, shell-reference): connects to the
// running Cordova build of net.wizardfactory.todayweather and evaluates expressions in its page.
import {execFileSync} from 'node:child_process';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function connect(serial) {
    if (!/^emulator-\d+$/.test(serial || '')) throw new Error('pass an emulator serial; physical devices are not allowed');
    const adb = (...args) => execFileSync('adb', ['-s', serial, ...args]).toString().trim();
    let url = null;
    for (let i = 0; i < 90 && !url; i++) {
        let pid = '';
        try { pid = adb('shell', 'pidof', 'net.wizardfactory.todayweather'); } catch (_) { /* not started yet */ }
        if (pid) {
            try {
                adb('forward', 'tcp:9339', `localabstract:webview_devtools_remote_${pid}`);
                const pages = await (await fetch('http://127.0.0.1:9339/json')).json();
                url = (pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl) || {}).webSocketDebuggerUrl || null;
            } catch (_) { /* not ready yet */ }
        }
        if (!url) await sleep(1000);
    }
    if (!url) throw new Error('WebView DevTools socket not found');
    const ws = new WebSocket(url);
    await new Promise((r) => ws.addEventListener('open', r, {once: true}));
    let seq = 0;
    const send = (method, params = {}) => {
        const id = ++seq;
        ws.send(JSON.stringify({id, method, params}));
        return new Promise((resolve, reject) => {
            const onMessage = (e) => {
                const msg = JSON.parse(e.data);
                if (msg.id !== id) return;
                ws.removeEventListener('message', onMessage);
                if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
            };
            ws.addEventListener('message', onMessage);
        });
    };
    const evaluate = async (expression) => {
        const r = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
        if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
        return r.result.value;
    };
    // The app may reload its page while it starts; wait until the same page has been ready for 3 seconds.
    const settled = async () => {
        let last = null;
        for (let i = 0; i < 90; i++) {
            let origin = null;
            try {
                origin = await evaluate('window.angular && angular.element(document.body).injector() ? performance.timeOrigin : null');
            } catch (e) {
                if (!/context was destroyed|Cannot find context/.test(e.message)) throw e;
            }
            if (origin !== null && origin === last) return;
            last = origin;
            await sleep(3000);
        }
        throw new Error('app did not settle');
    };
    return {send, evaluate, settled, close: () => ws.close()};
}
