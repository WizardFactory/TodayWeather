// The Node APIs that android/tools/corpus/generate.mjs uses, for the JavaScriptCore shell (jsc). compare_jsc.py
// prepends this file and a `__CONFIG` object to the generator's source and runs the result under jsc.
//
// - vm.runInNewContext(code, context): each context gets its own realm ($262.createRealm()), as a Node vm context
//   has its own built-ins. The realm's global object holds the context's properties; the context object gets
//   accessors to them, so reads and writes on either side stay live (Node "contextifies" the object itself).
//   Globals the code declares (function and var declarations, assignments) show up on the context after each run.
//   The jsc shell's own functions (print, setTimeout, ...) are hidden from the realm, as a vm context lacks them.
// - fs: reads with jsc's readFile, directory listings from __CONFIG.directories; writes are collected and printed as JSON at the end (jsc cannot create
//   directories); mkdirSync and rmSync do nothing.
// - process.env.TZ: jsc reads the time zone once, from the TZ of its process, so a run cannot switch zones.
//   compare_jsc.py runs the whole generator once per zone and compares each case in the run of its zone; the
//   zones the generator asks for are recorded here.
// - crypto.createHash('sha256'), child_process.execFileSync (only `git log -1 --format=%H -- <path>`, answered from
//   __CONFIG.commits), path, url.fileURLToPath, console.
'use strict';

const __files = {};
const __log = [];
const __zonesRequested = [];

const __shellNames = ['print', 'printErr', 'debug', 'describe', 'describeArray', 'jscStack', 'gc', 'fullGC', 'edenGC',
    'setTimeout', 'clearTimeout', 'readFile', 'writeFile', 'read', 'readline', 'load', 'loadString', 'run', 'runString',
    'quit', 'abort', 'checkSyntax', 'createGlobalObject', 'createRealm', 'drainMicrotasks', 'preciseTime', 'dateNow',
    'version', 'callerSourceOrigin', 'sleepSeconds', 'arguments', 'scriptArgs', '$262', '$', 'Worker', 'console',
    'evalScript', 'globalObjectFor', 'agent', 'setUnhandledRejectionCallback', 'ensureArrayStorage', 'isRope',
    'noInline', 'noFTL', 'noOSRExitFuzzing', 'OSRExit', 'isFinalTier', 'predictInt32', 'optimizeNextInvocation',
    'numberOfDFGCompiles', 'reoptimizationRetryCount', 'transferArrayBuffer', 'failNextNewCodeBlock', 'heapSize',
    'heapCapacity', 'flashHeapAccess', 'disableRichSourceInfo', 'mallocInALoop', 'totalCompileTime', 'setHiddenValue',
    'getHiddenValue', 'callerIsBBQOrOMGCompiled', 'generateHeapSnapshot', 'generateHeapSnapshotForGCDebugging',
    'resetSuperSamplerState', 'samplingProfilerStackTraces', 'startSamplingProfiler', 'maxArguments', 'asyncTestStart',
    'asyncTestPassed', 'WebAssemblyMemoryMode', 'gcAndSweep', 'forceGCSlowPaths', 'addressOf', 'releaseWeakRefs',
    'finalizationRegistryLiveCount', 'finalizationRegistryDeadCount', 'getRandomSeed', 'setRandomSeed', 'isHavingABadTime',
    'createGlobalObjectWithoutProtoChain', 'dumpTypesForAllVariables', 'drainMicrotasksIfPossible', 'cryptographicallyRandomNumber'];

const __realms = new WeakMap();

function __realmFor(context) {
    let entry = __realms.get(context);
    if (!entry) {
        const realm = $262.createRealm();
        const global = realm.global;
        for (const name of __shellNames) {
            if (typeof global[name] !== 'undefined') {
                Object.defineProperty(global, name, {value: undefined, writable: true, configurable: true, enumerable: false});
            }
        }
        entry = {realm, global, linked: new Set(), builtins: new Set(Object.getOwnPropertyNames(global))};
        __realms.set(context, entry);
    }
    return entry;
}

function __link(context, entry, key) {
    const global = entry.global;
    Object.defineProperty(context, key, {
        get() { return global[key]; },
        set(v) { global[key] = v; },
        enumerable: true, configurable: true,
    });
    entry.linked.add(key);
}

