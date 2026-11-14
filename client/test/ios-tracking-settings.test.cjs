// iOS tracking-permission row and page notice (#2990): the overlay in resources/ios/tracking-settings and the
// after_prepare hook that adds it to the iOS bundle only. client/www, which the Android parity references track,
// never contains it.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const OVERLAY = path.join(root, 'resources/ios/tracking-settings');
const LOCALES = ['ko', 'en', 'ja', 'zh-CN', 'zh-TW', 'de'];
const KEYS = ['LOC_TRACKING_PERMISSION', 'LOC_TRACKING_ALLOWED', 'LOC_TRACKING_NOT_ALLOWED', 'LOC_TRACKING_NOTICE',
    'LOC_TRACKING_OPEN_SETTINGS'];
const PAGES = ['tab-forecast.html', 'tab-dailyforecast.html', 'tab-air.html'];
const STATUSES = ['authorized', 'denied', 'restricted', 'not_determined', 'unavailable', 'something_new', undefined];
const overlay = () => require(path.join(OVERLAY, 'tracking-settings.js'));
const hook = () => require(path.join(root, 'scripts/ios-tracking-settings.js'));
const strings = () => JSON.parse(fs.readFileSync(path.join(OVERLAY, 'strings.json'), 'utf8'));

test('the menu row shows for authorized and denied, the page notice only for denied', () => {
    const expected = {
        authorized: {row: true, allowed: true, notice: false},
        denied: {row: true, allowed: false, notice: true}
    };
    for (const status of STATUSES) {
        assert.deepEqual(overlay().visibility(status), expected[status] || {row: false, allowed: false, notice: false},
            String(status));
    }
});

test('every locale has the five texts; the Korean notice is the one AK set; no button invites to "allow"', () => {
    const texts = strings();
    assert.deepEqual(Object.keys(texts).sort(), [...LOCALES].sort());
    for (const locale of LOCALES) {
        assert.deepEqual(Object.keys(texts[locale]).sort(), [...KEYS].sort(), locale);
        for (const key of KEYS) assert.ok(texts[locale][key].trim(), `${locale} ${key}`);
        assert.doesNotMatch(texts[locale].LOC_TRACKING_OPEN_SETTINGS, /allow|허용|許可|允许|允許|erlaub/i, locale);
    }
    assert.equal(texts.ko.LOC_TRACKING_NOTICE, 'TodayWeather는 광고 수익으로 운영됩니다. 관심사에 맞는 광고를 원하면 ' +
        'iOS 설정에서 추적을 허용할 수 있습니다. 기능은 어느 쪽이든 같습니다.');
    assert.equal(texts.ko.LOC_TRACKING_OPEN_SETTINGS, '설정 열기');
    for (const locale of LOCALES) {
        const shared = JSON.parse(fs.readFileSync(path.join(root, 'www/locales', locale + '.json'), 'utf8'));
        for (const key of KEYS) assert.equal(shared[key], undefined, `${key} must not be in client/www/locales/${locale}.json`);
    }
});

test('the overlay never prompts, opens no popup or modal and keeps no hidden state', () => {
    const code = fs.readFileSync(path.join(OVERLAY, 'tracking-settings.js'), 'utf8');
    for (const banned of ['requestTrackingAuthorization', 'requestIDFA', '$ionicPopup', '$ionicModal', 'showAlert',
        'alert(', 'confirm(', 'localStorage', 'backdrop']) {
        assert.ok(!code.includes(banned), banned);
    }
    assert.match(code, /'emiAdmobPlugin', 'twAdPrivacyState'/);
    assert.ok(fs.statSync(path.join(OVERLAY, 'tracking-settings.css')).size > 0);
});

function fakeApp() {
    const registered = {factory: {}, directive: {}, run: []};
    const module = {
        factory(name, def) { registered.factory[name] = def; return module; },
        directive(name, def) { registered.directive[name] = def; return module; },
        run(def) { registered.run.push(def); return module; }
    };
    const angular = {module(name, deps) {
        assert.equal(name, 'starter'); assert.equal(deps, undefined, 'must not create a module'); return module;
    }};
    return {angular, registered};
}
const invoke = (def, ...args) => def[def.length - 1](...args);

