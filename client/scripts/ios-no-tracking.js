// after_prepare: TodayWeather keeps AdMob without requesting ATT. emi3.0.4 has no
// JS npa/first-party-ID option, so enforce these settings in generated iOS code.
// Patch only the known request anchor and fail on drift; never edit installed/vendor sources.
const fs = require('node:fs');
const path = require('node:path');

module.exports = function(context) {
    if (!(context.opts.platforms || []).includes('ios')) return;
    const app = path.join(context.opts.projectRoot, 'platforms/ios/App');
    const file = path.join(app, 'App-Info.plist');
    if (!fs.existsSync(file)) return;
    const text = fs.readFileSync(file, 'utf8');
    const next = text.replace(/\s*<key>NSUserTrackingUsageDescription<\/key>\s*<string>[^<]*<\/string>/, '');
    const native = path.join(app, 'Plugins/emi-indo-cordova-plugin-admob/emiAdmobPlugin.m');
    let source = fs.readFileSync(native, 'utf8');
    const marker = '// TodayWeather privacy: nonpersonalized ads, no publisher first-party ID.';
    if (!source.includes(marker)) {
        const anchor = '    if (isEnabledKeyword && setKeyword.length > 0) {';
        if (source.split(anchor).length !== 2 || !source.includes('- (void)setAdRequest {')) {
            throw new Error('iOS privacy request anchor changed; review the AdMob plugin before building.');
        }
        const settings = `    ${marker}
    [GADMobileAds.sharedInstance.requestConfiguration setPublisherFirstPartyIDEnabled:NO];
    GADExtras *privacyExtras = [[GADExtras alloc] init];
    privacyExtras.additionalParameters = @{ @"npa" : @"1" };
    [self.globalRequest registerAdNetworkExtras:privacyExtras];

`;
        source = source.replace(anchor, settings + anchor);
        fs.writeFileSync(native, source);
    }
    // FirebaseX always links unused GTM, which pulls Analytics IdentitySupport back in.
    // Current app has no GTM container; retain Core Analytics without that indirect ad-ID path.
    const container = path.join(context.opts.projectRoot, 'resources/ios/container');
    if (fs.existsSync(container) && fs.readdirSync(container).length) {
        throw new Error('iOS privacy: a GTM container requires a separate tracking review.');
    }
    const pkg = path.join(context.opts.projectRoot, 'platforms/ios/packages/cordova-plugin-firebasex-analytics/Package.swift');
    if (fs.existsSync(pkg)) {
        let swift = fs.readFileSync(pkg, 'utf8');
        const gtm = '.product(name: "GoogleTagManager", package: "google-tag-manager-ios-sdk"),';
        const note = '// TodayWeather privacy: unused GTM removed to avoid indirect IdentitySupport.';
        if (!swift.includes('let analyticsSPMVariant = "core"') ||
            (!swift.includes(note) && swift.split(gtm).length !== 2)) {
            throw new Error('iOS privacy Analytics dependency anchor changed; review before building.');
        }
        if (!swift.includes(note)) fs.writeFileSync(pkg, swift.replace(gtm, note));
    }
    if (next !== text) fs.writeFileSync(file, next);
    console.info({component: 'privacy', operation: 'ios_prepare',
        action: 'enforce_nonpersonalized_requests', result: 'applied'});
};
