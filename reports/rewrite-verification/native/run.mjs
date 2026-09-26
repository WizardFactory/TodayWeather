#!/usr/bin/env node
// Host driver for tw-harness.js. Usage:
//   node run.mjs android <apk> <outDir> [--fold|--unfold]
//   node run.mjs ios <app> <outDir> <udid>
// Installs fresh, grants location, launches once per scenario, takes screenshots on TWSHOT,
// performs TWHOST actions, and writes <outDir>/log.txt + summary.json.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { report } from './triage.mjs';

const [platform, artifact, outDir, extra] = process.argv.slice(2);
const PKG = 'net.wizardfactory.todayweather';
const ADB = `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const ENV = { ...process.env, DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer' };
const SEOUL = { lat: '37.5665', lon: '126.9780' };
const SCENARIO_TIMEOUT = 300_000;
const IDLE_TIMEOUT = 120_000;

fs.mkdirSync(outDir, { recursive: true });
const logFile = fs.createWriteStream(path.join(outDir, 'log.txt'));
const summary = { platform, artifact, started: new Date().toISOString(), scenarios: [], errors: [], checks: [], http: 0, native: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { env: ENV, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const note = (s) => { const l = `[driver ${new Date().toISOString().slice(11, 19)}] ${s}`; console.log(l); logFile.write(l + '\n'); };

// ---------------- platform adapters ----------------
const android = {
    async prepare() {
        if (extra === '--fold') { try { sh(ADB, ['emu', 'fold']); } catch { /* not foldable */ } }
        if (extra === '--unfold') { try { sh(ADB, ['emu', 'unfold']); } catch { /* not foldable */ } }
        await sleep(2000);
        try { sh(ADB, ['uninstall', PKG]); } catch { /* not installed */ }
        sh(ADB, ['install', '-r', artifact]);
        for (const p of ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION']) sh(ADB, ['shell', 'pm', 'grant', PKG, `android.permission.${p}`]);
        sh(ADB, ['emu', 'geo', 'fix', SEOUL.lon, SEOUL.lat]);
        sh(ADB, ['logcat', '-c']);
        this.logcat = spawn(ADB, ['logcat', '-v', 'time'], { env: ENV });
        this.logcat.stdout.setEncoding('utf8');
        let buf = '';
        this.logcat.stdout.on('data', (d) => { buf += d; const lines = buf.split('\n'); buf = lines.pop(); lines.forEach(onLine); });
    },
    async launch() { sh(ADB, ['shell', 'am', 'start', '-n', `${PKG}/.MainActivity`]); },
    async stop() { sh(ADB, ['shell', 'am', 'force-stop', PKG]); await sleep(1500); },
    async shot(file) {
        // Foldables expose two displays; screencap prints a warning before the PNG, so cut at the signature.
        const out = sh(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 });
        const at = out.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        fs.writeFileSync(file, at > 0 ? out.subarray(at) : out);
    },
    focused() { return sh(ADB, ['shell', 'dumpsys', 'window']).toString().split('\n').filter((l) => /mCurrentFocus|mFocusedApp/.test(l)).join(' ').trim(); },
    async host(action) {
        if (action === 'back') sh(ADB, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
        if (action === 'bgresume') {
            sh(ADB, ['shell', 'input', 'keyevent', 'KEYCODE_HOME']); await sleep(3000);
            sh(ADB, ['shell', 'am', 'start', '-n', `${PKG}/.MainActivity`]);
        }
        if (action === 'external-return') {
            note(`focus before return: ${this.focused()}`);
            sh(ADB, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']); await sleep(1500);
            if (!this.focused().includes(`${PKG}/`)) sh(ADB, ['shell', 'am', 'start', '-n', `${PKG}/.MainActivity`]);
        }
    },
    finish() { this.logcat?.kill(); },
};

const ios = {
    udid: extra,
    async prepare() {
        try { sh('xcrun', ['simctl', 'bootstatus', this.udid, '-b']); } catch { /* booted */ }
        try { sh('xcrun', ['simctl', 'terminate', this.udid, PKG]); } catch { /* not running */ }
        try { sh('xcrun', ['simctl', 'uninstall', this.udid, PKG]); } catch { /* not installed */ }
        sh('xcrun', ['simctl', 'install', this.udid, artifact]);
        sh('xcrun', ['simctl', 'privacy', this.udid, 'grant', 'location', PKG]);
        sh('xcrun', ['simctl', 'location', this.udid, 'set', `${SEOUL.lat},${SEOUL.lon}`]);
    },
    async launch() {
        this.proc = spawn('xcrun', ['simctl', 'launch', '--console-pty', '--terminate-running-process', this.udid, PKG], { env: ENV });
        this.proc.stdout.setEncoding('utf8');
        let buf = '';
        this.proc.stdout.on('data', (d) => { buf += d; const lines = buf.split(/\r?\n/); buf = lines.pop(); lines.forEach(onLine); });
        this.proc.on('exit', (code) => { if (!this.stopping) note(`app console exited code=${code}`); });
    },
    async stop() { this.stopping = true; this.proc?.kill(); await sleep(1500); try { sh('xcrun', ['simctl', 'terminate', this.udid, PKG]); } catch { /* ok */ } this.stopping = false; },
    async shot(file) { sh('xcrun', ['simctl', 'io', this.udid, 'screenshot', file]); },
    async host(action) {
        if (action === 'bgresume' || action === 'external-return') {
            if (action === 'bgresume') { sh('xcrun', ['simctl', 'launch', this.udid, 'com.apple.Preferences']); await sleep(3000); }
            try { sh('xcrun', ['simctl', 'launch', this.udid, PKG]); } catch (e) { note(`foreground failed: ${e.stderr}`); }
        }
    },
    finish() { this.proc?.kill(); },
};

const P = platform === 'android' ? android : ios;

// ---------------- log parsing ----------------
let current = null;
let lastActivity = Date.now();
let pending = Promise.resolve();
let allDone = false;
let shotSeq = 0;

function onLine(raw) {
    logFile.write(raw + '\n');
    if (platform === 'android' && /FATAL EXCEPTION|AndroidRuntime.*(E|FATAL)|Process .*has died|ANR in/.test(raw) && raw.includes(PKG.split('.').pop())) {
        summary.native.push(raw.trim());
    }
    if (platform === 'android' && /E\/chromium.*Uncaught|INFO:CONSOLE.*Uncaught/.test(raw)) summary.native.push(raw.trim());
    const m = raw.match(/(TW[A-Z]+) ([\d.]+) ?(.*)$/);
    if (!m) return;
    let [, kind, , msg] = m;
    msg = msg.replace(/", source: .*$/, '');
    lastActivity = Date.now();
    const where = current ? current.name : '-';
    if (kind === 'TWERR') summary.errors.push({ scenario: where, msg });
    if (kind === 'TWCHECK') summary.checks.push({ scenario: where, ok: msg.startsWith('ok '), msg });
    if (kind === 'TWHTTP') summary.http++;
    if (kind === 'TWSHOT') {
        const name = `${String(++shotSeq).padStart(2, '0')}-${msg.trim()}.png`;
        pending = pending.then(() => P.shot(path.join(outDir, name))).catch((e) => note(`shot failed ${e}`));
    }
    if (kind === 'TWHOST' && msg.startsWith('external ')) {
        // The app may be suspended behind the external app: screenshot and return from the host side.
        const name = `${String(++shotSeq).padStart(2, '0')}-${msg.slice(9).trim()}.png`;
        pending = pending.then(() => sleep(5000)).then(() => P.shot(path.join(outDir, name)))
            .then(() => P.host('external-return')).catch((e) => note(`external ${msg} failed ${e}`));
    } else if (kind === 'TWHOST') pending = pending.then(() => P.host(msg.trim())).catch((e) => note(`host ${msg} failed ${e}`));
    if (kind === 'TWSTEP' && /^scenario \d+ /.test(msg)) {
        const [, idx, name] = msg.match(/^scenario (\d+) (\S+)/);
        current = { idx: +idx, name, start: Date.now(), end: null, result: 'running' };
        summary.scenarios.push(current);
    }
    if (kind === 'TWEND' && current) { current.end = Date.now(); current.result = /aborted/.test(msg) ? 'aborted' : 'done'; current.ended = true; }
    if (kind === 'TWALLDONE') allDone = true;
}

// ---------------- main loop ----------------
note(`prepare ${platform}`);
await P.prepare();
for (let launchNo = 0; launchNo < 20 && !allDone; launchNo++) {
    const before = summary.scenarios.length;
    note(`launch #${launchNo}`);
    lastActivity = Date.now();
    await P.launch();
    const t0 = Date.now();
    while (!allDone) {
        await sleep(1000);
        const cur = summary.scenarios[summary.scenarios.length - 1];
        if (summary.scenarios.length > before && cur.ended) break;
        if (Date.now() - t0 > SCENARIO_TIMEOUT || Date.now() - lastActivity > IDLE_TIMEOUT) {
            note(`timeout (scenario=${cur ? cur.name : 'none'})`);
            await P.shot(path.join(outDir, `${String(++shotSeq).padStart(2, '0')}-timeout.png`)).catch(() => {});
            if (cur && !cur.ended) { cur.result = 'timeout'; cur.ended = true; }
            if (summary.scenarios.length === before) summary.scenarios.push({ idx: -1, name: `launch-${launchNo}-no-scenario`, result: 'timeout', ended: true });
            break;
        }
    }
    await pending;
    await sleep(1500);
    await P.stop();
}
P.finish();
await sleep(500);

summary.finished = new Date().toISOString();
console.log('\n' + report(summary));
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
process.exit(0);
