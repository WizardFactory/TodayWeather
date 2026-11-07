// app-ads.txt for the developer website (#2871): one Google seller line derived from the release app IDs.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = () => import(path.join(__dirname, '..', 'scripts', 'make-app-ads.mjs'));

// Fixture publisher, not the account's ID.
const PUB = '1234567890123456';
const env = (android, ios) => ({TW_ADMOB_APP_ID_ANDROID: android, TW_ADMOB_APP_ID_IOS: ios});

test('both store apps of one publisher produce the AdMob seller line', async () => {
    const {appAdsTxt} = await load();
    assert.equal(appAdsTxt(env(`ca-app-pub-${PUB}~1111111111`, `ca-app-pub-${PUB}~2222222222`)),
        `google.com, pub-${PUB}, DIRECT, f08c47fec0942fa0\n`);
});

test('missing, malformed, sample and mixed-publisher IDs are rejected', async () => {
    const {appAdsTxt} = await load();
    assert.throws(() => appAdsTxt(env('', `ca-app-pub-${PUB}~2`)), /TW_ADMOB_APP_ID_ANDROID/);
    assert.throws(() => appAdsTxt(env('ca-app-pub-XXXXXXXXXXXXXXXX~XXXXXXXXXX', `ca-app-pub-${PUB}~2`)), /TW_ADMOB_APP_ID_ANDROID/);
    // An ad unit ID (slash) is not an app ID.
    assert.throws(() => appAdsTxt(env(`ca-app-pub-${PUB}/1111111111`, `ca-app-pub-${PUB}~2`)), /not an AdMob app ID/);
    assert.throws(() => appAdsTxt(env('ca-app-pub-3940256099942544~3347511713', `ca-app-pub-${PUB}~2`)), /sample/);
    assert.throws(() => appAdsTxt(env(`ca-app-pub-${PUB}~1`, 'ca-app-pub-6543210987654321~2')), /different AdMob publishers/);
});
