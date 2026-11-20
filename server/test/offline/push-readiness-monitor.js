'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);

async function main() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-monitor-'));
    const socket = path.join(dir, 'push.sock');
    const log = path.join(dir, 'access.log');
    const script = path.resolve(__dirname, '../../bin/check-push-readiness');
    let status = 200, ready = true;
    const peer = http.createServer((req, res) => res.writeHead(status).end(JSON.stringify({ ready })));
    await new Promise(resolve => peer.listen(socket, resolve));
    const now = new Date();
    function line(date, route, code, offset = '+0000') {
        const d = new Date(+date + (offset === '+0900' ? 9 * 3600000 : 0));
        const [day, month, year, time] = d.toUTCString().split(' ').slice(1, 5);
        return 'private-address - - [' + day + '/' + month + '/' + year + ':' + time + ' ' + offset +
            '] "POST ' + route + ' HTTP/1.1" ' + code + ' 0 "-" "private-agent"\n';
    }
    async function observe(exit, verbose = false) {
        const options = { env: Object.assign({}, process.env, { PUSH_SOCKET_PATH: socket, PUSH_NGINX_ACCESS_LOG: log }) };
        let output;
        try {
            const r = await run(process.execPath, [script].concat(verbose ? ['--verbose'] : []), options);
            assert.equal(exit, 0);
            output = r.stdout;
        } catch (e) {
            assert.equal(e.code, exit, e.stderr);
            output = e.stdout;
        }
        if (!output.trim()) return '';
        assert(!output.includes('private'));
        return JSON.parse(output);
    }
    try {
        fs.writeFileSync(log, line(now, '/v000903/push-list', 200) + line(now, '/v000903/push-listing', 503));
        const old = line(new Date(+now - 7 * 60000), '/v000903/push-list', 503);
        const rotated = log + '-20261120.gz';
        fs.writeFileSync(rotated, zlib.gzipSync(old));
        assert.equal(await observe(0), '');
        const active = line(now, '/v000903/push?device=private', 503, '+0900');
        fs.writeFileSync(rotated, zlib.gzipSync(old + active));
        fs.writeFileSync(log + '.1', line(now, '/v000903/push-list', 200));
        let r = await observe(1);
        assert.equal(r.registrations, 3);
        assert.equal(r.http503, 1);
        assert.equal(r.socketReady, true);
        fs.unlinkSync(rotated);
        status = 503; ready = false;
        r = await observe(1);
        assert.equal(r.socketReady, false);
        assert.equal(r.http503, 0);
        status = 200;
        assert.equal((await observe(1)).socketReady, false);
        ready = true;
        fs.unlinkSync(log);
        assert.equal((await observe(1)).logReadable, false);
        fs.writeFileSync(log, 'non-combined-format\n');
        assert.equal((await observe(1)).logReadable, false);
        // A clipped log must not silently report a healthy five-minute window.
        const recent = line(now, '/v000903/push-list', 200);
        fs.writeFileSync(log, recent.repeat(Math.ceil(9 * 1024 * 1024 / recent.length)));
        assert.equal((await observe(1)).logReadable, false);
        fs.writeFileSync(log, old);
        assert.equal((await observe(0, true)).socketReady, true);
        await new Promise(resolve => peer.close(resolve));
        assert.equal((await observe(1)).socketReady, false);
        console.log('Readiness monitor: healthy silence, socket failures, recent rotated 503s, stale rows and missing logs checked');
    } finally {
        if (peer.listening) await new Promise(resolve => peer.close(resolve));
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
