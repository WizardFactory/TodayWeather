// after_prepare (iOS): adds the tracking-permission menu row and the page notice of #2990 to platforms/ios/www.
// The feature exists only in the iOS bundle: client/www, which the Android parity references hash, stays unchanged
// (android/tools/emulator/check-sources.mjs). Each insertion uses one exact anchor and fails the build on drift.
// cordova prepare copies a www file again only when its source is newer, so an earlier insertion (between the markers)
// is replaced instead of added twice.
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = 'resources/ios/tracking-settings';
const COPIES = ['tracking-settings.js', 'tracking-settings.css'];
const LOCALES = ['ko', 'en', 'ja', 'zh-CN', 'zh-TW', 'de'];
const KEYS = ['LOC_TRACKING_PERMISSION', 'LOC_TRACKING_ALLOWED', 'LOC_TRACKING_NOT_ALLOWED', 'LOC_TRACKING_NOTICE',
    'LOC_TRACKING_OPEN_SETTINGS'];
const BEGIN = '<!-- TodayWeather tracking settings (#2990) begin -->';
const END = '<!-- TodayWeather tracking settings (#2990) end -->';
const INSERTED = /[ \t]*<!-- TodayWeather tracking settings \(#2990\) begin -->[\s\S]*?<!-- TodayWeather tracking settings \(#2990\) end -->\n/g;
const AD_PRIVACY_ROW = `                <button class="item button button-clear button-block" ng-click="openAdPrivacy()">
                    {{'LOC_AD_PRIVACY_CHOICES'|translate}}
                </button>
`;
const EDITS = [
    {file: 'index.html', anchor: '</head>', where: 'before',
        block: `    ${BEGIN}
    <link href="tracking-settings/tracking-settings.css" rel="stylesheet">
    <script src="tracking-settings/tracking-settings.js"></script>
    ${END}
`},
    {file: 'index.html', anchor: AD_PRIVACY_ROW, where: 'after',
        block: `                ${BEGIN}
                <tw-tracking-row></tw-tracking-row>
                ${END}
`},
    ...['tab-forecast.html', 'tab-dailyforecast.html', 'tab-air.html'].map((page) => ({
        file: `templates/${page}`, anchor: '    </ion-content>\n</ion-view>', where: 'before',
        block: `        ${BEGIN}
        <tw-tracking-notice></tw-tracking-notice>
        ${END}
`}))
];

function fail(message) {
    throw new Error(`iOS tracking settings (#2990): ${message}`);
}

function readJson(file, what) {
    if (!fs.existsSync(file)) fail(`${what} ${path.basename(file)} is missing (${file}).`);
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        fail(`${what} ${path.basename(file)} is not valid JSON (${e.message}).`);
    }
}

/** Removes an earlier insertion, then inserts each block of [file] at its single anchor. */
function patch(text, file, edits) {
    let next = text.replace(INSERTED, '');
    for (const edit of edits) {
        const at = next.split(edit.anchor).length - 1;
        if (at !== 1) {
            fail(`${file} has ${at} copies of the insertion point ${JSON.stringify(edit.anchor.trim().slice(0, 60))}; ` +
                'review the template change before building.');
        }
        next = next.replace(edit.anchor, edit.where === 'before' ? edit.block + edit.anchor : edit.anchor + edit.block);
    }
    return next;
}

module.exports = function(context) {
    if (!(context.opts.platforms || []).includes('ios')) return;
    const root = context.opts.projectRoot;
    const www = path.join(root, 'platforms/ios/www');
    if (!fs.existsSync(www)) return;

    // Check every input before changing a file.
    const texts = readJson(path.join(root, SOURCE, 'strings.json'), 'texts');
    const locales = {};
    for (const locale of LOCALES) {
        const own = texts[locale] || {};
        for (const key of KEYS) {
            if (typeof own[key] !== 'string' || !own[key].trim()) {
                fail(`strings.json has no ${key} for ${locale}.`);
            }
        }
        const shared = readJson(path.join(root, 'www/locales', `${locale}.json`), 'client/www locale');
        for (const key of KEYS) {
            if (key in shared) fail(`client/www/locales/${locale}.json already defines ${key}; rename one of them.`);
        }
        const file = path.join(www, 'locales', `${locale}.json`);
        locales[file] = {...readJson(file, 'iOS locale'), ...Object.fromEntries(KEYS.map((key) => [key, own[key]]))};
    }
    const files = {};
    for (const edit of EDITS) (files[edit.file] = files[edit.file] || []).push(edit);
    const patched = Object.entries(files).map(([file, edits]) => {
        const target = path.join(www, file);
        if (!fs.existsSync(target)) fail(`${file} is missing in platforms/ios/www.`);
        return [target, patch(fs.readFileSync(target, 'utf8'), file, edits)];
    });
    const copies = COPIES.map((name) => {
        const from = path.join(root, SOURCE, name);
        if (!fs.existsSync(from)) fail(`${name} is missing in ${SOURCE}.`);
        return [from, path.join(www, 'tracking-settings', name)];
    });

    for (const [target, text] of patched) fs.writeFileSync(target, text);
    for (const [file, json] of Object.entries(locales)) fs.writeFileSync(file, JSON.stringify(json, null, 4) + '\n');
    fs.mkdirSync(path.join(www, 'tracking-settings'), {recursive: true});
    for (const [from, to] of copies) fs.copyFileSync(from, to);
};
