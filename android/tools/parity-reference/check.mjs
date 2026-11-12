#!/usr/bin/env node
// Verify the declared comparisons and captured-file integrity without client/, adb or a server.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {measuredView} from '../emulator/reference-view.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const coverage = JSON.parse(fs.readFileSync(path.join(here, 'coverage.json')));
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const safe = name => typeof name === 'string' && name.length > 0 && !path.isAbsolute(name) &&
    !name.split(/[\\/]/).some(part => part === '..' || part === '.' || part === '');
const fill = (template, lang) => template.replaceAll('{lang}', lang);
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function verifyMatrix(root, manifest = coverage) {
    const problems = [];
    let comparisons = 0;
    const apks = new Set();
    for (const size of manifest.sizes) for (const [name, spec] of Object.entries(manifest.sets)) {
        const dir = path.join(root, size, name);
        const prefix = `${size}/${name}`;
        const problem = message => problems.push(`${prefix}: ${message}`);
        try {
            const provenance = JSON.parse(fs.readFileSync(path.join(dir, 'provenance.json')));
            if (!hex(provenance.cordovaApk?.sha256)) throw new Error('missing APK digest');
            apks.add(provenance.cordovaApk.sha256);
            if (!provenance.cordovaApk.sources?.length) throw new Error('missing source provenance');
            const files = new Map();
            for (const item of provenance.files) {
                if (!safe(item.file) || !hex(item.sha256) || files.has(item.file)) throw new Error(`invalid/duplicate captured file ${item.file}`);
                const file = path.join(dir, item.file);
                if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`symlink is not captured evidence: ${item.file}`);
                if (digest(fs.readFileSync(file)) !== item.sha256) problem(`capture hash differs: ${item.file}`);
                files.set(item.file, item.sha256);
            }
            const limits = JSON.parse(fs.readFileSync(path.join(dir, 'tolerances.json')));
            const keys = new Set();
            for (const lang of manifest.languages) {
                const viewportName = `${lang}/viewport.json`;
                if (!files.has(viewportName)) throw new Error(`unhashed viewport: ${viewportName}`);
                const viewport = JSON.parse(fs.readFileSync(path.join(dir, viewportName)));
                const expected = measuredView(size, viewport.webView, viewport.origin);
                if (JSON.stringify(expected.nominal) !== JSON.stringify(viewport.nominal)) problem(`nominal metadata differs: ${lang}`);
                if (viewport.webView.language.split('-')[0] !== lang.split('-')[0]) problem(`wrong language: ${lang}`);
                for (const entry of spec.cases) {
                    const image = fill(entry.image, lang);
                    const key = fill(entry.tolerance, lang);
                    if (!safe(image) || !files.has(image)) throw new Error(`missing/unhashed comparison: ${image}`);
                    const png = fs.readFileSync(path.join(dir, image));
                    if (png.length < 24 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
                        png.readUInt32BE(16) === 0 || png.readUInt32BE(20) === 0) problem(`invalid PNG: ${image}`);
                    const limit = limits.cases?.[key];
                    if (!limit || !['strong', 'mean', 'heightDifference'].every(k => Number.isFinite(limit[k])) ||
                        limit.strong < 0 || limit.strong > 1 || limit.mean < 0 || limit.mean > 255) problem(`invalid/missing tolerance: ${key}`);
                    if (keys.has(key)) problem(`duplicate comparison: ${key}`);
                    keys.add(key);
                    comparisons++;
                }
                for (const template of spec.supportingFiles || []) {
                    const file = fill(template, lang);
                    if (!safe(file) || !files.has(file)) problem(`missing/unhashed supporting file: ${file}`);
                }
            }
            for (const key of Object.keys(limits.cases || {})) if (!keys.has(key)) problem(`undeclared tolerance: ${key}`);
        } catch (error) { problem(error.message); }
    }
    if (apks.size !== 1) problems.push(`matrix must use one source-matched APK, found ${apks.size}`);
    return {comparisons, problems};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = path.resolve(here, '../../app/src/test/resources/parity-reference');
    const result = verifyMatrix(root);
    console.log(JSON.stringify(result, null, 2));
    if (result.problems.length) process.exitCode = 1;
}
