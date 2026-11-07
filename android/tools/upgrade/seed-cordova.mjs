#!/usr/bin/env node
// Seeds a running Cordova TodayWeather debug build with places, units, settings, alarms and an
// analytics opt-in, through the app's own services over the WebView DevTools protocol, then prints
// the state it wrote as JSON. Run with the emulator offline (run-upgrade-test.sh does this), so the
// app has no FCM token and sends nothing to the production push server.
//   node seed-cordova.mjs <adb-serial> > seeded.json
import {execFileSync} from 'node:child_process';

const serial = process.argv[2];
if (!/^emulator-\d+$/.test(serial || '')) throw new Error('pass an emulator serial; physical devices are not allowed');
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args]).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function devtoolsPage() {
    for (let i = 0; i < 60; i++) {
        let pid = '';
        try { pid = adb('shell', 'pidof', 'net.wizardfactory.todayweather'); } catch (_) { /* not started yet */ }
        if (pid) {
            try {
                adb('forward', 'tcp:9339', `localabstract:webview_devtools_remote_${pid}`);
                const pages = await (await fetch('http://127.0.0.1:9339/json')).json();
                const page = pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl);
                if (page) return page.webSocketDebuggerUrl;
            } catch (_) { /* not ready yet */ }
        }
        await sleep(1000);
    }
    throw new Error('WebView DevTools socket not found');
}

async function evaluate(ws, expression) {
    const id = Math.floor(Math.random() * 1e9);
    ws.send(JSON.stringify({id, method: 'Runtime.evaluate', params: {expression, returnByValue: true}}));
    for (;;) {
        const msg = JSON.parse((await new Promise((r) => ws.addEventListener('message', (e) => r(e.data), {once: true}))));
        if (msg.id !== id) continue;
        if (msg.result.exceptionDetails) throw new Error(JSON.stringify(msg.result.exceptionDetails).slice(0, 500));
        return msg.result.result.value;
    }
}

// ES2015 only: the API 24 emulator's WebView (Chrome 53) has no async/await or Object.fromEntries.
const SEED = `(function () {
    function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function ready(i) {
        if (window.angular && angular.element(document.body).injector()) return Promise.resolve();
        if (i > 60) return Promise.reject(new Error('app did not start'));
        return wait(500).then(function () { return ready(i + 1); });
    }
    return ready(0).then(function () {
        var inj = angular.element(document.body).injector();
        var WeatherInfo = inj.get('WeatherInfo'), TwStorage = inj.get('TwStorage'), Units = inj.get('Units');
        var Push = inj.get('Push'), Monetization = inj.get('Monetization'), $rootScope = inj.get('$rootScope');
        WeatherInfo.addCity({name: '명동', address: '대한민국 서울특별시 중구 명동', country: 'KR',
            location: {lat: 37.56, long: 126.98}, currentPosition: false});
        WeatherInfo.addCity({name: 'London', address: 'United Kingdom London', country: 'GB',
            location: {lat: 51.51, long: -0.13}, currentPosition: false});
        WeatherInfo.setCityIndex(2);
        Units.setUnit('temperatureUnit', 'F'); Units.setUnit('windSpeedUnit', 'km/h'); Units.setUnit('airUnit', 'airnow');
        Units.saveUnits();
        $rootScope.settingsInfo = {startupPage: '1', refreshInterval: '30', theme: 'dark'};
        TwStorage.set('settingsInfo', $rootScope.settingsInfo);
        TwStorage.set('expandShortChart', true);
        var week = [false, true, true, true, true, true, false];
        Push.updatePushListByCityIndex([Push.newPushAlert(1, 1, 7, 22),
            Push.newPushAlarm(2, 1, 7 * 3600 + 40 * 60, week), Push.newPushAlarm(3, 1, 20 * 3600 + 20 * 60, week)], 1);
        Push.updatePushListByCityIndex([Push.newPushAlarm(2, 2, 6 * 3600, [true, true, true, true, true, true, true])], 2);
        return new Promise(function (resolve) { Monetization.setCollectionEnabled(true, resolve); });
    }).then(function () {
        return wait(3000); // native suite writes are asynchronous
    }).then(function () {
        var storage = {};
        ['cities', 'cityIndex', 'units', 'settingsInfo', 'pushData2', 'expandShortChart', 'startVersion', 'appVersion']
            .forEach(function (k) { storage[k] = localStorage.getItem(k); });
        return {deviceId: window.device && device.uuid,
            analyticsChoice: angular.element(document.body).injector().get('Monetization').getCollectionChoice(), storage: storage};
    });
})()`;

const ws = new WebSocket(await devtoolsPage());
await new Promise((r) => ws.addEventListener('open', r, {once: true}));
// Old WebViews cannot await a promise over DevTools, so the page stores the result and we poll for it.
await evaluate(ws, `window.__twSeed = ''; ${SEED}.then(function (r) { window.__twSeed = JSON.stringify(r); },
    function (e) { window.__twSeed = JSON.stringify({error: String(e)}); }); 0`);
let result;
for (let i = 0; i < 120 && !result; i++) {
    const text = await evaluate(ws, 'window.__twSeed');
    if (text) result = JSON.parse(text);
    else await sleep(500);
}
if (!result || result.error) throw new Error(`seeding failed: ${result && result.error}`);
ws.close();
adb('forward', '--remove', 'tcp:9339');
process.stdout.write(JSON.stringify(result, null, 1) + '\n');
