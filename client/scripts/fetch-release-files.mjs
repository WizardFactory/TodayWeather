// Downloads the release files named in client/.env from S3 into TW_RELEASE_LOCAL_DIR
// (outside the repository). Existing local files are kept unless --force is given.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { loadEnv, releaseFile, requireKeys } from './env.mjs';

const FILE_KEYS = [
    'TW_ANDROID_KEYSTORE',
    'TW_ANDROID_BUILD_JSON',
    'TW_GOOGLE_SERVICES_JSON',
    'TW_GOOGLE_SERVICE_INFO_PLIST',
    'TW_ADS_CLIENT_CONFIG',
];

const env = loadEnv();
const force = process.argv.includes('--force');
requireKeys(env, ['TW_RELEASE_AWS_PROFILE', 'TW_RELEASE_AWS_REGION', 'TW_RELEASE_S3_PREFIX', 'TW_RELEASE_LOCAL_DIR']);

fs.mkdirSync(env.TW_RELEASE_LOCAL_DIR, { recursive: true, mode: 0o700 });
fs.chmodSync(env.TW_RELEASE_LOCAL_DIR, 0o700);

for (const key of FILE_KEYS) {
    if (!env[key]) continue;
    const target = releaseFile(env, key);
    if (fs.existsSync(target) && !force) {
        console.log(`keep  ${env[key]}`);
        continue;
    }
    const prefix = env.TW_RELEASE_S3_PREFIX.endsWith('/') ? env.TW_RELEASE_S3_PREFIX : `${env.TW_RELEASE_S3_PREFIX}/`;
    execFileSync('aws', ['s3', 'cp', '--quiet', `${prefix}${env[key]}`, target,
        '--profile', env.TW_RELEASE_AWS_PROFILE, '--region', env.TW_RELEASE_AWS_REGION], { stdio: 'inherit' });
    fs.chmodSync(target, 0o600);
    console.log(`fetch ${env[key]}`);
}
