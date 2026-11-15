// iOS App Tracking Transparency (#2945): the request rule, the after_prepare hook that applies it to the generated
// AdMob plugin source, and the purpose strings every shipped locale must carry.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const LOCALES = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const KEY = 'NSUserTrackingUsageDescription';
const PLUGIN_DEFAULT = 'This identifier will be used to deliver personalized ads to you.';
const source = locale => path.join(root, 'resources/ios/tracking', locale + '.lproj/InfoPlist.strings');
const purpose = locale => (fs.readFileSync(source(locale), 'utf8').match(/^"NSUserTrackingUsageDescription"\s*=\s*"([^"\\]+)";$/m) || [])[1];

// The lines of emi-indo-cordova-plugin-admob 3.0.4 emiAdmobPlugin.m that the hook depends on.
const PLUGIN = `#import "emiAdmobPlugin.h"
#import <AppTrackingTransparency/AppTrackingTransparency.h>

@implementation emiAdmobPlugin

- (void)setAdRequest {
    if (isUsingAdManagerRequest) {
        self.globalRequest = [GAMRequest request];
    } else {
        self.globalRequest = [GADRequest request];
    }

    if (isEnabledKeyword && setKeyword.length > 0) {
    }
}

- (void)requestIDFA:(CDVInvokedUrlCommand *)reqCommand {
    [ATTrackingManager requestTrackingAuthorizationWithCompletionHandler:^(ATTrackingManagerAuthorizationStatus status) {}];
}

@end
`;
// What the 1.1.x hook (ios-no-tracking.js) left in a platform directory that is prepared again.
const LEGACY_BLOCK = `    // TodayWeather privacy: nonpersonalized ads, no publisher first-party ID.
    [GADMobileAds.sharedInstance.requestConfiguration setPublisherFirstPartyIDEnabled:NO];
    GADExtras *privacyExtras = [[GADExtras alloc] init];
    privacyExtras.additionalParameters = @{ @"npa" : @"1" };
    [self.globalRequest registerAdNetworkExtras:privacyExtras];

`;

function project({plugin = PLUGIN, plist = `<plist><dict><key>${KEY}</key><string>${PLUGIN_DEFAULT}</string></dict></plist>`} = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-ad-privacy-'));
    const app = path.join(dir, 'platforms/ios/App');
    const paths = {
        dir, plist: path.join(app, 'App-Info.plist'),
        native: path.join(app, 'Plugins/emi-indo-cordova-plugin-admob/emiAdmobPlugin.m'),
        pkg: path.join(dir, 'platforms/ios/packages/cordova-plugin-firebasex-analytics/Package.swift'),
        source: locale => path.join(dir, 'resources/ios/tracking', locale + '.lproj/InfoPlist.strings'),
        bundled: locale => path.join(app, 'Resources', locale + '.lproj/InfoPlist.strings'),
        project: path.join(dir, 'platforms/ios/App.xcodeproj/project.pbxproj')
    };
    for (const file of [paths.native, paths.pkg, paths.project]) fs.mkdirSync(path.dirname(file), {recursive: true});
    // cordova-ios writes one such build-file line for every <resource-file> folder of config.xml.
    fs.writeFileSync(paths.project, LOCALES.map(l => `\t\tAA /* ${l}.lproj in Resources */ = {isa = PBXBuildFile; };\n`).join(''));
    fs.writeFileSync(paths.plist, plist);
    fs.writeFileSync(paths.native, plugin);
    fs.writeFileSync(paths.pkg, 'let analyticsSPMVariant = "core"\n.product(name: "GoogleTagManager", package: "google-tag-manager-ios-sdk"),');
    for (const locale of LOCALES) {
        for (const target of [paths.source(locale), paths.bundled(locale)]) {
            fs.mkdirSync(path.dirname(target), {recursive: true});
            fs.copyFileSync(source(locale), target);
        }
    }
    return paths;
}
function prepare(paths) {
    require('../scripts/ios-ad-privacy.js')({opts: {platforms: ['ios'], projectRoot: paths.dir}});
}
function withProject(options, body) {
    const paths = project(options);
    try { body(paths); } finally { fs.rmSync(paths.dir, {recursive: true, force: true}); }
}

