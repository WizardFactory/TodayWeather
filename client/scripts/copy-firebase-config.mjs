// Copies the Firebase config files named in client/.env from TW_RELEASE_LOCAL_DIR to the client
// root, where cordova-plugin-firebasex-core picks them up (both are ignored by Git).
// Without them the Firebase plugins cannot build; run "npm run release:fetch" first.
import fs from 'node:fs';
import path from 'node:path';
import { clientDir, isSet, loadEnv, releaseFile } from './env.mjs';

const env = loadEnv({ optional: true });
const files = [
    ['TW_GOOGLE_SERVICES_JSON', 'google-services.json'],
    ['TW_GOOGLE_SERVICE_INFO_PLIST', 'GoogleService-Info.plist'],
];
let missing = 0;
for (const [key, target] of files) {
    const source = isSet(env[key]) && isSet(env.TW_RELEASE_LOCAL_DIR) ? releaseFile(env, key) : null;
    if (!source || !fs.existsSync(source)) {
        console.warn(`${target}: ${source ?? key + ' not set in client/.env'} not found`);
        missing++;
        continue;
    }
    fs.copyFileSync(source, path.join(clientDir, target));
    fs.chmodSync(path.join(clientDir, target), 0o600);
    console.log(`copied ${target}`);
}
if (missing) {
    console.warn('Firebase config missing: Android and iOS builds with the Firebase plugins will fail.');
}
