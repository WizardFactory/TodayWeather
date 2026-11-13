// after_prepare (iOS): TodayWeather asks for App Tracking Transparency through UMP (#2945, decided in #2660).
// emi 3.0.4 has no JS option for npa or the publisher first-party ID, so the request rule is applied in the generated
// plugin source. Patch only known anchors and fail on drift; never edit installed/vendor sources.
// Firebase Analytics stays without IDFA: the Core variant and the GTM removal below are unchanged.
const fs = require('node:fs');
const path = require('node:path');

// Every App Store locale (client/fastlane/metadata/ios) needs its own purpose string.
const LOCALES = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant'];
const KEY = 'NSUserTrackingUsageDescription';
const BEGIN = '// TodayWeather privacy (#2945) begin: ';
const END = '// TodayWeather privacy (#2945) end\n\n';
const INJECTED = /^[ \t]*\/\/ TodayWeather privacy \(#2945\) begin: [^\n]*\n[\s\S]*?^[ \t]*\/\/ TodayWeather privacy \(#2945\) end\n\n/gm;
const REQUEST_ANCHOR = '    if (isEnabledKeyword && setKeyword.length > 0) {';
const CLASS_ANCHOR = '@implementation emiAdmobPlugin\n';
const ACTION_ANCHOR = '- (void)requestIDFA:(CDVInvokedUrlCommand *)reqCommand {';
// The block ios-no-tracking.js (1.1.x) injected; a platform directory prepared by it still holds this text.
const LEGACY_MARKER = '// TodayWeather privacy: nonpersonalized ads, no publisher first-party ID.';
const LEGACY_BLOCK = `    ${LEGACY_MARKER}
    [GADMobileAds.sharedInstance.requestConfiguration setPublisherFirstPartyIDEnabled:NO];
    GADExtras *privacyExtras = [[GADExtras alloc] init];
    privacyExtras.additionalParameters = @{ @"npa" : @"1" };
    [self.globalRequest registerAdNetworkExtras:privacyExtras];

`;
const STATE = `static long TWTrackingStatus(void) {
    if (@available(iOS 14, *)) {
        return (long)ATTrackingManager.trackingAuthorizationStatus;
    }
    return TW_ATT_UNAVAILABLE;
}
static BOOL TWAdRequestPersonalized(void) {
    NSUserDefaults *prefs = [NSUserDefaults standardUserDefaults];
    return tw_ad_request_personalized(TWTrackingStatus(), (int)[prefs integerForKey:@"IABTCF_gdprApplies"],
        [[prefs stringForKey:@"IABTCF_PurposeConsents"] UTF8String]) ? YES : NO;
}
`;
const REQUEST = `    ${BEGIN}personalized only with ATT permission and stored consent
    BOOL twPersonalized = TWAdRequestPersonalized();
    [GADMobileAds.sharedInstance.requestConfiguration setPublisherFirstPartyIDEnabled:twPersonalized];
    if (!twPersonalized) {
        GADExtras *privacyExtras = [[GADExtras alloc] init];
        privacyExtras.additionalParameters = @{ @"npa" : @"1" };
        [self.globalRequest registerAdNetworkExtras:privacyExtras];
    }
    ${END}`;
const ACTION = `${BEGIN}read-only state for logs and measurement; never prompts
- (void)twAdPrivacyState:(CDVInvokedUrlCommand *)command {
    NSDictionary *state = @{
        @"att_status" : [NSString stringWithUTF8String:tw_att_status_name(TWTrackingStatus())],
        @"personalized" : @(TWAdRequestPersonalized())
    };
    CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:state];
    [self.commandDelegate sendPluginResult:result callbackId:command.callbackId];
}
${END}`;

function once(source, text) { return source.split(text).length === 2; }

// Returns the plugin source with the current rule, or throws when the plugin no longer matches the reviewed 3.0.4 shape.
function applyRule(original, rule) {
    const drift = new Error('iOS privacy request anchor changed; review the AdMob plugin before building.');
    // Drop what an earlier prepare injected, so a changed rule replaces the old one.
    let source = original.replace(INJECTED, '');
    if (source.includes('TodayWeather privacy (#2945)')) throw drift;
    if (source.includes(LEGACY_MARKER)) {
        if (!once(source, LEGACY_BLOCK)) throw drift;
        source = source.replace(LEGACY_BLOCK, '');
    }
    if (!once(source, REQUEST_ANCHOR) || !once(source, CLASS_ANCHOR) || !once(source, ACTION_ANCHOR) ||
        !once(source, '- (void)setAdRequest {') || !source.includes('#import <AppTrackingTransparency/AppTrackingTransparency.h>') ||
        source.indexOf('- (void)setAdRequest {') > source.indexOf(REQUEST_ANCHOR)) {
        throw drift;
    }
    return source
        .replace(CLASS_ANCHOR, `${BEGIN}request rule\n${rule}${STATE}${END}${CLASS_ANCHOR}`)
        .replace(REQUEST_ANCHOR, REQUEST + REQUEST_ANCHOR)
        .replace(ACTION_ANCHOR, ACTION + ACTION_ANCHOR);
}

function purposeText(file, locale, place) {
    const text = fs.existsSync(file) &&
        (fs.readFileSync(file, 'utf8').match(/^"NSUserTrackingUsageDescription"\s*=\s*"([^"\\]+)";$/m) || [])[1];
    if (!text || !text.trim()) {
        throw new Error(`iOS privacy: ${KEY} is missing or empty for ${locale} in the ${place} (${file}).`);
    }
    return text;
}

module.exports = function(context) {
    if (!(context.opts.platforms || []).includes('ios')) return;
    const root = context.opts.projectRoot;
    const app = path.join(root, 'platforms/ios/App');
    const file = path.join(app, 'App-Info.plist');
    if (!fs.existsSync(file)) return;

    // Purpose strings: config.xml adds resources/ios/tracking/<locale>.lproj to the Xcode project as a bundle folder.
    // A missing string fails the build, because iOS then shows the prompt without the reason in that language.
    // cordova prepare copies a folder only when it is new, so the copies are refreshed here from their sources.
    const project = path.join(root, 'platforms/ios/App.xcodeproj/project.pbxproj');
    const bundled = fs.existsSync(project) ? fs.readFileSync(project, 'utf8') : '';
    const copies = [];
    for (const locale of LOCALES) {
        const name = `${locale}.lproj/InfoPlist.strings`;
        const from = path.join(root, 'resources/ios/tracking', name);
        purposeText(from, locale, 'source');
        if (!bundled.includes(`/* ${locale}.lproj in Resources */`)) {
            throw new Error(`iOS privacy: ${KEY} for ${locale} is not bundled; config.xml needs its resource-file entry.`);
        }
        copies.push([from, path.join(app, 'Resources', name)]);
    }
    const text = fs.readFileSync(file, 'utf8');
    const entry = /(<key>NSUserTrackingUsageDescription<\/key>\s*<string>)[^<]*(<\/string>)/;
    if (!entry.test(text)) {
        throw new Error(`iOS privacy: App-Info.plist has no ${KEY}; the ATT prompt needs it. Review the AdMob plugin.`);
    }
    const english = purposeText(copies[LOCALES.indexOf('en')][0], 'en', 'source').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const next = text.replace(entry, (match, open, close) => open + english + close);

    const native = path.join(app, 'Plugins/emi-indo-cordova-plugin-admob/emiAdmobPlugin.m');
    const source = fs.readFileSync(native, 'utf8');
    const patched = applyRule(source, fs.readFileSync(path.join(__dirname, 'ios-ad-request-rule.h'), 'utf8'));

    // FirebaseX always links unused GTM, which pulls Analytics IdentitySupport back in.
    // Current app has no GTM container; retain Core Analytics without that indirect ad-ID path.
    const container = path.join(root, 'resources/ios/container');
    if (fs.existsSync(container) && fs.readdirSync(container).length) {
        throw new Error('iOS privacy: a GTM container requires a separate tracking review.');
    }
    const pkg = path.join(root, 'platforms/ios/packages/cordova-plugin-firebasex-analytics/Package.swift');
    let swift;
    if (fs.existsSync(pkg)) {
        swift = fs.readFileSync(pkg, 'utf8');
        const gtm = '.product(name: "GoogleTagManager", package: "google-tag-manager-ios-sdk"),';
        const note = '// TodayWeather privacy: unused GTM removed to avoid indirect IdentitySupport.';
        if (!swift.includes('let analyticsSPMVariant = "core"') ||
            (!swift.includes(note) && swift.split(gtm).length !== 2)) {
            throw new Error('iOS privacy Analytics dependency anchor changed; review before building.');
        }
        swift = swift.includes(note) ? undefined : swift.replace(gtm, note);
    }

    // Every guard passed: write.
    for (const [from, to] of copies) {
        const content = fs.readFileSync(from);
        if (!fs.existsSync(to) || !content.equals(fs.readFileSync(to))) {
            fs.mkdirSync(path.dirname(to), {recursive: true});
            fs.writeFileSync(to, content);
        }
    }
    if (patched !== source) fs.writeFileSync(native, patched);
    if (swift !== undefined) fs.writeFileSync(pkg, swift);
    if (next !== text) fs.writeFileSync(file, next);
    console.info({component: 'privacy', operation: 'ios_prepare',
        action: 'apply_tracking_rule', result: 'applied'});
};
