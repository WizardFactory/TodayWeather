'use strict';
// Real Angular 1.x compiles the current-conditions table from both client/www templates.
// Input is output of pollen-route-smoke.js, not hand-authored display HTML. No providers/startup.
const {chromium} = require('playwright');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const input = process.env.POLLEN_CAPTURE;
if (!input) throw Error('Set POLLEN_CAPTURE to pollen-route-smoke.js output');
const responses = JSON.parse(fs.readFileSync(input));
const assets = process.env.ANGULAR_ASSET_ROOT || path.join(root, 'tw.ios/www');
const out = process.env.POLLEN_SCREENSHOTS || path.join(root, 'reports/verification/pollen');
fs.mkdirSync(out, {recursive: true});
const labels = JSON.parse(fs.readFileSync(path.join(root, 'client/www/locales/en.json')));
const server = http.createServer((req, res) => {
    if (req.url === '/ionic.js') {
        res.setHeader('content-type', 'application/javascript');
        return res.end(fs.readFileSync(path.join(assets, 'lib/ionic/js/ionic.bundle.min.js')));
    }
    if (req.url === '/app.css') {
        res.setHeader('content-type', 'text/css');
        return res.end(fs.readFileSync(process.env.POLLEN_CSS || path.join(assets, 'css/ionic.app.css')));
    }
    if (/^\/icons\/[a-z0-9_]+\.png$/.test(req.url)) {
        res.setHeader('content-type', 'image/png');
        const icon = path.join(root, 'client/www/img/icons_default', path.basename(req.url));
        if (!fs.existsSync(icon)) { res.statusCode = 404; return res.end(); }
        return res.end(fs.readFileSync(icon));
    }
    if (/^\/lib\/ionic\/fonts\/[a-zA-Z0-9_.-]+$/.test(req.url)) {
        return res.end(fs.readFileSync(path.join(assets, 'lib/ionic/fonts', path.basename(req.url))));
    }
    const query = new URL(req.url, 'http://localhost').searchParams;
    const name = query.get('template');
    const scenario = query.get('scenario');
    if (!['tab-forecast', 'ta-tab-weather'].includes(name) || !responses[scenario]) {
        res.statusCode = 404; return res.end();
    }
    const template = fs.readFileSync(path.join(root, 'client/www/templates', name + '.html'), 'utf8');
    const table = template.match(/<table class="colgroup-box">[\s\S]*?<\/table>/)[0];
    const weather = responses[scenario].current;
    weather.today = responses[scenario].midData.dailyData.find(day => day.date === weather.date);
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><link rel="stylesheet" href="/app.css">
    <body class="platform-ios"><div class="forecast"><div class="main-content"><div class="card"><div class="card-title">Weather details</div>${table}</div></div></div>
    <script src="/ionic.js"></script><script>
    angular.module('pollenSmoke', ['ionic']).filter('translate', function(){var labels=${JSON.stringify(labels)};return function(k){return labels[k] || k;};})
    .run(function($rootScope, $ionicPopup){var $scope=$rootScope; var $translate={instant:function(k){return ${JSON.stringify(labels)}[k] || k;}}; ${fs.readFileSync(path.join(root, 'client/www/js/controller.tabctrl.js'), 'utf8').match(/\$scope\.showPollenInfo = function\(day, event\) \{[\s\S]*?\n        \};/)[0]} $rootScope.currentWeather=${JSON.stringify(weather)};$rootScope.iconsImgPath='/icons';
    $rootScope.getWindSpdUnit=function(){return 'm/s';}; $rootScope.diffTempStr='22°';});
    angular.bootstrap(document, ['pollenSmoke']);</script></body></html>`);
});
(async () => {
    let browser;
    const images = [];
    try {
        await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
        browser = await chromium.launch({executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH});
        const page = await browser.newPage({viewport: {width: 390, height: 540}});
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
        for (const name of ['tab-forecast', 'ta-tab-weather']) {
            for (const [scenario, summary, expected] of [
                ['spring', 'High', ['Oak: High', 'Pine: Normal']],
                ['autumn', 'Normal', ['Weeds: Normal']], ['low', 'Low', ['Weeds: Low']],
                ['missing', undefined, []]
            ]) {
                await page.goto(`http://127.0.0.1:${server.address().port}/?template=${name}&scenario=${scenario}`);
                const pollen = page.locator('button.pollen-risk');
                if (summary === undefined) {
                    assert.equal(await pollen.count(), 0);
                } else {
                    assert.equal((await pollen.innerText()).trim(), 'Pollen risk: ' + summary);
                    assert.equal(await page.locator('.popup-container').count(), 0);
                    await pollen.click();
                    const popup = page.locator('.popup-container.popup-showing');
                    await popup.waitFor();
                    assert.equal(await popup.locator('.popup-title').innerText(), 'Pollen risk');
                    assert.equal(await popup.locator('.popup').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
                    await popup.locator('.popup-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
                    assert.ok(await popup.getByRole('button', {name: 'Close', exact: true}).isVisible());
                    await popup.locator('.popup-body').evaluate(el => { el.scrollTop = 0; });
                    assert.deepEqual(await popup.locator('.popup-body strong').allTextContents(), expected);
                    const types = Object.entries({flowerWoody: 'LOC_POLLEN_OAK', flowerPine: 'LOC_POLLEN_PINE', flowerWeeds: 'LOC_POLLEN_WEEDS'}).filter(([field]) => responses[scenario].current[field + 'Grade'] !== undefined);
                    const text = await popup.innerText();
                    for (const [field, key] of types) {
                        assert.ok(text.includes(labels[key + '_INFO']));
                        assert.ok(text.includes(labels['LOC_POLLEN_ADVICE_' + responses[scenario].current[field + 'Grade']]));
                    }
                    assert.ok(text.includes(labels.LOC_POLLEN_SOURCE));
                    assert.ok(!/\b[0-3]\b/.test(await popup.innerText()), 'risk display must never show concentration');
                    await popup.getByRole('button', {name: 'Close', exact: true}).click();
                    await page.waitForTimeout(300);
                    assert.equal(await page.locator('.popup-container').count(), 0);
                    await pollen.focus();
                    await page.keyboard.press('Enter');
                    await page.locator('.popup-container.popup-showing').waitFor();
                    await page.waitForTimeout(400);
                }
                const file = `pollen-${name}-${scenario}.png`;
                await page.screenshot({path: path.join(out, file)});
                images.push({file, scenario, template: name,
                    sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(out, file))).digest('hex')});
            }
        }
        assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(out, 'provenance.json'), JSON.stringify({date: '2026-10-03',
            browser: browser.version(), angular: 'tw.ios/www/lib/ionic/js/ionic.bundle.min.js',
            script: 'scripts/verification/pollen-client-smoke.cjs',
            fixture: 'server/test/offline/pollen-route-smoke.js', scope: 'actual client table; offline v000903 output; shared SCSS with Ionic; no Cordova build', images}, null, 2) + '\n');
        console.log('PASS both Angular templates: spring/autumn/zero/missing, click/close and keyboard popup; eight captures.');
    } finally {await browser?.close(); server.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