function service({status = 'denied', settings = 'ok'} = {}) {
    let current = status;
    const {angular, registered} = fakeApp();
    overlay().register(angular);
    const calls = [], warns = [], rootHandlers = {}, docHandlers = {};
    const $rootScope = {$on(name, fn) { rootHandlers[name] = fn; }, $evalAsync(fn) { fn(); }};
    const diagnostic = {switchToSettings(ok, fail) { calls.push('switchToSettings'); settings === 'ok' ? ok() : fail('no'); }};
    const $window = {
        console: {warn: x => warns.push(x)},
        document: {addEventListener(name, fn) { docHandlers[name] = fn; }},
        cordova: {
            plugins: settings === 'missing' ? {} : {diagnostic},
            exec(ok, fail, service, action, args) {
                calls.push([service, action, args]);
                if (current === 'error') fail('error'); else ok({att_status: current, personalized: current === 'authorized'});
            }
        }
    };
    const tracking = invoke(registered.factory.twTrackingStatus, $rootScope, $window);
    return {tracking, registered, calls, warns, rootHandlers, docHandlers, $window, setStatus(value) { current = value; }};
}

test('the status is read on start, resume, activation, banner results and page change, only through twAdPrivacyState', () => {
    const s = service({status: 'denied'});
    assert.equal(s.tracking.state.status, 'unavailable', 'nothing is shown before the first answer');
    assert.equal(s.registered.run.length, 1, 'the service starts with the app');
    for (const name of ['deviceready', 'resume', 'active', 'on.banner.load', 'on.banner.failed.load']) {
        s.calls.length = 0; s.tracking.state.status = 'unavailable';
        s.docHandlers[name]();
        assert.deepEqual(s.calls, [['emiAdmobPlugin', 'twAdPrivacyState', []]], name);
        assert.equal(s.tracking.state.status, 'denied', name);
    }
    s.calls.length = 0; s.rootHandlers['$ionicView.enter']();
    assert.deepEqual(s.calls, [['emiAdmobPlugin', 'twAdPrivacyState', []]]);
    const failed = service({status: 'error'});
    failed.docHandlers.deviceready();
    assert.equal(failed.tracking.state.status, 'unavailable');
    const unknown = service({status: 'new_status'});
    unknown.docHandlers.deviceready();
    assert.equal(unknown.tracking.state.status, 'unavailable');
});

// Codex C1-01: opening the side menu reads the status again, so a failed or stale read does not stick to the row.
test('opening the menu reads the status again after a failed read', () => {
    const s = service({status: 'error'});
    s.docHandlers.deviceready();
    assert.equal(s.tracking.state.status, 'unavailable');
    s.setStatus('authorized'); s.calls.length = 0;
    s.rootHandlers['$ionicSideMenuOpen']('left');
    assert.deepEqual(s.calls, [['emiAdmobPlugin', 'twAdPrivacyState', []]]);
    assert.deepEqual(overlay().visibility(s.tracking.state.status), {row: true, allowed: true, notice: false});
});

// Codex C1-02: the answer to the ATT prompt shows without a successful ad and without a page change.
test('after the ATT answer the status is read when the app becomes active or the banner fails', () => {
    for (const event of ['active', 'on.banner.failed.load']) {
        const s = service({status: 'not_determined'});
        s.docHandlers.deviceready();
        assert.deepEqual(overlay().visibility(s.tracking.state.status), {row: false, allowed: false, notice: false});
        s.setStatus('denied');
        s.docHandlers[event]();
        assert.deepEqual(overlay().visibility(s.tracking.state.status), {row: true, allowed: false, notice: true}, event);
    }
});

