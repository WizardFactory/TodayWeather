// Reads client/.env (ignored by Git). Values may reference $HOME or ${HOME}.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// With optional=true a missing file yields {} (development build without release inputs).
export function loadEnv({ optional = false, file = path.join(clientDir, '.env') } = {}) {
    if (!fs.existsSync(file)) {
        if (optional) return {};
        throw new Error(`${path.relative(clientDir, file)} is missing; copy .env.example and fill it in`);
    }
    const env = {};
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
        env[key] = value.replace(/\$\{?HOME\}?/g, os.homedir());
    }
    return env;
}

// False for empty values and the .env.example placeholders (<...>, XXXXXX).
export function isSet(value) {
    return Boolean(value) && !value.includes('<') && !/X{6,}/.test(value);
}

export function requireKeys(env, keys) {
    const missing = keys.filter((key) => !isSet(env[key]));
    if (missing.length) {
        throw new Error(`client/.env has no usable value for: ${missing.join(', ')}`);
    }
}

// Local path of a release file named by an env key, e.g. TW_GOOGLE_SERVICES_JSON.
export function releaseFile(env, key) {
    requireKeys(env, ['TW_RELEASE_LOCAL_DIR', key]);
    return path.join(env.TW_RELEASE_LOCAL_DIR, env[key]);
}
