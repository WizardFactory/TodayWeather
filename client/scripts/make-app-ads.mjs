// Prints the app-ads.txt served at the developer website (https://todayweather.ai/app-ads.txt) for both
// store listings. The publisher ID comes from the AdMob app IDs in client/.env, so it never enters Git.
// Upload and verification: docs/operations/cordova-store-release.md#developer-website-and-app-adstxt.
import { pathToFileURL } from 'node:url';
import { loadEnv, requireKeys } from './env.mjs';

const KEYS = ['TW_ADMOB_APP_ID_ANDROID', 'TW_ADMOB_APP_ID_IOS'];
const SAMPLE_PUBLISHER = '3940256099942544';
// Google's certification authority ID for the google.com seller line, as in the AdMob snippet.
const GOOGLE_TAG_ID = 'f08c47fec0942fa0';

export function appAdsTxt(env) {
    requireKeys(env, KEYS);
    const publishers = new Set(KEYS.map((key) => {
        const match = /^ca-app-pub-(\d{16})~\d+$/.exec(env[key]);
        if (!match) throw new Error(`${key} is not an AdMob app ID (ca-app-pub-<16 digits>~<digits>)`);
        if (match[1] === SAMPLE_PUBLISHER) throw new Error(`${key} is Google's sample app ID`);
        return match[1];
    }));
    if (publishers.size !== 1) throw new Error('the Android and iOS app IDs belong to different AdMob publishers');
    return `google.com, pub-${[...publishers][0]}, DIRECT, ${GOOGLE_TAG_ID}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.stdout.write(appAdsTxt(loadEnv()));
}
