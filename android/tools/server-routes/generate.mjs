#!/usr/bin/env node
// Route table of the legacy server for the native client's request-path test (AN-18, #2897).
//
// Reads server/app.js and every router it mounts as text, without loading them: app.js starts collectors by
// SERVER_MODE and the route modules need a database. Writes
// android/core-data/src/test/resources/server-routes/routes.json: each router's layers in registration order, which
// is the order Express 4 dispatches them in. RequestPathsTest walks them from app.js. Only this tool reads server/;
// the Gradle build reads the generated file. Usage, from the repository root:
//   node android/tools/server-routes/generate.mjs
// Running it again without changes in server/ changes nothing. It stops on a registration it cannot read rather than
// leave a route out.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const APP = 'server/app.js';
const LOCK = 'server/package-lock.json';
const OUT = path.join(ROOT, 'android/core-data/src/test/resources/server-routes/routes.json');
const METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'all'];

function fail(file, src, offset, message) {
    const line = src.slice(0, offset).split('\n').length;
    throw new Error(`${file}:${line}: ${message}`);
}

// ---------------------------------------------------------------- source scanning
// `code` is the source with comments blanked; `mask` also has the contents of strings, templates and regular
// expressions replaced. Both keep every offset and line break: calls are found in `mask`, arguments read from `code`.
function scan(src, file) {
    const code = src.split('');
    const mask = src.split('');
    const blank = (from, to) => {
        for (let k = from; k < to; k++) {
            if (src[k] !== '\n') { code[k] = ' '; mask[k] = ' '; }
        }
    };
    const fill = (from, to) => {
        for (let k = from; k < to; k++) if (src[k] !== '\n') mask[k] = '_';
    };
    const KEYWORDS = ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw', 'else', 'do', 'instanceof'];
    let last = '';
    let lastWord = '';
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        const d = src[i + 1];
        if (c === '/' && d === '/') {
            const end = src.indexOf('\n', i);
            blank(i, end < 0 ? src.length : end);
            i = end < 0 ? src.length : end;
        } else if (c === '/' && d === '*') {
            const end = src.indexOf('*/', i + 2);
            if (end < 0) fail(file, src, i, 'unterminated comment');
            blank(i, end + 2);
            i = end + 2;
        } else if (c === '"' || c === '\'' || c === '`') {
            let j = i + 1;
            for (; j < src.length && src[j] !== c; j++) {
                if (src[j] === '\\') j++;
                else if (c !== '`' && src[j] === '\n') fail(file, src, i, 'unterminated string');
                else if (c === '`' && src[j] === '$' && src[j + 1] === '{') {
                    let depth = 0;
                    for (j++; j < src.length; j++) {
                        if (src[j] === '{') depth++;
                        else if (src[j] === '}' && --depth === 0) break;
                        else if ('\'"`/'.includes(src[j])) fail(file, src, j, 'a quote or slash inside a template expression');
                    }
                }
            }
            if (j >= src.length) fail(file, src, i, 'unterminated string');
            fill(i + 1, j);
            i = j + 1;
            last = c;
            lastWord = '';
        } else if (c === '/' && (last === '' || '(,=:[!&|?{};+-*%<>~^'.includes(last) || KEYWORDS.includes(lastWord))) {
            let j = i + 1;
            let inClass = false;
            for (; j < src.length && (src[j] !== '/' || inClass); j++) {
                if (src[j] === '\\') j++;
                else if (src[j] === '[') inClass = true;
                else if (src[j] === ']') inClass = false;
                else if (src[j] === '\n') fail(file, src, i, 'unterminated regular expression');
            }
            if (j >= src.length) fail(file, src, i, 'unterminated regular expression');
            fill(i + 1, j);
            i = j + 1;
            while (/[a-z]/i.test(src[i] || '')) i++;
            last = 'x';
            lastWord = '';
        } else if (/[\w$]/.test(c)) {
            const word = src.slice(i).match(/^[\w$]+/)[0];
            i += word.length;
            last = 'x';
            lastWord = word;
        } else {
            if (!/\s/.test(c)) {
                last = c;
                lastWord = '';
            }
            i++;
        }
    }
    return {file, src, code: code.join(''), mask: mask.join('')};
}

// The arguments of the call whose `(` is at `open`, as source texts with their offsets.
function callArguments(s, open) {
    const out = [];
    let depth = 0;
    let start = open + 1;
    const push = (from, to) => {
        const text = s.code.slice(from, to).trim();
        if (text) out.push({text, offset: from + (s.code.slice(from, to).length - s.code.slice(from, to).trimStart().length)});
    };
    for (let k = open + 1; k < s.mask.length; k++) {
        const ch = s.mask[k];
        if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) {
            if (depth === 0) {
                if (ch !== ')') fail(s.file, s.src, k, `unbalanced '${ch}'`);
                push(start, k);
                return out;
            }
            depth--;
        } else if (ch === ',' && depth === 0) {
            push(start, k);
            start = k + 1;
        }
    }
    return fail(s.file, s.src, open, 'unclosed call');
}

