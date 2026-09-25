'use strict';
var http = require('http');
var URL_SOURCE = 'http://www.weather.go.kr/cgi-bin/aws/nph-aws_txt_min';
// Built-in lookup only: never pin an IP or bypass hosts/TLS policy.
function request(options) {
    options = options || {};
    var signal = options.signal,
        transport = options.transport || http,
        url = options.url || URL_SOURCE;
    return new Promise(function (resolve, reject) {
        if (signal && signal.aborted) return reject(new Error('AWS_MINUTE_ABORTED'));
        var finished = false,
            req,
            timer;
        function done(error, result) {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', abort);
            if (error) reject(error);
            else resolve(result);
        }
        function abort() {
            if (req) req.destroy();
            done(new Error('AWS_MINUTE_ABORTED'));
        }
        timer = setTimeout(function () {
            if (req) req.destroy();
            done(new Error('AWS_MINUTE_TIMEOUT'));
        }, options.timeoutMs || 10000);
        if (signal) signal.addEventListener('abort', abort, { once: true });
        try {
            req = transport.get(
                url,
                { headers: { Accept: 'text/html', 'User-Agent': 'TodayWeather-AWS-Minute/1' } },
                function (res) {
                    var chunks = [],
                        bytes = 0;
                    res.on('data', function (chunk) {
                        bytes += chunk.length;
                        if (bytes > 2 * 1024 * 1024) {
                            res.destroy();
                            req.destroy();
                            done(new Error('AWS_MINUTE_BODY_LIMIT'));
                        } else chunks.push(chunk);
                    });
                    res.on('error', function () {
                        done(new Error('AWS_MINUTE_TRANSPORT'));
                    });
                    res.on('aborted', function () {
                        done(new Error('AWS_MINUTE_TRANSPORT'));
                    });
                    res.on('end', function () {
                        done(null, {
                            statusCode: res.statusCode,
                            headers: res.headers,
                            body: Buffer.concat(chunks),
                        });
                    });
                },
            );
            req.on('error', function () {
                done(new Error('AWS_MINUTE_TRANSPORT'));
            });
        } catch (e) {
            done(new Error('AWS_MINUTE_TRANSPORT'));
        }
    });
}
exports.fetch = async function (options) {
    options = options || {};
    for (var attempt = 0; attempt < 2; attempt++) {
        try {
            return await request(options);
        } catch (e) {
            if (
                attempt === 1 ||
                !/AWS_MINUTE_(TRANSPORT|TIMEOUT)$/.test(e.message) ||
                (options.signal && options.signal.aborted)
            )
                throw e;
        }
    }
};
exports.request = request;
