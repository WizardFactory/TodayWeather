const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function harness(store = new Map(), {absent = false, failConsent = false, deferEnable = false, storageFailure = false} = {}) {
    let factory, late;
    const events = [], calls = [], logs = [];
    const window = {console: {info: x => logs.push(x)}, localStorage: {
        getItem: k => store.get(k) ?? null,
        setItem(k,v) { if (storageFailure) throw Error('private storage data'); store.set(k,v); }
    }, FirebasexAnalytics: absent ? undefined : {
        setAnalyticsCollectionEnabled(value, done) { calls.push(['collection',value]); if (value && deferEnable) late = done; else done(); },
        setAnalyticsConsentMode(value, done, fail) { calls.push(['consent',JSON.parse(JSON.stringify(value))]); failConsent ? fail('private token') : done(); },
        logEvent(name, params) { events.push({name,params}); }
    }};
    vm.runInNewContext(fs.readFileSync(path.join(root,'www/js/service.monetization.js'),'utf8'), {
        angular: {module() { return {factory(n,fn) { factory=fn; }}; }},window, clientConfig: {releaseAds: true}
    });
    return {m:factory(window),window,calls,events,logs,store,completeEnable:()=>late()};
}
test('fresh install and malformed consent never collect or replay earlier events', () => {
    for (const value of [undefined, 'false', '1', 'broken']) {
        const h=harness(new Map(value===undefined?[]:[['twAnalyticsConsentV1',value]]));
        h.m.screen('start'); h.m.init(); h.m.track('favorite_change',{action:'add'});
        assert.equal(h.events.length,0); assert.equal(h.m.getCollectionChoice(),false);
        assert.equal(h.calls.some(c=>c[0]==='collection'&&c[1]===true),false);
        h.m.setCollectionEnabled(true); assert.equal(h.events.length,0);
    }
});
test('explicit consent enables only analytics storage, survives restart and keeps advertising denied', () => {
    const h=harness(); h.m.init(); h.m.setCollectionEnabled(true);
    assert.equal(h.m.getCollectionChoice(),true);
    const consent=h.calls.filter(c=>c[0]==='consent').at(-1)[1];
    assert.deepEqual(consent,{ANALYTICS_STORAGE:'GRANTED',AD_STORAGE:'DENIED',AD_USER_DATA:'DENIED',AD_PERSONALIZATION:'DENIED'});
    assert.ok(h.calls.findIndex(c=>c[0]==='consent'&&c[1].ANALYTICS_STORAGE==='GRANTED')<h.calls.findIndex(c=>c[0]==='collection'&&c[1]===true));
    h.m.track('favorite_change',{action:'add'}); assert.equal(h.events.length,1);
    const restart=harness(h.store); restart.m.init(); restart.m.track('favorite_change',{action:'remove'}); assert.equal(restart.events.length,1);
});
test('withdrawal is immediate, persists and ignores stale grant callbacks', () => {
    const h=harness(new Map(),{deferEnable:true}); h.m.init(); h.m.setCollectionEnabled(true);
    h.m.setCollectionEnabled(false); h.completeEnable();
    h.m.screen('start'); h.m.track('favorite_change',{action:'add'});
    assert.equal(h.events.length,0); assert.equal(h.m.getCollectionChoice(),false);
    const restart=harness(h.store); restart.m.init(); restart.m.screen('start'); assert.equal(restart.events.length,0);
});
test('missing SDK, denied consent bridge or failed local persistence cannot enable collection', () => {
    for (const options of [{absent:true},{failConsent:true},{storageFailure:true}]) {
        const h=harness(new Map(),options); h.m.init(); h.m.setCollectionEnabled(true);
        h.m.track('favorite_change',{action:'add'}); assert.equal(h.events.length,0);
        assert.doesNotMatch(JSON.stringify(h.logs),/private|token/);
    }
});
test('native install defaults deny collection and advertising, with iOS Analytics identity support removed', () => {
    const p=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).cordova.plugins['cordova-plugin-firebasex-analytics'];
    for (const key of ['FIREBASE_ANALYTICS_COLLECTION_ENABLED','GOOGLE_ANALYTICS_ADID_COLLECTION_ENABLED',
        'GOOGLE_ANALYTICS_DEFAULT_ALLOW_ANALYTICS_STORAGE','GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_STORAGE',
        'GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_USER_DATA','GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_PERSONALIZATION_SIGNALS']) assert.equal(p[key],'false',key);
    assert.equal(p.FIREBASE_ANALYTICS_WITHOUT_ADS,'true');
});

