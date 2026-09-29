// Cordova after_prepare hook: replace Google's sample AdMob app IDs (the plugin defaults recorded in
// package.json) with TW_ADMOB_APP_ID_ANDROID / TW_ADMOB_APP_ID_IOS from client/.env, so the real IDs
// never enter Git. Without them the sample IDs stay, which only serve test ads.
const fs = require('node:fs');
const path = require('node:path');

const SAMPLE = {
    android: 'ca-app-pub-3940256099942544~3347511713',
    ios: 'ca-app-pub-3940256099942544~1458002511',
};

module.exports = async function (context) {
    const { loadEnv, isSet } = await import('./env.mjs');
    const env = loadEnv({ optional: true });
    const root = context.opts.projectRoot;
    const targets = {
        android: [path.join(root, 'platforms/android/app/src/main/AndroidManifest.xml'), env.TW_ADMOB_APP_ID_ANDROID],
        ios: [path.join(root, 'platforms/ios/App/App-Info.plist'), env.TW_ADMOB_APP_ID_IOS],
    };
    for (const platform of context.opts.platforms || []) {
        const [file, id] = targets[platform] || [];
        if (!file || !fs.existsSync(file)) continue;
        if (!isSet(id)) {
            console.log(`admob-app-id: ${platform} keeps Google's sample app ID (no TW_ADMOB_APP_ID_${platform.toUpperCase()})`);
            continue;
        }
        const text = fs.readFileSync(file, 'utf8');
        if (!text.includes(SAMPLE[platform]) && text.includes(id)) continue;
        if (!text.includes(SAMPLE[platform])) throw new Error(`admob-app-id: sample app ID not found in ${file}`);
        fs.writeFileSync(file, text.split(SAMPLE[platform]).join(id));
        console.log(`admob-app-id: ${platform} app ID set from client/.env`);
    }
};
