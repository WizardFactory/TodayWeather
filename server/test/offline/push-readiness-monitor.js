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
    function line(date, route, code, offset = '+0000', method = 'POST') {
        const d = new Date(+date + (offset === '+0900' ? 9 * 3600000 : 0));
        const [day, month, year, time] = d.toUTCString().split(' ').slice(1, 5);
        return 'private-address - - [' + day + '/' + month + '/' + year + ':' + time + ' ' + offset +
            '] "' + method + ' ' + route + ' HTTP/1.1" ' + code + ' 0 "-" "private-agent"\n';
    }
    async function observe(exit, verbose = false) {
        const options = { env: Object.assign({}, process.env, { PUSH_SOCKET_PATH: socket, PUSH_NGINX_ACCESS_LOG: log }) };
        let output, actualExit = 0;
        try {
            const result = await run(process.execPath, [script].concat(verbose ? ['--verbose'] : []), options);
            output = result.stdout;
        } catch (error) {
            actualExit = error.code;
            output = error.stdout;
        }
        assert.equal(actualExit, exit, 'monitor exit; output: ' + output);
        if (!output.trim()) return '';
        assert(!output.includes('private'));
        return JSON.parse(output);
    }
    try {
        const singleVersions = ['v000705', 'v000803', 'v000901', 'v000902', 'v000903'];
        const records = [];
        for (const version of singleVersions) {
            for (const method of ['POST', 'PUT', 'DELETE']) {
                records.push(line(now, '/' + version + '/push/?device=private',
                    version === 'v000705' && method === 'DELETE' ? 503 : 200, '+0000', method));
            }
        }
        records.push(line(now, '/v000902/push-list/', 503), line(now, '/v000903/push-list', 200));
        for (const [method, route] of [
            ['GET', '/v000903/push'], ['PATCH', '/v000902/push'],
            ['PUT', '/v000902/push-list'], ['DELETE', '/v000903/push-list/'],
            ['POST', '/v000705/push-list'], ['POST', '/v000803/push-list'], ['POST', '/v000901/push-list'],
            ['POST', '/v000001/push'], ['POST', '/v000904/push'], ['POST', '/push'], ['POST', '/push-list/'],
            ['POST', '/v000902/push-listing'], ['POST', '/v000903/push/other'], ['POST', '/other?q=/v000902/push']
        ]) records.push(line(now, route, 503, '+0000', method));
        fs.writeFileSync(log, records.join(''));
        const routes = await observe(1);
        assert.equal(routes.registrations, 17);
        assert.equal(routes.http503, 2);
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
        console.log('Readiness monitor: versioned write routes and methods, healthy silence, socket failures, recent rotated 503s, stale rows and missing logs checked');
    } finally {
        if (peer.listening) await new Promise(resolve => peer.close(resolve));
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
