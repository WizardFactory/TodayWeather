/**
 * data.go.kr 기상특보 조회서비스 (WthrWrnInfoService) client (#2609).
 *
 * Observed on 2026-09-27: every operation answers JSON with resultCode 00; a fromTmFc more than 6 days
 * back (60 days for getPwnCd) answers resultCode 99; getPwnCd pages come newest first, repeat
 * boundary rows and report a totalCount unrelated to the row count, so paging stops at a short page.
 * Stored keys are already percent-encoded; encoding them again makes the gateway answer 403 code 30.
 */

"use strict";

var req = require('request');
var config = require('../config/config');

var BASE_URL = 'http://apis.data.go.kr/1360000/WthrWrnInfoService/';
var PAGE_ROWS = 1000;
var MAX_PAGES = 20;
var TIMEOUT_MS = 30*1000;
// data.go.kr gateway codes: 20 access denied, 30 unregistered key, 31 expired key, 32 unregistered IP;
// 22 is the daily request limit (#2604: never retried within the cycle).
var AUTH_CODES = ['20', '30', '31', '32'];
var QUOTA_CODE = '22';

/**
 * Candidate keys in the #2587 order; unset defaults ('You have to set ...', '["key1","key2"]') are skipped.
 * @param keyBox config.keyString
 * @returns {string[]}
 */
function candidateKeys(keyBox) {
    var list = [];
    if (!keyBox) {
        return list;
    }
    var candidates = [keyBox.normal, keyBox.test_normal];
    try {
        candidates = candidates.concat(JSON.parse(keyBox.dongnae_forecast_keys || '[]'));
    }
    catch (err) {
        log.warn('kma warning: invalid forecast key list');
    }
    candidates.forEach(function (key) {
        if (typeof key === 'string' && key.length >= 20 && key.indexOf('You have to set') !== 0 && list.indexOf(key) === -1) {
            list.push(key);
        }
    });
    return list;
}

function encodeKey(key) {
    try {
        return encodeURIComponent(decodeURIComponent(key));
    }
    catch (err) {
        return encodeURIComponent(key);
    }
}

/**
 * @param options {keys?: string[], request?: function, baseUrl?: string} baseUrl is for local smoke servers
 * @constructor
 */
function KmaWarningRequester(options) {
    options = options || {};
    this.keys = options.keys || candidateKeys(config.keyString);
    this.request = options.request || req;
    this.baseUrl = options.baseUrl || BASE_URL;
    this.keyIndex = 0;
}

KmaWarningRequester.candidateKeys = candidateKeys;

KmaWarningRequester.prototype.buildUrl = function (operation, params, key) {
    var query = ['serviceKey=' + encodeKey(key || ''), 'dataType=JSON'];
    var merged = Object.assign({pageNo: 1, numOfRows: 10}, params);
    Object.keys(merged).forEach(function (name) {
        if (merged[name] !== undefined && merged[name] !== null) {
            query.push(name + '=' + encodeURIComponent(merged[name]));
        }
    });
    return this.baseUrl + operation + '?' + query.join('&');
};

function makeError(operation, message, fields) {
    var err = new Error('kma warning ' + operation + ' ' + message);
    Object.keys(fields || {}).forEach(function (name) {
        err[name] = fields[name];
    });
    err.operation = operation;
    return err;
}

function codeError(operation, code, statusCode, message) {
    return makeError(operation, 'code=' + code + (statusCode ? ' status=' + statusCode : '') + (message ? ' ' + message : ''), {
        returnCode: code,
        statusCode: statusCode,
        isAuthError: AUTH_CODES.indexOf(code) !== -1 || statusCode === 401 || statusCode === 403,
        isQuotaError: code === QUOTA_CODE || statusCode === 429
    });
}

/**
 * @returns {{items: Array}|{noData: boolean}|{error: Error}}
 */
