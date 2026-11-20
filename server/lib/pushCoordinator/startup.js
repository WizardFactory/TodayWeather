'use strict';
var http = require('http');
var https = require('https');

// Probe the service origin directly. A cached geocode or a redirect can succeed before the origin is back.
function originReady(origin) {
    var url = new URL('/health', origin);
    var client = url.protocol === 'https:' ? https : http;
    return new Promise(function (resolve) {
        var request = client.get(url, function (response) {
            var body = '';
            response.setEncoding('utf8');
            response.on('error', function () { resolve(false); });
            response.on('data', function (chunk) {
                body += chunk;
                if (body.length > 2) request.destroy();
            });
            response.on('end', function () { resolve(response.statusCode === 200 && body === 'OK'); });
        });
        var deadline = setTimeout(function () { request.destroy(); }, 5000);
        request.on('error', function () { resolve(false); });
        request.on('close', function () {
            clearTimeout(deadline);
            resolve(false);
        });
    });
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
    await registry.init(async function (unresolvedDevices) {
        console.warn(JSON.stringify({ event: 'push-restore-pending', unresolvedDevices: unresolvedDevices, retryMs: delay }));
        await wait(delay);
        delay = Math.min(delay * 2, 300000);
    });
    await engine.init();
    engine.start();
}
module.exports = { restoreAndStart: restoreAndStart };
