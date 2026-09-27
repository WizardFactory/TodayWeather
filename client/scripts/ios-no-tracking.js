// Cordova after_prepare hook: remove NSUserTrackingUsageDescription, which emi-indo-cordova-plugin-admob always
// adds to the iOS Info.plist. TodayWeather does not ask for App Tracking Transparency (the legacy app never did),
// and a usage description without the prompt is a common App Review rejection. To ask later, call the plugin's
// requestIDFA and drop this hook.
const fs = require('node:fs');
const path = require('node:path');

module.exports = function (context) {
    if (!(context.opts.platforms || []).includes('ios')) return;
    const file = path.join(context.opts.projectRoot, 'platforms/ios/App/App-Info.plist');
    if (!fs.existsSync(file)) return;
    const text = fs.readFileSync(file, 'utf8');
    const next = text.replace(/\s*<key>NSUserTrackingUsageDescription<\/key>\s*<string>[^<]*<\/string>/, '');
    if (next !== text) {
        fs.writeFileSync(file, next);
        console.log('ios-no-tracking: removed NSUserTrackingUsageDescription');
    }
};