test('iOS preparation enforces nonpersonalized requests and fails on unsupported plugin drift', () => {
    const os=require('node:os'); const hook=require('../scripts/ios-no-tracking.js');
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tw-privacy-hook-'));
    try {
        const app=path.join(dir,'platforms/ios/App'); fs.mkdirSync(path.join(app,'Plugins/emi-indo-cordova-plugin-admob'),{recursive:true});
        const plist=path.join(app,'App-Info.plist'), native=path.join(app,'Plugins/emi-indo-cordova-plugin-admob/emiAdmobPlugin.m');
        fs.writeFileSync(plist,'<plist><dict><key>NSUserTrackingUsageDescription</key><string>Tracking</string></dict></plist>');
        fs.writeFileSync(native,'- (void)setAdRequest {\n    if (isUsingAdManagerRequest) {\n        self.globalRequest = [GAMRequest request];\n    } else {\n        self.globalRequest = [GADRequest request];\n    }\n\n    if (isEnabledKeyword && setKeyword.length > 0) {\n    }\n}');
        const pkg=path.join(dir,'platforms/ios/packages/cordova-plugin-firebasex-analytics/Package.swift');
        fs.mkdirSync(path.dirname(pkg),{recursive:true});
        fs.writeFileSync(pkg,'let analyticsSPMVariant = "core"\n.product(name: "GoogleTagManager", package: "google-tag-manager-ios-sdk"),');
        hook({opts:{platforms:['ios'],projectRoot:dir}});
        assert.doesNotMatch(fs.readFileSync(pkg,'utf8'),/\.product\(name: "GoogleTagManager"/);
        const first=fs.readFileSync(native,'utf8');
        assert.match(first,/setPublisherFirstPartyIDEnabled:NO/); assert.match(first,/@"npa"\s*:\s*@"1"/);
        assert.doesNotMatch(fs.readFileSync(plist,'utf8'),/NSUserTrackingUsageDescription/);
        hook({opts:{platforms:['ios'],projectRoot:dir}}); assert.equal(fs.readFileSync(native,'utf8'),first);
        fs.writeFileSync(native,'unknown updated plugin'); assert.throws(()=>hook({opts:{platforms:['ios'],projectRoot:dir}}),/privacy.*anchor/i);
    } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('iOS collection and consent defaults are explicit even when plugin installation ignores them', () => {
    const xml=fs.readFileSync(path.join(root,'config.xml'),'utf8');
    for (const key of ['FIREBASE_ANALYTICS_COLLECTION_ENABLED','GOOGLE_ANALYTICS_DEFAULT_ALLOW_ANALYTICS_STORAGE',
        'GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_STORAGE','GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_USER_DATA','GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_PERSONALIZATION_SIGNALS']) {
        assert.ok(xml.includes('target="'+key+'">\n            <false />'),key);
    }
});

test('only post-consent latest screen is delivered when native collection finishes', () => {
    const h=harness(new Map(),{deferEnable:true});
    h.m.screen('start'); h.m.init(); h.m.setCollectionEnabled(true);
    h.m.screen('tab.forecast'); h.m.screen('tab.air');
    assert.equal(h.events.length,0);
    h.completeEnable();
    assert.deepEqual(h.events.map(e=>e.params.screen_name),['tab.air']);
});
