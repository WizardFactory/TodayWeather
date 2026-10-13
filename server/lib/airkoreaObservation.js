/** Supported AirKorea (B552584) API client. No application startup or storage side effects. */
'use strict';
var https = require('https');
var URL = require('url').URL;
var STATION = 'getCtprvnRltmMesureDnsty';
var SIDO = 'getCtprvnMesureSidoLIst';
var STATION_LIST = 'getMsrstnList';
var FORECAST = 'getMinuDustFrcstDspth';
var NEARBY = 'getNearbyMsrstnList';
var BASE = 'https://apis.data.go.kr/B552584/';
// Every operation is paged (provider default 10 rows) and must return every page. The forecast document
// says date searches ignore paging, but on 2026-10-13 the provider returned 10 of 28 items without numOfRows.
var OPERATIONS = {};
OPERATIONS[STATION] = {service: 'ArpltnInforInqireSvc', params: {ver: '1.3'}};
OPERATIONS[SIDO] = {service: 'ArpltnStatsSvc', params: {searchCondition: 'HOUR'}};
// Without ver, dmX is latitude and dmY longitude: the order parseMsrstnList expects.
OPERATIONS[STATION_LIST] = {service: 'MsrstnInfoInqireSvc', params: {}};
// ver 1.1 adds model images 7-9.
OPERATIONS[FORECAST] = {service: 'ArpltnInforInqireSvc', params: {ver: '1.1'}};
OPERATIONS[NEARBY] = {service: 'MsrstnInfoInqireSvc', params: {ver: '1.1'}};
// The provider rejected the credential itself (access denied, not registered, expired, unregistered IP).
// Quota (22) is deliberately absent: switching keys must not bypass a quota.
var INVALID_CREDENTIAL = ['PROVIDER_20', 'PROVIDER_30', 'PROVIDER_31', 'PROVIDER_32',
    'HTTP_401', 'HTTP_403', 'NO_KEY', 'INVALID_KEY_ENCODING'];
var VALUES = ['so2Value', 'coValue', 'o3Value', 'no2Value', 'pm10Value', 'pm25Value',
    'pm10Value24', 'pm25Value24', 'khaiValue'];

