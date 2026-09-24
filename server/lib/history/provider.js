'use strict';
var https = require('https');
var policy = require('./policy');
function Provider(options) {
    options = options || {};
    this.key = options.key;
    this.transport = options.transport || https;
    this.base = options.base || 'https://apis.data.go.kr/1360000/';
    this.sleep =
        options.sleep ||
        function (ms) {
            return new Promise(function (resolve) {
                setTimeout(resolve, ms);
            });
        };
    this.timeout = 10000;
    this.maxPages = 8;
    this.pageSize = 999;
}
Provider.prototype.page = function (kind, station, range, pageNo) {
    var self = this;
    if (!self.key) return Promise.reject(new Error('ASOS_KEY_MISSING'));
    var key = self.key;
    try {
        key = decodeURIComponent(key);
    } catch (e) {
        return Promise.reject(new Error('ASOS_KEY_ENCODING'));
    }
    var params = {
        serviceKey: key,
        dataType: 'JSON',
        dataCd: 'ASOS',
        dateCd: kind === 'hourly' ? 'HR' : 'DAY',
        stnIds: station,
        startDt: range.start.slice(0, 8),
        endDt: range.end.slice(0, 8),
        pageNo: pageNo,
        numOfRows: self.pageSize
    };
    if (kind === 'hourly') {
        params.startHh = range.start.slice(8, 10);
        params.endHh = range.end.slice(8, 10);
    }
    var url =
        self.base +
        (kind === 'hourly' ? 'AsosHourlyInfoService' : 'AsosDalyInfoService') +
        '/getWthrDataList?' +
        Object.keys(params)
            .map(function (k) {
                return k + '=' + encodeURIComponent(params[k]);
            })
            .join('&');
    function attempt(n) {
        return new Promise(function (resolve, reject) {
            var settled = false,
                request;
            var timer = setTimeout(function () {
                finish(new Error('ASOS_TIMEOUT'));
                if (request) request.destroy();
            }, self.timeout);
            function finish(error, body) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (error) reject(error);
                else resolve(body);
            }
            request = self.transport.get(url, function (response) {
                var chunks = [],
                    size = 0;
                response.on('data', function (chunk) {
                    size += chunk.length;
                    if (size > 2 * 1024 * 1024) {
                        response.destroy();
                        finish(new Error('ASOS_RESPONSE_TOO_LARGE'));
                    } else chunks.push(chunk);
                });
                response.on('error', function () {
                    finish(new Error('ASOS_NETWORK'));
                });
                response.on('end', function () {
                    if (response.statusCode !== 200)
                        return finish(new Error('ASOS_HTTP_' + response.statusCode));
                    var body;
                    try {
                        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    } catch (e) {
                        return finish(new Error('ASOS_INVALID_JSON'));
                    }
                    finish(null, body);
                });
            });

            request.on('error', function () {
                finish(new Error('ASOS_NETWORK'));
            });
        }).catch(function (err) {
            if (n < 2 && /ASOS_(?:NETWORK|TIMEOUT|HTTP_(?:429|5\d\d))$/.test(err.message))
                return self.sleep(250 * Math.pow(2, n)).then(function () {
                    return attempt(n + 1);
                });
            throw err; // Only sanitized errors; never return request objects or key-bearing URLs.
        });
    }
    return attempt(0);
};
Provider.prototype.fetch = async function (kind, station, range) {
    var result = [],
        total,
        seenPages = {};
    for (var page = 1; page <= this.maxPages; page++) {
        var envelope = await this.page(kind, station, range, page),
            response = envelope && envelope.response;
        if (!response || !response.header || String(response.header.resultCode) !== '00')
            throw new Error('ASOS_PROVIDER_REJECTED');
        var body = response.body;
        if (!body) throw new Error('ASOS_INVALID_ENVELOPE');
        var count = policy.number(body.totalCount),
            actualPage = policy.number(body.pageNo),
            size = policy.number(body.numOfRows);
        if (
            !Number.isInteger(count) ||
            count < 0 ||
            count > this.maxPages * this.pageSize ||
            actualPage !== page ||
            size !== this.pageSize ||
            (total !== undefined && total !== count)
        )
            throw new Error('ASOS_INVALID_PAGINATION');
        total = count;
        var items = (body.items && body.items.item) || [];
        if (!Array.isArray(items)) items = [items];
        if (items.length !== Math.min(this.pageSize, Math.max(0, total - result.length)))
            throw new Error('ASOS_TRUNCATED_PAGE');
        var signature = JSON.stringify(items);
        if (items.length && seenPages[signature]) throw new Error('ASOS_REPEATED_PAGE');
        seenPages[signature] = true;
        result = result.concat(items);
        if (result.length === total) return result;
    }
    throw new Error('ASOS_PAGE_LIMIT');
};
module.exports = Provider;
