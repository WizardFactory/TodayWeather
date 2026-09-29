// Real Ionic/Angular browser smoke; native billing/ad SDKs are deliberately absent.
// Prerequisites: client www libraries/CSS/config generated, Playwright + Chromium installed.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../www');
const output = path.resolve(process.env.SMOKE_OUTPUT || 'reports/sdlc/issue-2641');
const errors = [], forbidden = [], external = [];
const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    if (name === '/cordova.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end(''); }
    const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    try {
        const type = {'.js':'application/javascript', '.json':'application/json', '.css':'text/css', '.html':'text/html', '.png':'image/png', '.svg':'image/svg+xml'}[path.extname(file)];
        if (type) res.setHeader('Content-Type', type);
        res.end(fs.readFileSync(file));
    } catch { res.writeHead(404); res.end(); }
});
(async () => {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox']});
    try {
        const page = await browser.newPage({viewport: {width: 390, height: 844}, locale: 'ko-KR'});
        page.on('pageerror', e => errors.push(e.message));
        await page.route('**/*', route => {
            const url = route.request().url();
            if (/check-purchase|itunes.*verifyReceipt|androidpublisher/.test(url)) forbidden.push(url);
            if (!url.startsWith(origin + '/') && !url.startsWith('data:')) { external.push(url); return route.abort(); }
            return route.continue();
        });
        await page.addInitScript(() => {
            localStorage.setItem('purchaseInfo', JSON.stringify({accountLevel: 'premium', expirationDate: '2099-01-01'}));
            localStorage.setItem('twAdsInfo', JSON.stringify({enable: false}));
            // Avoid loading a live Places provider; the smoke never searches for a city.
            window.google = {maps: {places: {AutocompleteService: function () {}}}};
        });
        await page.goto(origin);
        await page.evaluate(() => {
            window.smokeAngularErrors = [];
            angular.module('starter').config(function ($provide) {
                $provide.decorator('$exceptionHandler', function ($delegate) {
                    return function (err, cause) { window.smokeAngularErrors.push(String(err)); $delegate(err, cause); };
                });
            });
            clientConfig.isPaidApp = true; // stale imported setting must have no effect
            document.dispatchEvent(new Event('deviceready'));
        });
        await page.waitForFunction(() => angular.element(document).injector()?.get('$state').current.name === 'start');
        const initial = await page.evaluate(() => {
            const i = angular.element(document).injector();
            return {state: i.get('$state').current.name, purchaseService: i.has('Purchase'), purchaseRoute: !!i.get('$state').get('purchase')};
        });
        assert.deepEqual(initial, {state: 'start', purchaseService: false, purchaseRoute: false});
        for (const target of ['guide', 'units', 'start']) {
            await page.evaluate(target => { const i=angular.element(document).injector(); i.get('$rootScope').$apply(() => i.get('$state').go(target)); }, target);
            await page.waitForFunction(target => angular.element(document).injector().get('$state').current.name === target, target);
        }
        await page.evaluate(() => {
            const i=angular.element(document).injector();
            i.get('$rootScope').$apply(() => i.get('$ionicSideMenuDelegate').toggleLeft(true));
        });
        await page.waitForTimeout(400);
        // First-run start/guide navigation can queue more than one informational popup.
        for (let n = 0; n < 4; n++) {
            const button = page.locator('.popup-container.active .popup-buttons button');
            if (!await button.count()) break;
            await button.last().click();
            await page.waitForTimeout(400); // Ionic popup exit and next queued popup
        }
        assert.equal(await page.locator('.popup-container.active').count(), 0);
        const menu = await page.locator('ion-side-menu').innerText();
        assert.doesNotMatch(menu, /광고제거|Remove Ads|LOC_REMOVE_ADS|구매 복원/);
        assert.match(menu, /테마|Theme/);
        const billing = await page.evaluate(() => {
            // Even an accidentally supplied legacy billing global must remain unused.
            window.store = new Proxy({}, {get() { throw Error('Billing API touched'); }});
            const i=angular.element(document).injector(), ads=i.get('TwAds');
            ads.init();
            return {errors: window.smokeAngularErrors, stored: localStorage.getItem('twAdsInfo')};
        });
        assert.deepEqual(billing.errors, []);
        assert.deepEqual(errors, []);
        assert.deepEqual(forbidden, []);
        fs.mkdirSync(output, {recursive: true});
        await page.screenshot({path: path.join(output, 'settings-menu.png')});
        const result = {status: 'passed', initial, navigation: ['guide','units','start'], menu, angularErrors: billing.errors, pageErrors: errors, billingRequests: forbidden, blockedExternalRequests: external, limitation: 'Real browser and Ionic/Angular; no native billing/ad SDK or live weather provider exercised.'};
        fs.writeFileSync(path.join(output, 'smoke-result.json'), JSON.stringify(result, null, 2) + '\n');
        console.log(JSON.stringify(result, null, 2));
    } finally { await browser.close(); server.close(); }
})().catch(err => { console.error(err); server.close(); process.exitCode=1; });