KmaWarningRequester.prototype.classify = function (operation, statusCode, body) {
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        }
        catch (e) {
            // The gateway can answer XML even when JSON is requested.
            var match = /<(returnReasonCode|resultCode)>\s*(\d+)\s*</.exec(body);
            if (match && match[2] === '03') {
                return {noData: true};
            }
            if (match) {
                return {error: codeError(operation, match[2], statusCode)};
            }
            return {error: codeError(operation, 'unparsed', statusCode)};
        }
    }
    if (body && body.OpenAPI_ServiceResponse && body.OpenAPI_ServiceResponse.cmmMsgHeader) {
        var gateway = body.OpenAPI_ServiceResponse.cmmMsgHeader;
        return {error: codeError(operation, String(gateway.returnReasonCode), statusCode, gateway.errMsg)};
    }
    if (!body || !body.response || !body.response.header) {
        return {error: codeError(operation, 'noheader', statusCode)};
    }
    var resultCode = String(body.response.header.resultCode);
    if (resultCode === '03') {
        return {noData: true};
    }
    if (resultCode !== '00' && resultCode !== '0') {
        return {error: codeError(operation, resultCode, statusCode, body.response.header.resultMsg)};
    }
    if (statusCode >= 400) {
        return {error: codeError(operation, 'http', statusCode)};
    }
    var items = body.response.body && body.response.body.items && body.response.body.items.item;
    if (items === undefined || items === null || items === '') {
        return {noData: true};
    }
    if (!Array.isArray(items)) {
        items = [items];
    }
    return items.length > 0 ? {items: items} : {noData: true};
};

/**
 * One page. An authorization error moves to the next key once around the list; nothing else is retried.
 * @param operation e.g. getPwnStatus
 * @param params query parameters without serviceKey/dataType
 * @param callback (err, {items}|{noData: true})
 */
KmaWarningRequester.prototype.get = function (operation, params, callback) {
    var self = this;
    var keyCount = Math.max(self.keys.length, 1);
    var start = self.keyIndex % keyCount;
    var offset = 0;

    function attempt() {
        var index = (start + offset) % keyCount;
        self.request(self.buildUrl(operation, params, self.keys[index]), {timeout: TIMEOUT_MS, json: true},
            function (err, response, body) {
                if (err) {
                    return callback(makeError(operation, err.code || err.message, {cause: err.message}));
                }
                var result = self.classify(operation, response.statusCode, body);
                if (result.error) {
                    if (result.error.isAuthError && !result.error.isQuotaError && offset + 1 < keyCount) {
                        offset++;
                        return attempt();
                    }
                    return callback(result.error);
                }
                if (index !== self.keyIndex) {
                    log.warn('kma warning service key changed index=' + index);
                    self.keyIndex = index;
                }
                callback(null, result);
            });
    }
    attempt();
};

/**
 * Every page until a page shorter than numOfRows (totalCount is unreliable).
 * @param pageRows optional numOfRows (default 1000); a full page is logged because further pages can
 *        repeat or drop rows (getPwnCd, 2026-09-27)
 * @param callback (err, items) items is [] when there is no data
 */
KmaWarningRequester.prototype.getAll = function (operation, params, pageRows, callback) {
    var self = this;
    var rows = [];
    if (typeof pageRows === 'function') {
        callback = pageRows;
        pageRows = PAGE_ROWS;
    }

    function next(pageNo) {
        var query = Object.assign({}, params, {pageNo: pageNo, numOfRows: pageRows});
        self.get(operation, query, function (err, result) {
            if (err) {
                err.message += ' page=' + pageNo;
                return callback(err);
            }
            if (result.noData) {
                return callback(null, rows);
            }
            rows = rows.concat(result.items);
            if (result.items.length < pageRows) {
                return callback(null, rows);
            }
            log.error('kma warning ' + operation + ' page ' + pageNo + ' is full (' + pageRows + ' rows); requesting the next page');
            if (pageNo >= MAX_PAGES) {
                return callback(makeError(operation, 'more than ' + MAX_PAGES + ' pages'));
            }
            next(pageNo + 1);
        });
    }
    next(1);
};

module.exports = KmaWarningRequester;
