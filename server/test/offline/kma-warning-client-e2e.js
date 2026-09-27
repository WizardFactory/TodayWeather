/* client/www end-to-end display check for KMA warnings (#2609).
 *
 * Starts kma-warning-smoke.js in server mode (real collector → MongoDB → real /v000903/kma router, and the
 * v000903 town response with the real special weather controller), serves client/www from the same origin
 * and drives it in Chromium:
 *   - forecast tab of a stored 서귀포시 성산읍 city: the summary shows the town warning (호우주의보);
 *   - S12 screen (#/kma-special): every bulletin type with the new warning texts.
 *
 *   TZ=UTC TW_MONGO_URL=mongodb://127.0.0.1:27099/tw2609 TW_CLIENT_LIB=<bower lib> TW_CLIENT_CSS=<ionic.app.css> \
 *   NODE_PATH=<smoke deps + playwright> node server/test/offline/kma-warning-client-e2e.js
 *
 * client/www has no bower libraries or compiled CSS in the repository: install bower.json into a temporary
 * directory and compile scss/ionic.app.scss there (see README). PLAYWRIGHT_EXECUTABLE_PATH selects Chromium.
 * TW_SMOKE_OUTPUT_DIR receives screenshots and the result JSON.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');
const {chromium} = require('playwright');

const port = process.env.TW_E2E_PORT || '4609';
const origin = 'http://127.0.0.1:' + port;
const outputDir = process.env.TW_SMOKE_OUTPUT_DIR || path.join(require('os').tmpdir(), 'kma-warning-e2e-output');
fs.mkdirSync(outputDir, {recursive: true});

function startServer() {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, 'kma-warning-smoke.js')],
            {env: Object.assign({}, process.env, {TW_E2E_PORT: port}), stdio: ['ignore', 'pipe', 'pipe']});
        let output = '';
        const onData = chunk => {
            output += chunk;
            process.stdout.write(chunk);
            if (output.indexOf('E2E server ready') !== -1) { resolve(child); }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', chunk => { output += chunk; });
        child.on('exit', code => reject(new Error('smoke server exited ' + code + '\n' + output.slice(-2000))));
    });
}

const city = {currentPosition: false, address: '대한민국 제주특별자치도 서귀포시 성산읍', name: '성산읍', country: 'KR',
    location: {lat: 33.4588, long: 126.9425}, disable: false};

async function main() {
    const server = await startServer();
    const browser = await chromium.launch(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH, args: ['--no-sandbox']} : {});
    const result = {requests: [], consoleErrors: [], checks: {}};
    try {
        const context = await browser.newContext({locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: {width: 390, height: 844}});
        await context.addInitScript(seed => {
            if (localStorage.getItem('cities') === null) {
                localStorage.setItem('startVersion', '1');
                localStorage.setItem('settingsInfo', JSON.stringify({startupPage: '0', refreshInterval: '0'}));
                localStorage.setItem('cities', JSON.stringify([seed]));
                localStorage.setItem('cityIndex', '0');
                // Skip the first-run update notice that would cover the screens.
                localStorage.setItem('appVersion', JSON.stringify('1.0.0'));
                localStorage.setItem('disableUpdateInfo', 'true');
            }
        }, city);
        const page = await context.newPage();
        page.on('request', req => { if (/\/(weather|v000903)\//.test(req.url())) { result.requests.push(req.method() + ' ' + req.url().replace(origin, '')); } });
        page.on('console', msg => { if (msg.type() === 'error') { result.consoleErrors.push(msg.text()); } });

        // Forecast tab: summary built by the server from current.specialInfo.
        await page.goto(origin + '/index.html');
        const summary = page.locator('.main-box-summary').first();
        await summary.waitFor({state: 'visible', timeout: 30000});
        await page.waitForFunction(() => Array.from(document.querySelectorAll('.main-box-summary')).some(el => /호우주의보/.test(el.textContent)), null, {timeout: 30000});
        result.checks.summary = (await summary.textContent()).trim();
        assert.ok(/호우주의보/.test(result.checks.summary), 'forecast summary shows the town warning');
        assert.ok(result.requests.some(r => r.indexOf('/weather/v000903/coord/33.4588,126.9425') !== -1), 'coordinate weather request');
        await page.screenshot({path: path.join(outputDir, 'client-forecast.png')});

        // S12 warning screen.
        await page.evaluate(() => { location.hash = '#/kma-special'; });
        const items = page.locator('ion-view[nav-view="active"] .item-body, .item-body');
        await page.waitForFunction(() => document.querySelectorAll('.item-body h2').length >= 3, null, {timeout: 30000});
        const texts = await items.allTextContents();
        const headings = await page.locator('.item-body h2').allTextContents();
        result.checks.headings = headings.map(t => t.replace(/\s+/g, ' ').trim());
        const all = texts.join('\n');
        for (const name of ['기상특보', '예비특보', '기상정보']) {
            assert.ok(result.checks.headings.some(h => h.indexOf(name) !== -1), 'S12 shows ' + name);
        }
        if (Date.now() < Date.parse('2026-09-27T19:10:00Z')) {
            assert.ok(result.checks.headings.some(h => h.indexOf('기상속보') !== -1), 'S12 shows 기상속보 within its window');
        }
        for (const text of ['강풍주의보', '호우경보', '호우주의보', '제주도(제주도산지, 제주시중산간)', '서귀포시동부', '<예비특보 추가 발표 현황>', '안개']) {
            assert.ok(all.indexOf(text) !== -1, 'S12 contains ' + text);
        }
        // A Korean device shows the announcement in KST: tmFc 202609261130.
        assert.ok(result.checks.headings.some(h => /기상특보 2026\. ?9\. ?26\. 오전 11:30/.test(h)), 'S12 shows 2026-09-26 11:30 KST: ' + result.checks.headings.join(' | '));
        assert.ok(result.requests.some(r => r.indexOf('/v000903/kma/special') !== -1), 'S12 request');
        await page.screenshot({path: path.join(outputDir, 'client-kma-special.png'), fullPage: true});
        result.checks.s12Length = all.length;
        result.passed = true;
    }
    finally {
        fs.writeFileSync(path.join(outputDir, 'client-e2e.json'), JSON.stringify(result, null, 1));
        await browser.close();
        server.kill();
    }
    console.log(JSON.stringify(result.checks));
    console.log('kma warning client/www e2e passed');
}

main().catch(err => { console.error(err.stack); process.exitCode = 1; });