test('both elements open the app page in iOS Settings; a failure only logs one warning', () => {
    const ok = service();
    ok.tracking.openSettings();
    assert.deepEqual(ok.calls, ['switchToSettings']);
    assert.deepEqual(ok.warns, []);
    for (const settings of ['fail', 'missing']) {
        const s = service({settings});
        s.tracking.openSettings();
        assert.equal(s.warns.length, 1, settings);
        assert.deepEqual({...s.warns[0], cause: undefined},
            {component: 'privacy', operation: 'tracking_settings', cause: undefined, result: 'not_opened'});
    }
});

test('the row and the notice follow the status; the notice has no close control', () => {
    const s = service();
    const row = invoke(s.registered.directive.twTrackingRow, s.tracking);
    const notice = invoke(s.registered.directive.twTrackingNotice, s.tracking);
    assert.match(row.template, /^<button class="item button button-clear button-block[^"]*" ng-show="view\(\)\.row" ng-click="open\(\)">/);
    assert.match(row.template, /LOC_TRACKING_PERMISSION/);
    assert.match(notice.template, /ng-if="view\(\)\.notice"/);
    assert.match(notice.template, /LOC_TRACKING_NOTICE[\s\S]*LOC_TRACKING_OPEN_SETTINGS/);
    assert.doesNotMatch(notice.template, /close|dismiss|ion-close|hide/i);
    for (const def of [row, notice]) {
        const scope = {};
        def.link(scope);
        for (const status of STATUSES) {
            s.tracking.state.status = status;
            assert.deepEqual(scope.view(), overlay().visibility(status));
        }
        scope.open();
    }
    assert.deepEqual(s.calls.filter(c => c === 'switchToSettings').length, 2);
});

