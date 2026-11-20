'use strict';
var getJson = require('../geocoder/transport').getJson;

// Probe the service origin directly. A cached geocode or a redirect can succeed before the origin is back.
async function originReady(origin) {
    var url = new URL('/health', origin).href;
    try {
        var response = await getJson(url, { timeoutMs: 5000, maxBytes: 2 });
        return response.status === 200 && response.text === 'OK';
    } catch (error) {
        return false;
    }
}

function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function restoreAndStart(origin, registry, engine, wait = sleep) {
    var delay = 1000;
    while (!(await originReady(origin))) {
        console.warn(JSON.stringify({ event: 'push-origin-unavailable', retryMs: delay }));
        await wait(delay);
        delay = Math.min(delay * 2, 30000);
    }
    delay = 30000;
    await registry.init(async function (unresolvedDevices, reasons) {
        console.warn(JSON.stringify({ event: 'push-restore-pending', unresolvedDevices: unresolvedDevices, reasons: reasons, retryMs: delay }));
        await wait(delay);
        delay = Math.min(delay * 2, 300000);
    });
    await engine.init();
    engine.start();
}
module.exports = { restoreAndStart: restoreAndStart };
