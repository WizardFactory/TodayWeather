// App Review (#2855) rejected the plugin's default "constant access ... track your position" text.
// cordova.plugins.diagnostic adds every location purpose key to App-Info.plist with placeholder text;
// config.xml must override each one with an accurate, foreground-only TodayWeather description.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const KEYS = ['NSLocationWhenInUseUsageDescription', 'NSLocationAlwaysAndWhenInUseUsageDescription',
    'NSLocationAlwaysUsageDescription'];

function iosOverrides() {
    const config = fs.readFileSync(path.join(root, 'config.xml'), 'utf8');
    const ios = config.match(/<platform name="ios">([\s\S]*?)<\/platform>/);
    assert.ok(ios, 'config.xml has an iOS platform block');
    const found = new Map();
    const edit = /<edit-config file="\*-Info\.plist" mode="merge" target="([^"]+)">\s*<string>([^<]*)<\/string>\s*<\/edit-config>/g;
    for (const [, key, text] of ios[1].matchAll(edit)) found.set(key, text.trim());
    return found;
}

test('every iOS location purpose string is overridden with accurate foreground-only text', () => {
    const found = iosOverrides();
    for (const key of KEYS) {
        const text = found.get(key);
        assert.ok(text, `${key} is overridden in the iOS platform block`);
        assert.doesNotMatch(text, /This app requires/, `${key} is not the plugin placeholder`);
        assert.match(text, /TodayWeather/, `${key} names the app`);
        assert.match(text, /weather/i, `${key} states the weather purpose`);
        assert.match(text, /for example/i, `${key} gives a concrete example`);
        assert.match(text, /only while you use the app/, `${key} states foreground-only use`);
        assert.doesNotMatch(text, /track|background|constant|always/i, `${key} claims no background tracking`);
    }
});

test('overrides cover every location key the installed diagnostic plugin injects', (t) => {
    const plugin = path.join(root, 'node_modules/cordova.plugins.diagnostic/plugin.xml');
    if (!fs.existsSync(plugin)) return t.skip('cordova.plugins.diagnostic is not installed');
    const injected = [...fs.readFileSync(plugin, 'utf8')
        .matchAll(/<config-file target="\*-Info\.plist" parent="(NSLocation\w*UsageDescription)"/g)].map(m => m[1]);
    assert.ok(injected.length > 0, 'plugin still declares location purpose keys');
    const found = iosOverrides();
    for (const key of injected) assert.ok(found.has(key), `${key} injected by the plugin is overridden`);
});