// Every `<variable>.<name>(` outside comments and literals, with its arguments.
function calls(s, variable) {
    const re = new RegExp(`(?<![\\w$.])${variable.replace(/\$/g, '\\$')}\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(`, 'g');
    const out = [];
    for (const m of s.mask.matchAll(re)) {
        const open = m.index + m[0].length - 1;
        out.push({name: m[1], offset: m.index, line: s.src.slice(0, m.index).split('\n').length, args: callArguments(s, open)});
    }
    return out;
}

// ---------------------------------------------------------------- path-to-regexp 0.1.7
// The string-path rules of path-to-regexp 0.1.7 (MIT), the version express 4.13.4 uses (server/package-lock.json):
// the regular expression Express matches a layer's path with. Keys are not needed here.
function pathToRegexp(p, {sensitive, strict, end}) {
    let out = ('^' + p + (strict ? '' : p[p.length - 1] === '/' ? '?' : '/?'))
        .replace(/\/\(/g, '/(?:')
        .replace(/([/.])/g, '\\$1')
        .replace(/(\\\/)?(\\\.)?:(\w+)(\(.*?\))?(\*)?(\?)?/g, (match, slash, format, key, capture, star, optional) => {
            slash = slash || '';
            format = format || '';
            capture = capture || '([^\\/' + format + ']+?)';
            optional = optional || '';
            return '' + (optional ? '' : slash) + '(?:' + format + (optional ? slash : '') + capture +
                (star ? '((?:[\\/' + format + '].+?)?)' : '') + ')' + optional;
        })
        .replace(/\*/g, '(.*)');
    out += end ? '$' : (out[out.length - 1] === '/' ? '' : '(?=\\/|$)');
    new RegExp(out, sensitive ? '' : 'i');
    return out;
}

// ---------------------------------------------------------------- arguments
const STRING = /^(['"])([^'"\\\n]*)\1$/;
const REQUIRE = /^require\s*\(\s*(['"])([^'"\\\n]+)\1\s*\)$/;
const IDENT = /^[A-Za-z_$][\w$]*$/;
const FUNCTION = /^function\b\s*([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)\s*\{/;
const ARROW = /^\(([^)]*)\)\s*=>/;
const CALL = /^([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\(/;
const MEMBER = /^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*$/;

// A path argument: a string, or a variable of the same file holding a regular expression literal.
function pathArgument(s, arg) {
    const str = arg.text.match(STRING);
    if (str) return {path: str[2]};
    if (!IDENT.test(arg.text)) return null;
    const decl = new RegExp(`(?:var|let|const)\\s+${arg.text.replace(/\$/g, '\\$')}\\s*=\\s*/`, 'g');
    const found = [...s.mask.matchAll(decl)];
    if (found.length === 0) return null;
    if (found.length > 1) fail(s.file, s.src, arg.offset, `${arg.text} is declared more than once`);
    const at = found[0].index + found[0][0].length - 1;
    const literal = s.code.slice(at).match(/^\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n[])+)\/([a-z]*)\s*[;\n]/);
    if (!literal) fail(s.file, s.src, at, `${arg.text} is not a regular expression literal`);
    if (!/^i?$/.test(literal[2])) fail(s.file, s.src, at, `flags '${literal[2]}' are not supported`);
    new RegExp(literal[1], literal[2]);
    return {path: arg.text, regex: literal[1], ignoreCase: literal[2] === 'i'};
}

function handlerOf(s, arg) {
    let m;
    if ((m = arg.text.match(FUNCTION))) {
        const params = m[2].split(',').map((p) => p.trim()).filter(Boolean);
        return {handler: `function${m[1] ? ' ' + m[1] : ' '}(${params.join(', ')})`, arity: params.length};
    }
    if ((m = arg.text.match(ARROW))) {
        const params = m[1].split(',').map((p) => p.trim()).filter(Boolean);
        return {handler: `(${params.join(', ')}) =>`, arity: params.length};
    }
    if ((m = arg.text.match(CALL))) return {handler: `${m[1].replace(/\s+/g, '')}(…)`};
    if (MEMBER.test(arg.text)) return {handler: arg.text.replace(/\s+/g, '')};
    return fail(s.file, s.src, arg.offset, `unsupported handler: ${arg.text.slice(0, 60)}`);
}

function resolveModule(from, request) {
    if (!request.startsWith('.')) return null;
    const base = path.join(path.dirname(from), request);
    for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
        const abs = path.join(ROOT, candidate);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return candidate.split(path.sep).join('/');
    }
    return null;
}

// ---------------------------------------------------------------- the walk
const routers = new Map();
const read = new Set();

function source(file) {
    read.add(file);
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function layerPath(p, caseSensitive, end) {
    if (p.regex !== undefined) return {path: p.path, regex: p.regex, ignoreCase: p.ignoreCase};
    const layer = {path: p.path, regex: pathToRegexp(p.path, {sensitive: caseSensitive, strict: false, end}), ignoreCase: !caseSensitive};
    // Express matches a non-ending '/' without its expression, as the whole path (`fast_slash`), and trims nothing.
    if (p.path === '/' && !end) layer.matchesAll = true;
    return layer;
}

function walk(file, isApp) {
    if (routers.has(file)) return;
    const s = scan(source(file), file);
    let variable;
    let caseSensitive = false;
    if (isApp) {
        const found = [...s.mask.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*express\s*\(\s*\)/g)];
        if (found.length !== 1) fail(file, s.src, 0, `expected one express() application, found ${found.length}`);
        variable = found[0][1];
        if (/case sensitive routing|strict routing/.test(s.code)) fail(file, s.src, 0, 'routing settings are not supported');
    } else {
        const found = [...s.mask.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:express|require\s*\(\s*(['"])_+\2\s*\))\s*\.\s*Router\s*\(/g)];
        if (found.length !== 1) fail(file, s.src, 0, `expected one express Router, found ${found.length}`);
        const ctor = s.code.slice(found[0].index, found[0].index + found[0][0].length);
        if (!/(?:express|require\s*\(\s*(['"])express\1\s*\))\s*\.\s*Router\s*\($/.test(ctor)) fail(file, s.src, found[0].index, 'a Router not from express');
        const options = callArguments(s, found[0].index + found[0][0].length - 1);
        if (options.length > 1) fail(file, s.src, found[0].index, 'unexpected Router arguments');
        if (options.length === 1) {
            const m = options[0].text.match(/^\{\s*caseSensitive\s*:\s*(true|false)\s*\}$/);
            if (!m) fail(file, s.src, options[0].offset, `unsupported Router options ${options[0].text}`);
            caseSensitive = m[1] === 'true';
        }
        variable = found[0][1];
    }
    const layers = [];
    routers.set(file, {file, caseSensitive, layers});
    for (const call of calls(s, variable)) {
        const name = call.name;
        if (name === 'route' || name === 'param') fail(file, s.src, call.offset, `${variable}.${name} is not supported`);
        if (name === 'get' && isApp && call.args.length === 1) continue; // app.get(setting)
        if (METHODS.includes(name)) {
            const p = call.args.length > 1 ? pathArgument(s, call.args[0]) : null;
            if (!p) fail(file, s.src, call.offset, `${variable}.${name} without a readable path`);
            layers.push({line: call.line, kind: 'route', method: name.toUpperCase(), ...layerPath(p, caseSensitive, true)});
        } else if (name === 'use') {
            let handlers = call.args;
            let p = {path: '/'};
            const first = handlers.length > 0 ? pathArgument(s, handlers[0]) : null;
            if (first) {
                p = first;
                handlers = handlers.slice(1);
            }
            if (handlers.length === 0) fail(file, s.src, call.offset, `${variable}.use without a handler`);
            for (const h of handlers) {
                if (h.text.startsWith('[')) fail(file, s.src, h.offset, 'handler arrays in use() are not supported');
                const req = h.text.match(REQUIRE);
                const target = req && resolveModule(file, req[2]);
                if (target) {
                    layers.push({line: call.line, kind: 'mount', ...layerPath(p, caseSensitive, false), router: target});
                    walk(target, false);
                } else {
                    layers.push({line: call.line, kind: 'middleware', ...layerPath(p, caseSensitive, false), ...handlerOf(s, h)});
                }
            }
        }
    }
}

walk(APP, true);

// ---------------------------------------------------------------- versions and output
const lock = JSON.parse(source(LOCK));
read.delete(LOCK);
const pkg = (name) => lock.packages?.[`node_modules/express/node_modules/${name}`]?.version ?? lock.packages?.[`node_modules/${name}`]?.version ??
    lock.dependencies?.express?.dependencies?.[name]?.version ?? lock.dependencies?.[name]?.version;
const express = pkg('express');
const pathToRegexpVersion = pkg('path-to-regexp');
if (!/^4\./.test(express ?? '') || !/^0\.1\./.test(pathToRegexpVersion ?? '')) {
    throw new Error(`${LOCK}: express ${express} with path-to-regexp ${pathToRegexpVersion}; this tool follows express 4 with path-to-regexp 0.1`);
}

const table = {
    generator: 'android/tools/server-routes/generate.mjs',
    app: APP,
    express,
    pathToRegexp: pathToRegexpVersion,
    routers: [...routers.values()].sort((a, b) => a.file.localeCompare(b.file)),
    sources: [...read].sort().map((p) => ({
        path: p,
        commit: execFileSync('git', ['-C', ROOT, 'log', '-1', '--format=%H', '--', p]).toString().trim(),
        sha256: createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex'),
    })),
};
fs.mkdirSync(path.dirname(OUT), {recursive: true});
fs.writeFileSync(OUT, JSON.stringify(table, null, 1) + '\n');
const count = (kind) => table.routers.reduce((n, r) => n + r.layers.filter((l) => l.kind === kind).length, 0);
console.log(`${path.relative(ROOT, OUT)}: ${table.routers.length} routers, ${count('route')} routes, ${count('mount')} mounts, ` +
    `${count('middleware')} middleware`);