const vm = {
    runInNewContext(code, context) {
        const entry = __realmFor(context);
        // Properties the generator put on the context since the last run move into the realm's global object.
        for (const key of Object.keys(context)) {
            if (entry.linked.has(key)) continue;
            Object.defineProperty(entry.global, key, {value: context[key], writable: true, configurable: true, enumerable: true});
            __link(context, entry, key);
        }
        const result = entry.realm.evalScript(String(code));
        for (const key of Object.getOwnPropertyNames(entry.global)) {
            if (!entry.linked.has(key) && !entry.builtins.has(key)) __link(context, entry, key);
        }
        return result;
    },
    // A context the generator already ran code in: the same realm (runInNewContext reuses it too, as Node does for
    // an object that is already a context).
    runInContext(code, context) { return vm.runInNewContext(code, context); },
};

const fs = {
    readFileSync(file, encoding) {
        if (encoding) return readFile(file);
        return readFile(file, 'binary');  // a Uint8Array; only hashed
    },
    // Listings come from compare_jsc.py (__CONFIG.directories), in the order os.listdir gives, as Node's readdir.
    readdirSync(dir) {
        const key = __normalize(dir);
        if (!(key in __CONFIG.directories)) throw new Error(`no listing recorded for ${key}`);
        return __CONFIG.directories[key].slice();
    },
    writeFileSync(file, data) { __files[file] = String(data); },
    mkdirSync() {},
    rmSync() {},
};

function __normalize(p) {
    const absolute = p.startsWith('/');
    const out = [];
    for (const part of p.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else if (!absolute) out.push('..'); }
        else out.push(part);
    }
    return (absolute ? '/' : '') + out.join('/') || (absolute ? '/' : '.');
}

const path = {
    join: (...parts) => __normalize(parts.filter((p) => p !== '').join('/')),
    resolve(...parts) {
        let p = '';
        for (const part of parts) p = part.startsWith('/') ? part : (p ? p + '/' + part : part);
        if (!p.startsWith('/')) throw new Error('path.resolve: relative paths are not supported here');
        return __normalize(p);
    },
    dirname(p) { const n = __normalize(p); const i = n.lastIndexOf('/'); return i <= 0 ? (i === 0 ? '/' : '.') : n.slice(0, i); },
    relative(from, to) {
        const a = __normalize(from).split('/').filter(Boolean), b = __normalize(to).split('/').filter(Boolean);
        let i = 0;
        while (i < a.length && i < b.length && a[i] === b[i]) i++;
        return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
    },
};

const fileURLToPath = (url) => decodeURIComponent(String(url).replace(/^file:\/\//, ''));

function execFileSync(command, args) {
    const i = args.indexOf('--');
    if (command !== 'git' || i < 0 || !args.includes('log')) throw new Error(`execFileSync not available: ${command} ${args.join(' ')}`);
    const file = args[i + 1];
    if (!(file in __CONFIG.commits)) throw new Error(`no commit recorded for ${file}`);
    return {toString: () => __CONFIG.commits[file] + '\n'};
}

const process = {
    env: new Proxy({}, {
        set(target, key, value) {
            if (key === 'TZ' && !__zonesRequested.includes(String(value))) __zonesRequested.push(String(value));
            target[key] = String(value);
            return true;
        },
        deleteProperty(target, key) { delete target[key]; return true; },
    }),
};

const console = {log: (...a) => __log.push(a.join(' ')), warn() {}, error: (...a) => __log.push(a.join(' ')), info() {}};

// SHA-256 (FIPS 180-4) over UTF-8 strings or byte arrays.
function __sha256(bytes) {
    const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1,
        0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d,
        0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
        0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3,
        0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb,
        0xbef9a3f7, 0xc67178f2];
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const length = bytes.length;
    const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
    padded.set(bytes);
    padded[length] = 0x80;
    const bits = length * 8;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
    view.setUint32(padded.length - 4, bits >>> 0);
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < padded.length; off += 64) {
        for (let t = 0; t < 16; t++) w[t] = view.getUint32(off + t * 4);
        for (let t = 16; t < 64; t++) {
            const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
            const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
            w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, h] = H;
        for (let t = 0; t < 64; t++) {
            const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + w[t]) >>> 0;
            const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
            h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) >>> 0; });
    }
    return H.map((v) => v.toString(16).padStart(8, '0')).join('');
}

function __utf8(s) {
    const out = [];
    for (const ch of s) {
        const c = ch.codePointAt(0);
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return Uint8Array.from(out);
}

function createHash(algorithm) {
    if (algorithm !== 'sha256') throw new Error(`createHash(${algorithm}) not available`);
    const chunks = [];
    return {
        update(data) { chunks.push(typeof data === 'string' ? __utf8(data) : Uint8Array.from(data)); return this; },
        digest(encoding) {
            if (encoding !== 'hex') throw new Error('digest: only hex');
            const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
            let o = 0;
            for (const c of chunks) { all.set(c, o); o += c.length; }
            return __sha256(all);
        },
    };
}
