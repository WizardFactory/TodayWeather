// Release build: real AdMob app IDs and ad units, Firebase config, and (Android) a signed AAB.
//   node scripts/build-release.mjs android   -> platforms/android/app/build/outputs/bundle/release/app-release.aab
//   node scripts/build-release.mjs ios       -> prepared Xcode workspace; archive and sign in Xcode
// Needs client/.env and the release files ("npm run release:fetch"). Prints no secret values.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { clientDir, loadEnv, releaseFile, requireKeys } from './env.mjs';

const platform = process.argv[2];
if (!['android', 'ios'].includes(platform)) {
    console.error('usage: node scripts/build-release.mjs <android|ios>');
    process.exit(2);
}
const run = (cmd, args) => execFileSync(cmd, args, { cwd: clientDir, stdio: 'inherit' });

const env = loadEnv();
requireKeys(env, ['TW_ADMOB_APP_ID_ANDROID', 'TW_ADMOB_APP_ID_IOS', 'TW_ADMOB_BANNER_ANDROID', 'TW_ADMOB_BANNER_IOS']);
const files = ['TW_GOOGLE_SERVICES_JSON', 'TW_GOOGLE_SERVICE_INFO_PLIST', 'TW_ADS_CLIENT_CONFIG'];
if (platform === 'android') files.push('TW_ANDROID_BUILD_JSON', 'TW_ANDROID_KEYSTORE');
for (const key of files) {
    if (!fs.existsSync(releaseFile(env, key))) throw new Error(`${key} not found; run "npm run release:fetch"`);
}

run('npm', ['run', 'www:release']);

// Refuse to ship Google's test ad units.
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(clientDir, 'www', 'client.config.js'), 'utf8'), sandbox);
const config = sandbox.window.clientConfig;
if (!config.releaseAds || JSON.stringify(config).includes('ca-app-pub-3940256099942544')) {
    throw new Error('www/client.config.js is not a release configuration');
}

if (platform === 'android') {
    run('npx', ['cordova', 'build', 'android', '--release', `--buildConfig=${releaseFile(env, 'TW_ANDROID_BUILD_JSON')}`,
        '--', '--packageType=bundle']);
    console.log('AAB: platforms/android/app/build/outputs/bundle/release/app-release.aab');
} else {
    run('npx', ['cordova', 'prepare', 'ios']);
    console.log('Open platforms/ios/App.xcworkspace in Xcode, select a device target, then Product > Archive (signing in Xcode).');
}
