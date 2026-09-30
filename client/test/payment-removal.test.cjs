const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('purchase UI, route and Angular dependencies are removed', () => {
    for (const p of ['www/index.html', ...fs.readdirSync(path.join(root, 'www/js')).map(p => 'www/js/' + p)]) {
        if (/controller\.purchase/.test(p)) continue;
        assert.doesNotMatch(read(p), /\bPurchase(?:Ctrl)?\b|controller\.purchase|LOC_REMOVE_ADS|clickMenu\('purchase'\)|\.state\('purchase'/, p);
    }
    for (const p of ['www/templates/purchase.html', 'www/js/controller.purchase.js', 'www/js/controller.purchase.j3k0.js', 'www/js/controller.purchase.alexdisler.js']) {
        assert.equal(fs.existsSync(path.join(root, p)), false, p);
    }
});

test('maintained build inputs cannot reinstall billing or purchase code', () => {
    for (const p of ['gulpfile.js', 'package.json', 'package-lock.json', 'config.xml', 'tw.package.json', 'ta.package.json']) {
        assert.doesNotMatch(read(p), /cordova-plugin-inapppurchase|cc\.fovea\.cordova\.purchase|controller\.purchase|BILLING_KEY/, p);
    }
    assert.ok(JSON.parse(read('package.json')).cordova.plugins['cordova-plugin-inappbrowser']);
});

test('storage and localization no longer expose payment functionality', () => {
    assert.doesNotMatch(read('www/js/service.storage.js'), /purchaseInfo|storeReceipt|twAdsInfo/);
    for (const name of fs.readdirSync(path.join(root, 'www/locales'))) {
        assert.doesNotMatch(read('www/locales/' + name), /"LOC_(?:REMOVE_ADS|RESTORE_PURCHASES|PAID_APP|GET_PREMIUM_TO_REMOVE_ADS|USE_PREMIUM_WITHOUT_ADS|THANK_YOU_FOR_USING_PREMIUM)"/);
    }
});

function loadAds(stale) {
    let factory, ready;
    const calls = [];
    const adapter = {
        init(options, done) { ready = done; },
        createBannerView(done) { calls.push('create'); done(); },
        destroyBannerView(done) { calls.push('destroy'); done(); },
        showBannerAd(show, done) { calls.push(show ? 'show' : 'hide'); done(); }
    };
    const context = {
        angular: { module() { return { factory(name, fn) { factory = fn; } }; } },
        clientConfig: {isPaidApp: true},
        ionic: {Platform: {isIOS: () => false, isAndroid: () => true}},
        window: {addEventListener() {}}, console: {log() {}}, screen: {orientation: {type: 'portrait'}}
    };
    vm.runInNewContext(read('www/js/service.twads.js'), context);
    const dependencies = {
        TwStorage: {get() { return stale; }, set() { throw Error('Payment storage write'); }},
        Util: {ga: {trackEvent() {}, trackException() {}}},
        Monetization: {bannerPolicy: () => ({enabled: true, delaySeconds: 0}), loadConfig() {}, track() {}},
        admobPro: {init() {}}, admobClean: {init() {}}, admobEmi: adapter
    };
    const args = factory.toString().match(/function\s*\(([^)]*)\)/)[1].split(',').map(s => dependencies[s.trim()]);
    const ads = factory(...args);
    return {ads, calls, ready: () => ready()};
}
for (const [name, stale] of [['fresh', null], ['stale exemption', {enable: false}], ['stale premium', {accountLevel: 'premium', expirationDate: '2099-01-01'}]]) {
    test('ordinary ads work with ' + name, () => {
        const {ads, calls, ready} = loadAds(stale);
        ads.setShowAds(false);
        ads.init(); ready();
        assert.equal(ads.enableAds, true);
        assert.equal(ads.showAds, false);
        assert.ok(calls.includes('create'));
        ads.setShowAds(true);
        assert.equal(ads.showAds, true);
        assert.ok(calls.includes('show'));
        ads.setShowAds(false);
        assert.equal(ads.showAds, false);
        assert.equal(ads.saveTwAdsInfo, undefined);
    });
}

test('config generation strips retired paid settings from a legacy input', () => {
    const os = require('node:os');
    const {execFileSync} = require('node:child_process');
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'payment-config-'));
    try {
        fs.mkdirSync(path.join(temp, 'scripts'));
        fs.mkdirSync(path.join(temp, 'www'));
        for (const name of ['make-client-config.mjs', 'env.mjs']) fs.copyFileSync(path.join(root, 'scripts', name), path.join(temp, 'scripts', name));
        fs.writeFileSync(path.join(temp, 'www/client.config.example.js'), "window.clientConfig = {isPaidApp: true, iOSPaidAppUrl: 'old', androidPaidAppUrl: 'old', serverUrl: 'http://local'};");
        execFileSync(process.execPath, [path.join(temp, 'scripts/make-client-config.mjs')], {stdio: 'pipe', env: {PATH: process.env.PATH}});
        const sandbox = {window: {}};
        vm.runInNewContext(fs.readFileSync(path.join(temp, 'www/client.config.js'), 'utf8'), sandbox);
        for (const key of ['isPaidApp', 'iOSPaidAppUrl', 'androidPaidAppUrl']) assert.equal(key in sandbox.window.clientConfig, false);
        assert.equal(sandbox.window.clientConfig.serverUrl, 'http://local');
    } finally { fs.rmSync(temp, {recursive: true, force: true}); }
});

test('legacy native build inputs do not reintroduce app billing declarations', () => {
    for (const p of ['tw.ios/TodayWeather.xcodeproj/project.pbxproj', 'ta.ios/TodayAir.xcodeproj/project.pbxproj']) {
        assert.doesNotMatch(fs.readFileSync(path.resolve(root, '..', p), 'utf8'), /StoreKit\.framework|com\.apple\.InAppPurchase/, p);
    }
    for (const name of fs.readdirSync(path.join(root, 'www/locales'))) {
        assert.doesNotMatch(read('www/locales/' + name), /LOC_PLEASE_RESTORE_AFTER_1[-_]2_MINUTES/);
    }
});
