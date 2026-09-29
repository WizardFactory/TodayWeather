// Runs an XHR inside the app's Android WebView (debug build) over the DevTools protocol and reports
// Network.loadingFailed / responseReceived details. Usage: node cdp-probe.mjs <url>...
import { execFileSync } from 'node:child_process';

const ADB = `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const sock = execFileSync(ADB, ['shell', 'cat', '/proc/net/unix']).toString()
    .split('\n').map((l) => (l.match(/@(webview_devtools_remote_\d+)/) || [])[1]).filter(Boolean).pop();
if (!sock) throw new Error('no WebView devtools socket (is the debug app running?)');
execFileSync(ADB, ['forward', 'tcp:9333', `localabstract:${sock}`]);
const pages = await (await fetch('http://127.0.0.1:9333/json')).json();
const page = pages.find((p) => p.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const waiting = new Map(); const events = [];
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; waiting.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); }
    else if (/^Network\.(loadingFailed|responseReceived|requestWillBeSent|requestWillBeSentExtraInfo|responseReceivedExtraInfo)$/.test(d.method)) events.push(d);
};
await new Promise((r) => { ws.onopen = r; });
await send('Network.enable');
for (const url of process.argv.slice(2)) {
    events.length = 0;
    const r = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `new Promise(function (res) {
        var x = new XMLHttpRequest(); x.open('GET', ${JSON.stringify(url)});
        x.onloadend = function () { res({ status: x.status, len: (x.responseText || '').length, origin: location.origin }); };
        x.send(); })` });
    await new Promise((res) => setTimeout(res, 800));
    console.log('\nURL', url.slice(0, 90), '\n  xhr:', JSON.stringify(r.result.result.value));
    for (const e of events) {
        const p = e.params;
        if (e.method === 'Network.responseReceived') console.log('  response', p.response.status, 'ACAO=' + (p.response.headers['access-control-allow-origin'] || p.response.headers['Access-Control-Allow-Origin']));
        if (e.method === 'Network.requestWillBeSentExtraInfo') console.log('  request headers', JSON.stringify(p.headers));
        if (e.method === 'Network.responseReceivedExtraInfo') console.log('  response', p.statusCode, 'headers', JSON.stringify(p.headers));
        if (e.method === 'Network.loadingFailed') console.log('  failed', p.errorText, p.corsErrorStatus ? JSON.stringify(p.corsErrorStatus) : '', p.blockedReason || '');
    }
}
ws.close();
execFileSync(ADB, ['forward', '--remove', 'tcp:9333']);
