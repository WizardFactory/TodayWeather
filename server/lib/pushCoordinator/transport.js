'use strict';
// One HTTP v1 attempt per admission: no hidden SDK messaging retries or unbounded sockets.
var https = require('https'),
    http = require('http');
function create(options) {
    options = options || {};
    var endpoint = new URL(options.endpoint || 'https://fcm.googleapis.com');
    var protocol = endpoint.protocol === 'https:' ? https : http;
    var agent = new protocol.Agent({
        keepAlive: true,
        maxSockets: options.concurrency || 128,
        maxFreeSockets: 16
    });
    return {
        send: function (payload) {
            return new Promise(function (resolve, reject) {
                var r = payload.record,
                    message = {
                        notification: {
                            title: String(payload.notification.title || ''),
                            body: String(payload.notification.text || payload.notification.body || '')
                        },
                        data: { cityIndex: String(r.cityIndex), eventId: payload.eventId },
                        token: r.fcmToken,
                        android: { ttl: '300s', priority: payload.urgent ? 'HIGH' : 'NORMAL' },
                        apns: { headers: { 'apns-expiration': String(Math.floor(Date.now() / 1000) + 300) } }
                    };
                var body = JSON.stringify({ message: message }),
                    done = false,
                    timer;
                function finish(err, value) {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    if (err) reject(err);
                    else resolve(value);
                }
                var req = protocol.request(
                    {
                        hostname: endpoint.hostname,
                        port: endpoint.port || undefined,
                        path:
                            '/v1/projects/' +
                            encodeURIComponent(payload.authorization.projectId) +
                            '/messages:send',
                        method: 'POST',
                        agent: agent,
                        headers: {
                            authorization: 'Bearer ' + payload.authorization.token,
                            'content-type': 'application/json',
                            'content-length': Buffer.byteLength(body)
                        }
                    },
                    function (res) {
                        var chunks = '',
                            size = 0;
                        res.on('data', function (c) {
                            size += c.length;
                            if (size > 65536) {
                                req.destroy(new Error('Invalid FCM response'));
                                return;
                            }
                            chunks += c;
                        });
                        res.on('error', function () {
                            finish(new Error('FCM response interrupted'));
                        });
                        res.on('end', function () {
                            var data;
                            try {
                                data = JSON.parse(chunks);
                            } catch (e) {
                                data = {};
                            }
                            if (res.statusCode >= 200 && res.statusCode < 300 && data.name)
                                return finish(null, data.name);
                            var error = new Error('FCM submission failed');
                            error.statusCode = res.statusCode;
                            var details = (data.error && data.error.details) || [];
                            if (
                                details.some(function (d) {
                                    return (
                                        /google.firebase.fcm.v1.FcmError$/.test(d['@type'] || '') &&
                                        d.errorCode === 'UNREGISTERED'
                                    );
                                })
                            )
                                error.code = 'messaging/registration-token-not-registered';
                            var after = res.headers['retry-after'];
                            if (after) {
                                var ms = /^\d+$/.test(after)
                                    ? Number(after) * 1000
                                    : Date.parse(after) - Date.now();
                                if (Number.isFinite(ms)) error.retryAfterMs = Math.max(0, ms);
                            }
                            finish(error);
                        });
                    }
                );
                req.on('error', function () {
                    finish(new Error('FCM transport failed; result may be ambiguous'));
                });
                // Total timeout includes connection/TLS/response. Abort the request, never retry an ambiguous timeout.
                timer = setTimeout(function () {
                    req.destroy(new Error('FCM timeout'));
                }, options.timeoutMs || 15000);
                req.end(body);
            });
        },
        close: function () {
            agent.destroy();
        }
    };
}
module.exports = { create: create };
