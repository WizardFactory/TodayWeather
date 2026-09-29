'use strict';
var http = require('http');
var fs = require('fs');
function request(socketPath, command) {
    return new Promise(function (resolve, reject) {
        var data = JSON.stringify(command),
            req = http.request(
                {
                    socketPath: socketPath,
                    path: '/command',
                    method: 'POST',
                    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
                },
                function (res) {
                    var body = '';
                    res.on('data', function (c) {
                        body += c;
                        if (body.length > 1024 * 1024) res.destroy();
                    });
                    res.on('end', function () {
                        try {
                            var result = JSON.parse(body);
                            if (res.statusCode !== 200)
                                throw new Error(result.error || 'Push coordinator failed');
                            resolve(result);
                        } catch (e) {
                            reject(e);
                        }
                    });
                }
            );
        req.setTimeout(8000, function () {
            req.destroy(new Error('Push coordinator timeout'));
        });
        req.on('error', function () {
            reject(new Error('Push coordinator unavailable'));
        });
        req.end(data);
    });
}
function listen(socketPath, registry) {
    if (!socketPath || socketPath[0] !== '/')
        return Promise.reject(new Error('PUSH_SOCKET_PATH must be absolute'));
    var server = http.createServer(function (req, res) {
        function reply(status, obj) {
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(obj));
        }
        if (req.method === 'GET' && req.url === '/health')
            return reply(registry.ready ? 200 : 503, { ready: registry.ready });
        if (req.method !== 'POST' || req.url !== '/command') return reply(404, { error: 'Not found' });
        var body = '',
            tooLarge = false;
        req.on('data', function (c) {
            body += c;
            if (body.length > 1024 * 1024) {
                tooLarge = true;
                req.destroy();
            }
        });
        req.on('end', function () {
            if (tooLarge) return;
            var c;
            try {
                c = JSON.parse(body);
            } catch (e) {
                return reply(400, { error: 'Invalid command' });
            }
            var result;
            try {
                if (c.op === 'upsert') result = registry.upsert(c.rows);
                else if (c.op === 'remove') result = registry.remove(c.selector || {});
                else if (c.op === 'rotate')
                    result = registry.rotate(c.oldToken, c.newToken, c.kind, c.product);
                else return reply(400, { error: 'Invalid command' });
            } catch (error) {
                return reply(403, { error: 'Invalid registration' });
            }
            Promise.resolve(result).then(
                function (r) {
                    reply(200, r);
                },
                function () {
                    reply(503, { error: 'Push registration failed' });
                }
            );
        });
    });
    // Never unlink an existing socket: that could start a second active coordinator.
    return new Promise(function (resolve, reject) {
        server.once('error', reject);
        server.listen(socketPath, function () {
            fs.chmodSync(socketPath, 384);
            resolve(server);
        });
    });
}
function middleware(list) {
    return function (req, res, next) {
        if (process.env.PUSH_STORE !== 's3') return next();
        var body = req.body,
            command,
            language = (req.headers['accept-language'] || 'en').split(',')[0].split('-')[0];
        try {
            if (req.method === 'POST') {
                var rows = list ? body : [body];
                if (!Array.isArray(rows) || rows.length > 256) throw new Error('Invalid push list');
                rows.forEach(require('./registry').validate);
                rows = rows.map(function (r) {
                    var row = Object.assign({}, r, { lang: language });
                    if (!row.uuid && req.headers['device-id']) row.uuid = req.headers['device-id'];
                    return row;
                });
                command = { op: 'upsert', rows: rows };
            } else if (req.method === 'PUT' && !list) {
                var old = body.oldToken || body.oldRegId,
                    newToken = body.newToken || body.newRegId;
                if (!old || !newToken) throw new Error('Invalid token update');
                command = {
                    op: 'rotate',
                    oldToken: old,
                    newToken: newToken,
                    kind: body.oldToken ? 'fcmToken' : 'registrationId',
                    product: body.package
                };
            } else if (req.method === 'DELETE' && !list) {
                if (!body || !(body.fcmToken || body.registrationId)) throw new Error('Invalid push token');
                if (body.category !== undefined && body.category !== 'alarm' && body.category !== 'alert')
                    throw new Error('Invalid push category');
                command = { op: 'remove', selector: body };
            } else return next();
        } catch (e) {
            return res.status(403).send(e.message);
        }
        request(process.env.PUSH_SOCKET_PATH, command).then(
            function (value) {
                if (req.method === 'POST' && !list) value = value[0];
                if (req.method === 'PUT') value = [value, value];
                if (req.method === 'DELETE') value = body.category ? [value] : [value, value];
                res.send(value);
            },
            function () {
                res.status(503).send('Push registration unavailable');
            }
        );
    };
}
module.exports = { request: request, listen: listen, middleware: middleware };