test('request rule: personalized only when ATT is authorized and stored consent allows it', () => {
    // [ATT status, IABTCF_gdprApplies, IABTCF_PurposeConsents or null, expected personalized, expected status name]
    const cases = [
        [0, 0, null, 0, 'not_determined'], [1, 0, null, 0, 'restricted'], [2, 0, null, 0, 'denied'],
        [3, 0, null, 1, 'authorized'], [-1, 0, null, 0, 'unavailable'], [4, 0, null, 0, 'unavailable'],
        [99, 0, '1111', 0, 'unavailable'],
        // GDPR applies: purposes 1, 3 and 4 must all be consented; purpose 2 does not decide personalization.
        [3, 1, '1111', 1, 'authorized'], [3, 1, '1011', 1, 'authorized'], [3, 1, '10110000000', 1, 'authorized'],
        [3, 1, '0111', 0, 'authorized'], [3, 1, '1101', 0, 'authorized'], [3, 1, '1110', 0, 'authorized'],
        [3, 1, '', 0, 'authorized'], [3, 1, null, 0, 'authorized'], [3, 1, '101', 0, 'authorized'],
        // Consent never replaces the ATT permission.
        [0, 1, '1111', 0, 'not_determined'], [1, 1, '1111', 0, 'restricted'], [2, 1, '1111', 0, 'denied'],
        [2, 0, '1111', 0, 'denied']
    ];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-ad-rule-'));
    try {
        const rows = cases.map(([att, gdpr, purposes]) =>
            `    row(${att}L, ${gdpr}, ${purposes === null ? 'NULL' : JSON.stringify(purposes)});`).join('\n');
        fs.writeFileSync(path.join(dir, 'rule.c'), `#include <stdio.h>
#include ${JSON.stringify(path.join(root, 'scripts/ios-ad-request-rule.h'))}
static void row(long att, int gdpr, const char *purposes) {
    printf("%d %s\\n", tw_ad_request_personalized(att, gdpr, purposes), tw_att_status_name(att));
}
int main(void) {
${rows}
    return 0;
}
`);
        const binary = path.join(dir, 'rule');
        execFileSync('cc', ['-std=c99', '-Wall', '-Werror', '-o', binary, path.join(dir, 'rule.c')], {stdio: 'pipe'});
        const lines = execFileSync(binary, {encoding: 'utf8'}).trim().split('\n');
        assert.equal(lines.length, cases.length);
        cases.forEach(([att, gdpr, purposes, personalized, name], i) =>
            assert.equal(lines[i], `${personalized} ${name}`, `ATT ${att}, gdprApplies ${gdpr}, purposes ${purposes}`));
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('iOS preparation applies the rule to every request and keeps the app from prompting', () => {
    withProject({}, paths => {
        prepare(paths);
        const native = fs.readFileSync(paths.native, 'utf8');
        const rule = fs.readFileSync(path.join(root, 'scripts/ios-ad-request-rule.h'), 'utf8');
        assert.ok(native.includes(rule), 'the tested rule source is the generated rule source');
        assert.ok(native.indexOf(rule) < native.indexOf('@implementation emiAdmobPlugin'));
        const request = native.slice(native.indexOf('- (void)setAdRequest {'), native.indexOf('- (void)twAdPrivacyState:'));
        assert.match(request, /BOOL twPersonalized = TWAdRequestPersonalized\(\);/);
        assert.match(request, /setPublisherFirstPartyIDEnabled:twPersonalized\]/);
        assert.match(request, /if \(!twPersonalized\) \{\n +GADExtras \*privacyExtras = \[\[GADExtras alloc\] init\];\n +privacyExtras\.additionalParameters = @\{ @"npa" : @"1" \};\n +\[self\.globalRequest registerAdNetworkExtras:privacyExtras\];\n +\}\n/);
        assert.doesNotMatch(native, /setPublisherFirstPartyIDEnabled:(NO|YES)/);
        assert.ok(request.indexOf('twPersonalized') > request.indexOf('[GADRequest request]'), 'after the request exists');
        // The live status is read; the only ATT request in the file is the plugin's own unused requestIDFA.
        assert.match(native, /ATTrackingManager\.trackingAuthorizationStatus/);
        assert.equal(native.split('requestTrackingAuthorization').length, PLUGIN.split('requestTrackingAuthorization').length);
        assert.match(native, /- \(void\)twAdPrivacyState:\(CDVInvokedUrlCommand \*\)command \{[\s\S]*@"att_status"[\s\S]*@"personalized"/);
        assert.doesNotMatch(fs.readFileSync(paths.pkg, 'utf8'), /\.product\(name: "GoogleTagManager"/);
        prepare(paths);
        assert.equal(fs.readFileSync(paths.native, 'utf8'), native, 'a second prepare changes nothing');
    });
});

test('iOS preparation replaces the unconditional npa block left by the 1.1.x hook', () => {
    const anchor = '    if (isEnabledKeyword && setKeyword.length > 0) {';
    withProject({plugin: PLUGIN.replace(anchor, LEGACY_BLOCK + anchor)}, paths => {
        prepare(paths);
        const native = fs.readFileSync(paths.native, 'utf8');
        assert.doesNotMatch(native, /setPublisherFirstPartyIDEnabled:NO/);
        assert.equal(native.split('@"npa" : @"1"').length, 2, 'one conditional npa only');
        withProject({}, fresh => { prepare(fresh); assert.equal(native, fs.readFileSync(fresh.native, 'utf8')); });
    });
    // A legacy marker around changed code is not patched blindly.
    withProject({plugin: PLUGIN.replace(anchor, LEGACY_BLOCK.replace('@"1"', '@"0"') + anchor)}, paths => {
        assert.throws(() => prepare(paths), /privacy.*anchor/i);
    });
});

test('iOS preparation fails on plugin, Analytics package or GTM drift', () => {
    const drifted = [
        'unknown updated plugin',
        PLUGIN.replace('    if (isEnabledKeyword && setKeyword.length > 0) {', '    if (isEnabledKeyword) {'),
        PLUGIN.replace('- (void)setAdRequest {', '- (void)buildAdRequest {'),
        PLUGIN.replace('@implementation emiAdmobPlugin', '@implementation emiAdmobPluginNext'),
        PLUGIN.replace('- (void)requestIDFA:(CDVInvokedUrlCommand *)reqCommand {', '- (void)requestTracking:(CDVInvokedUrlCommand *)c {'),
        PLUGIN.replace('#import <AppTrackingTransparency/AppTrackingTransparency.h>\n', '')
    ];
    for (const plugin of drifted) {
        withProject({plugin}, paths => {
            assert.throws(() => prepare(paths), /privacy.*anchor/i);
            assert.equal(fs.readFileSync(paths.native, 'utf8'), plugin, 'a rejected source is left untouched');
        });
    }
    withProject({}, paths => {
        fs.writeFileSync(paths.pkg, 'let analyticsSPMVariant = "full"\n');
        assert.throws(() => prepare(paths), /Analytics dependency anchor/);
    });
    withProject({}, paths => {
        fs.mkdirSync(path.join(paths.dir, 'resources/ios/container'), {recursive: true});
        fs.writeFileSync(path.join(paths.dir, 'resources/ios/container/GTM-FIXTURE.json'), '{}');
        assert.throws(() => prepare(paths), /GTM container/);
    });
});

test('iOS preparation writes the English purpose string and fails when any shipped locale lacks one', () => {
    withProject({}, paths => {
        prepare(paths);
        const plist = fs.readFileSync(paths.plist, 'utf8');
        assert.ok(plist.includes(`<key>${KEY}</key><string>${purpose('en')}</string>`));
        assert.doesNotMatch(plist, new RegExp(PLUGIN_DEFAULT));
    });
    // The plugin stopped declaring the key: App Review needs it, so the build stops.
    withProject({plist: '<plist><dict></dict></plist>'}, paths => {
        assert.throws(() => prepare(paths), new RegExp(KEY));
    });
    for (const locale of LOCALES) {
        for (const breakIt of [
            p => fs.rmSync(p.source(locale)),
            p => fs.writeFileSync(p.source(locale), `"${KEY}" = "";\n`),
            p => fs.writeFileSync(p.source(locale), '"CFBundleDisplayName" = "TodayWeather";\n'),
            // The folder is not part of the Xcode project: config.xml lost its <resource-file> entry.
            p => fs.writeFileSync(p.project, fs.readFileSync(p.project, 'utf8').replace(`/* ${locale}.lproj in Resources */`, ''))
        ]) {
            withProject({}, paths => {
                breakIt(paths);
                const before = fs.readFileSync(paths.native, 'utf8');
                assert.throws(() => prepare(paths), new RegExp(`${KEY}.*\\b${locale}\\b`), locale);
                assert.equal(fs.readFileSync(paths.native, 'utf8'), before, 'nothing is written when a guard fails');
            });
        }
    }
});

test('iOS preparation refreshes bundled purpose strings that cordova prepare leaves stale', () => {
    // cordova prepare copies a <resource-file> folder only when the target is new; an edited string would not ship.
    withProject({}, paths => {
        fs.writeFileSync(paths.bundled('ko'), `"${KEY}" = "stale text";\n`);
        fs.rmSync(paths.bundled('ja'));
        prepare(paths);
        for (const locale of LOCALES) {
            assert.equal(fs.readFileSync(paths.bundled(locale), 'utf8'), fs.readFileSync(source(locale), 'utf8'), locale);
        }
    });
});

test('other platforms are left alone', () => {
    withProject({}, paths => {
        require('../scripts/ios-ad-privacy.js')({opts: {platforms: ['android'], projectRoot: paths.dir}});
        assert.equal(fs.readFileSync(paths.native, 'utf8'), PLUGIN);
    });
});

test('every shipped locale states the actual use of the advertising identifier', () => {
    const words = {
        en: [/personalized ads/, /measure/, /not allow/], ko: [/맞춤 광고/, /측정/, /허용하지 않/],
        ja: [/パーソナライズ/, /広告/, /測定/, /許可しない/], 'zh-Hans': [/个性化广告/, /衡量/, /不允许/],
        'zh-Hant': [/個人化廣告/, /衡量/, /不允許/]
    };
    assert.deepEqual(fs.readdirSync(path.join(root, 'resources/ios/tracking')).sort(), LOCALES.map(l => l + '.lproj').sort());
    for (const locale of LOCALES) {
        const text = purpose(locale);
        assert.ok(text, `${locale} has a one-line ${KEY}`);
        assert.notEqual(text, PLUGIN_DEFAULT);
        assert.match(text, /TodayWeather/, `${locale} names the app`);
        for (const word of words[locale]) assert.match(text, word, `${locale} ${word}`);
    }
});

test('config.xml runs the hook and bundles every locale folder', () => {
    const config = fs.readFileSync(path.join(root, 'config.xml'), 'utf8');
    assert.match(config, /<hook type="after_prepare" src="scripts\/ios-ad-privacy\.js" \/>/);
    assert.doesNotMatch(config, /ios-no-tracking/);
    const ios = config.match(/<platform name="ios">([\s\S]*?)<\/platform>/)[1];
    for (const locale of LOCALES) {
        assert.ok(ios.includes(`<resource-file src="resources/ios/tracking/${locale}.lproj" target="${locale}.lproj" />`), locale);
    }
});