function failure(code, retryable) {
    var err = new Error('AirKorea ' + code);
    err.code = code;
    err.retryable = !!retryable;
    return err;
}
function keyValue(key) {
    if (typeof key !== 'string' || !key.trim() || /^key\d+$/i.test(key.trim())) {
        throw failure('NO_KEY');
    }
    try { return decodeURIComponent(key.trim()); }
    catch (_) { throw failure('INVALID_KEY_ENCODING'); }
}
function operationUrl(operation, key, params, base) {
    var spec = Object.prototype.hasOwnProperty.call(OPERATIONS, operation) ? OPERATIONS[operation] : null;
    if (!spec) { throw failure('INVALID_OPERATION'); }
    var url = new URL((base || BASE) + spec.service + '/' + operation);
    url.searchParams.set('serviceKey', keyValue(key));
    url.searchParams.set('returnType', 'json');
    [params, spec.params].forEach(function (values) {
        Object.keys(values || {}).forEach(function (name) { url.searchParams.set(name, values[name]); });
    });
    return url.toString();
}
function buildUrl(sido, key, operation, page, pageSize, base) {
    if (operation !== STATION && operation !== SIDO) { throw failure('INVALID_OPERATION'); }
    return operationUrl(operation, key, {sidoName: sido, pageNo: page || 1, numOfRows: pageSize || 100}, base);
}
// Only a small code allowlist can enter logs/errors; no provider message/body/URL.
function gatewayCode(text) {
    var code = /<(?:returnReasonCode|resultCode)>\s*(20|22|29|30|31|32)\s*<\//.exec(text) ||
        /"returnReasonCode"\s*:\s*"?(20|22|29|30|31|32)"?/.exec(text);
    if (code) { return 'PROVIDER_' + code[1]; }
    if (/DEADLINE_HAS_EXPIRED_ERROR/.test(text)) { return 'PROVIDER_31'; }
    if (/SERVICE_KEY_IS_NOT_REGISTERED_ERROR/.test(text)) { return 'PROVIDER_30'; }
    return null;
}
function kstInstant(value) {
    if (typeof value !== 'string') { return NaN; }
    var p = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value);
    if (!p) { return NaN; }
    var h = Number(p[4]), m = Number(p[5]);
    var d = new Date(value.slice(0, 10) + 'T00:00:00Z');
    if (!isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value.slice(0, 10) ||
        h > 24 || m > 59 || (h === 24 && m !== 0)) { return NaN; }
    return d.getTime() + (h - 9) * 3600000 + m * 60000;
}
function number(value) {
    if (typeof value !== 'number' && typeof value !== 'string') { return undefined; }
    if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim())) { return undefined; }
    var n = Number(value);
    return isFinite(n) && n >= 0 ? n : undefined;
}
function parseRows(data, operation, keys) {
    var rows = data && data.list;
    if (!Array.isArray(rows) || rows.length === 0) { throw failure('EMPTY_ITEMS'); }
    var unavailable = [];
    var output = [], seen = {};
    rows.forEach(function (item) {
        var station = operation === STATION;
        var identity = station ? item && item.stationName : item && item.cityName;
        var ms = kstInstant(item && item.dataTime);
        if (!item || typeof identity !== 'string' || !identity.trim() || !isFinite(ms) ||
            (!station && (typeof item.sidoName !== 'string' || !item.sidoName.trim())) ||
            (data.parm && item.sidoName && item.sidoName !== data.parm.sidoName)) {
            throw failure('INVALID_OBSERVATION');
        }
        var id = identity + '@' + ms;
        if (seen[id]) { throw failure('DUPLICATE_OBSERVATION'); }
        seen[id] = true;
        var row = {date: new Date(ms)};
        keys.forEach(function (name) {
            if (!Object.prototype.hasOwnProperty.call(item, name)) { return; }
            if (['stationName', 'mangName', 'dataTime', 'sidoName', 'cityName', 'cityNameEng'].indexOf(name) !== -1) {
                if (typeof item[name] === 'string') { row[name] = item[name]; }
            } else {
                var n = number(item[name]);
                if (n !== undefined && (name.indexOf('Grade') === -1 || (n >= 1 && n <= 4 && n % 1 === 0))) {
                    row[name] = n;
                }
            }
        });
        if (!VALUES.some(function (name) { return row[name] !== undefined; })) {
            unavailable.push(identity); return;
        }
        if (station) {
            ['pm10', 'pm25'].forEach(function (p) {
                if (row[p + 'Grade'] !== undefined) { row[p + 'Grade24'] = row[p + 'Grade']; }
                delete row[p + 'Grade'];
                if (row[p + 'Grade1h'] !== undefined) { row[p + 'Grade'] = row[p + 'Grade1h']; }
                delete row[p + 'Grade1h'];
            });
        } else { row.sidocityName = row.sidoName + '/' + row.cityName; }
        output.push(row);
    });
    if (!output.length) { throw failure('NO_USABLE_OBSERVATIONS'); }
    // Non-enumerable metadata does not enter documents or JSON snapshots.
    Object.defineProperty(output, 'unavailable', {value: unavailable});
    return output;
}
function itemsBody(payload) {
    if (!payload || typeof payload !== 'object' || !payload.response || !payload.response.header) {
        throw failure('INVALID_ENVELOPE');
    }
    var code = String(payload.response.header.resultCode);
    if (code !== '00') {
        // Only a small code allowlist can enter logs/errors; no provider message/body/URL.
        throw failure(['01','03','05','10','12','20','22','23','29','30','31','32','99'].indexOf(code) !== -1 ? 'PROVIDER_' + code : 'PROVIDER_ERROR');
    }
    var body = payload.response.body;
    if (!body || !Array.isArray(body.items)) { throw failure('INVALID_ITEMS'); }
    // Some operations echo request parameters per item; credentials must not reach storage or archives.
    body.items.forEach(function (item) {
        if (item && typeof item === 'object') { delete item.serviceKey; }
    });
    return body;
}
function envelope(payload, page, size) {
    var body = itemsBody(payload);
    var total = Number(body.totalCount), actualPage = Number(body.pageNo), actualSize = Number(body.numOfRows);
    if (!/^\d+$/.test(String(body.totalCount)) || total > 2000 || actualPage !== page || actualSize !== size ||
        body.items.length !== Math.min(size, Math.max(0, total - (page - 1) * size))) {
        throw failure('INCOMPLETE_PAGE');
    }
    return body;
}
function create(options) {
    options = options || {};
    var transport = options.transport || https;
    var timeoutMs = options.timeoutMs || 5000;
    var size = options.pageSize || 100;
    var maxPages = options.maxPages || 20;
    var maxBytes = options.maxBytes || 2 * 1024 * 1024;
    function attempt(url, remainingMs, cb) {
        var done = false, request, response, timer;
        function finish(err, body) {
            if (done) { return; }
            done = true; clearTimeout(timer);
            if (err) {
                if (response && response.destroy) { response.destroy(); }
                if (request && request.destroy) { request.destroy(); }
            }
            cb(err, body);
        }
        timer = setTimeout(function () { finish(failure('TIMEOUT', true)); }, Math.max(1, Math.min(timeoutMs, remainingMs)));
        try {
            request = transport.get(url, {headers: {Accept: 'application/json'}}, function (res) {
                response = res;
                if (done) { res.destroy(); return; }
                var status = Number(res.statusCode) || 0;
                // 401/403 bodies tell an expired key from an unregistered one; other statuses stay generic.
                var classify = status === 401 || status === 403;
                if (status !== 200 && !classify) {
                    return finish(failure('HTTP_' + status, status >= 500 && status <= 599));
                }
                var chunks = [], bytes = 0;
                res.on('data', function (chunk) {
                    if (done) { return; }
                    bytes += chunk.length;
                    if (bytes > maxBytes) { return finish(failure('BODY_TOO_LARGE')); }
                    chunks.push(chunk);
                });
                res.on('error', function () { finish(failure('RESPONSE_ERROR', true)); });
                res.on('aborted', function () { finish(failure('RESPONSE_ABORTED', true)); });
                res.on('end', function () {
                    if (done) { return; }
                    var text = Buffer.concat(chunks).toString('utf8');
                    if (classify) { return finish(failure(gatewayCode(text) || 'HTTP_' + status)); }
                    var body;
                    try { body = JSON.parse(text); }
                    catch (_) { return finish(failure(gatewayCode(text) || 'INVALID_JSON')); }
                    if (body && body.OpenAPI_ServiceResponse) {
                        return finish(failure(gatewayCode(text) || 'PROVIDER_ERROR'));
                    }
                    finish(null, body);
                });
            });
            request.on('error', function (err) {
                finish(failure('TRANSPORT_ERROR', ['ECONNRESET','ETIMEDOUT','EPIPE','EAI_AGAIN'].indexOf(err.code) !== -1));
            });
        } catch (_) { finish(failure('REQUEST_ERROR')); }
    }
    function query(operation, key, params, cb) {
        var spec = Object.prototype.hasOwnProperty.call(OPERATIONS, operation) ? OPERATIONS[operation] : null;
        if (!spec) { return cb(failure('INVALID_OPERATION')); }
        var all = [], page = 1, total, calls = 0, deadline = Date.now() + (options.budgetMs || 30000);
        function next() {
            if (page > maxPages || Date.now() >= deadline) { return cb(failure('COLLECTION_LIMIT')); }
            var url;
            try { url = operationUrl(operation, key, Object.assign({}, params, {pageNo: page, numOfRows: size}), options.base); }
            catch (err) { return cb(err); }
            function request(retry) {
                if (Date.now() >= deadline) { return cb(failure('COLLECTION_LIMIT')); }
                calls++;
                attempt(url, deadline - Date.now(), function (err, payload) {
                    if (err) {
                        if (err.retryable && retry < 1) { return request(retry + 1); }
                        return cb(err);
                    }
                    var body;
                    try { body = envelope(payload, page, size); }
                    catch (e) { return cb(e); }
                    if (total !== undefined && total !== Number(body.totalCount)) { return cb(failure('CHANGED_TOTAL')); }
                    total = Number(body.totalCount);
                    all = all.concat(body.items);
                    if (all.length < total) { page++; return next(); }
                    if (!all.length) { return cb(failure('EMPTY_ITEMS')); }
                    cb(null, {list: all, calls: calls});
                });
            }
            request(0);
        }
        next();
    }
    function fetch(sido, key, operation, cb) {
        if (operation !== STATION && operation !== SIDO) { return cb(failure('INVALID_OPERATION')); }
        query(operation, key, {sidoName: sido}, function (err, result) {
            if (err) { return cb(err); }
            result.parm = {sidoName: sido};
            cb(null, result);
        });
    }
    // Index of the last key that produced a valid response; tried first next time.
    var preferred = -1;
    function withKeys(keys, operation, run, cb) {
        if (!Array.isArray(keys) || !keys.length) { return cb(failure('NO_KEY')); }
        var index = preferred >= 0 && preferred < keys.length ? preferred : keys.length - 1;
        var rejected = [];
        (function attemptKey() {
            var current = index;
            run(keys[current], function (err, result) {
                if (err && INVALID_CREDENTIAL.indexOf(err.code) !== -1) {
                    rejected.push(err.code);
                    if (options.onKeyRejected) { options.onKeyRejected(operation, current, err.code); }
                    if (rejected.length >= keys.length) {
                        var none = failure('NO_VALID_KEY');
                        none.rejected = rejected;
                        return cb(none);
                    }
                    index = (current - 1 + keys.length) % keys.length;
                    return attemptKey();
                }
                if (!err) { preferred = current; }
                cb(err, result);
            });
        })();
    }
    function fetchWithKeys(keys, sido, operation, cb) {
        withKeys(keys, operation, function (key, done) { fetch(sido, key, operation, done); }, cb);
    }
    function queryWithKeys(keys, operation, params, cb) {
        withKeys(keys, operation, function (key, done) { query(operation, key, params, done); }, cb);
    }
    return {fetch: fetch, query: query, fetchWithKeys: fetchWithKeys, queryWithKeys: queryWithKeys};
}
module.exports = {create: create, buildUrl: buildUrl, parseRows: parseRows, kstInstant: kstInstant,
    failure: failure, STATION: STATION, SIDO: SIDO, STATION_LIST: STATION_LIST, FORECAST: FORECAST, NEARBY: NEARBY};