// A Cordova project whose platforms/ios/www is a copy of the real client/www files the hook edits.
function project(edit = () => {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-tracking-settings-'));
    const www = path.join(dir, 'platforms/ios/www');
    const files = ['index.html', ...PAGES.map(p => 'templates/' + p), ...LOCALES.map(l => `locales/${l}.json`)];
    for (const file of files) {
        fs.mkdirSync(path.dirname(path.join(www, file)), {recursive: true});
        fs.copyFileSync(path.join(root, 'www', file), path.join(www, file));
        fs.mkdirSync(path.dirname(path.join(dir, 'www', file)), {recursive: true});
        fs.copyFileSync(path.join(root, 'www', file), path.join(dir, 'www', file));
    }
    fs.cpSync(OVERLAY, path.join(dir, 'resources/ios/tracking-settings'), {recursive: true});
    edit({dir, www});
    return {dir, www, read: f => fs.readFileSync(path.join(www, f), 'utf8')};
}
const run = (dir, platforms = ['ios']) => hook()({opts: {projectRoot: dir, platforms}});
const snapshot = www => Object.fromEntries(fs.readdirSync(www, {recursive: true}).sort()
    .filter(f => fs.statSync(path.join(www, f)).isFile()).map(f => [f, fs.readFileSync(path.join(www, f), 'utf8')]));
const count = (text, part) => text.split(part).length - 1;

test('the hook adds the overlay to the real iOS www once, and a second run changes nothing', () => {
    const p = project();
    run(p.dir);
    const index = p.read('index.html');
    assert.equal(count(index, '<script src="tracking-settings/tracking-settings.js"></script>'), 1);
    assert.equal(count(index, '<link href="tracking-settings/tracking-settings.css" rel="stylesheet">'), 1);
    assert.ok(index.indexOf('tracking-settings.js') > index.indexOf('<script src="js/app.js"></script>'));
    assert.ok(index.indexOf('tracking-settings.js') < index.indexOf('</head>'));
    assert.match(index, /ng-click="openAdPrivacy\(\)">\s*\{\{'LOC_AD_PRIVACY_CHOICES'\|translate\}\}\s*<\/button>\s*<!-- TodayWeather tracking settings \(#2990\) begin -->\s*<tw-tracking-row><\/tw-tracking-row>/);
    assert.equal(count(index, '<tw-tracking-row>'), 1);
    for (const page of PAGES) {
        const html = p.read('templates/' + page);
        assert.equal(count(html, '<tw-tracking-notice></tw-tracking-notice>'), 1, page);
        assert.match(html, /<tw-tracking-notice><\/tw-tracking-notice>\s*<!-- TodayWeather tracking settings \(#2990\) end -->\s*<\/ion-content>\s*<\/ion-view>\s*$/, page);
    }
    const texts = strings();
    for (const locale of LOCALES) {
        const json = JSON.parse(p.read(`locales/${locale}.json`));
        const original = JSON.parse(fs.readFileSync(path.join(root, 'www/locales', locale + '.json'), 'utf8'));
        assert.deepEqual(json, {...original, ...texts[locale]}, locale);
    }
    for (const file of ['tracking-settings.js', 'tracking-settings.css']) {
        assert.equal(p.read('tracking-settings/' + file), fs.readFileSync(path.join(OVERLAY, file), 'utf8'));
    }
    const first = snapshot(p.www);
    run(p.dir);
    assert.deepEqual(snapshot(p.www), first);
});

test('the hook leaves Android and an absent iOS platform alone', () => {
    const p = project();
    const before = snapshot(p.www);
    run(p.dir, ['android']);
    assert.deepEqual(snapshot(p.www), before);
    const none = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-tracking-settings-none-'));
    run(none, ['ios']);
    assert.deepEqual(fs.readdirSync(none), []);
});

test('the hook stops the build with the file and cause when an insertion point or text is missing', () => {
    const cases = [
        ['index.html', 'no head end', ({www}) => replaceIn(www, 'index.html', '</head>', '')],
        ['index.html', 'no ad privacy row', ({www}) => replaceIn(www, 'index.html', 'ng-click="openAdPrivacy()"', 'ng-click="x()"')],
        ['index.html', 'two ad privacy rows', ({www}) => replaceIn(www, 'index.html', '</ion-side-menus>',
            '                <button class="item button button-clear button-block" ng-click="openAdPrivacy()">\n                    ' +
            "{{'LOC_AD_PRIVACY_CHOICES'|translate}}\n                </button>\n</ion-side-menus>")],
        ...PAGES.map(page => [page, 'no content end', ({www}) => replaceIn(www, 'templates/' + page, '</ion-content>', '</div>')]),
        ['ja.json', 'missing locale', ({www}) => fs.rmSync(path.join(www, 'locales/ja.json'))],
        ['strings.json', 'empty text', ({dir}) => {
            const file = path.join(dir, 'resources/ios/tracking-settings/strings.json');
            const texts = JSON.parse(fs.readFileSync(file, 'utf8')); texts.de.LOC_TRACKING_NOTICE = ' ';
            fs.writeFileSync(file, JSON.stringify(texts));
        }],
        ['zh-TW.json', 'key defined by client/www', ({dir}) => {
            const file = path.join(dir, 'www/locales/zh-TW.json');
            const json = JSON.parse(fs.readFileSync(file, 'utf8')); json.LOC_TRACKING_ALLOWED = 'x';
            fs.writeFileSync(file, JSON.stringify(json));
        }]
    ];
    for (const [file, label, edit] of cases) {
        const p = project(edit);
        assert.throws(() => run(p.dir), err => err.message.includes(file) && err.message.startsWith('iOS tracking settings'),
            label);
    }
});

function replaceIn(www, file, from, to) {
    const target = path.join(www, file);
    const text = fs.readFileSync(target, 'utf8');
    assert.ok(text.includes(from), `${file} fixture lost ${from}`);
    fs.writeFileSync(target, text.split(from).join(to));
}

test('config.xml runs the hook after prepare and client/www stays without the overlay', () => {
    const config = fs.readFileSync(path.join(root, 'config.xml'), 'utf8');
    assert.match(config, /<hook type="after_prepare" src="scripts\/ios-tracking-settings\.js" \/>/);
    for (const file of ['index.html', ...PAGES.map(p => 'templates/' + p)]) {
        assert.ok(!fs.readFileSync(path.join(root, 'www', file), 'utf8').includes('tw-tracking'), file);
    }
});
