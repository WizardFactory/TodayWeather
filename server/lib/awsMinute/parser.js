'use strict';
var cheerio = require('cheerio');
var TextDecoder = require('util').TextDecoder;
var policy = require('./policy');
var columns = [
    'stnId',
    'stnName',
    'altitude',
    'rns',
    'rs15m',
    'rs1h',
    'rs3h',
    'rs6h',
    'rs12h',
    'rs1d',
    't1h',
    'vec1',
    'wdd1',
    'wsd1',
    'vec',
    'wdd',
    'wsd',
    'reh',
    'hPa',
    'addr',
];
function number(text) {
    return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) ? Number(text) : NaN;
}
exports.parse = function (response, now) {
    if (!response || response.statusCode !== 200) throw new Error('AWS_MINUTE_HTTP_STATUS');
    var type = String((response.headers || {})['content-type'] || '');
    if (!/^text\/html\b/i.test(type)) throw new Error('AWS_MINUTE_CONTENT_TYPE');
    var match = /charset\s*=\s*["']?([\w-]+)/i.exec(type),
        encoding = match ? match[1].toLowerCase() : 'euc-kr';
    if (['euc-kr', 'utf-8', 'utf8', 'ks_c_5601-1987'].indexOf(encoding) < 0)
        throw new Error('AWS_MINUTE_ENCODING');
    var body = response.body;
    if (!Buffer.isBuffer(body) || body.length === 0 || body.length > 2 * 1024 * 1024)
        throw new Error('AWS_MINUTE_BODY');
    var text;
    try {
        text = new TextDecoder(encoding === 'utf8' ? 'utf-8' : encoding, { fatal: true }).decode(
            body,
        );
    } catch (e) {
        throw new Error('AWS_MINUTE_ENCODING');
    }
    if ((text.match(/<\/table\s*>/gi) || []).length < 2) throw new Error('AWS_MINUTE_LAYOUT');
    var $ = cheerio.load(text),
        heading = $('.ehead').text().trim();
    if ($('.ehead').length !== 1) throw new Error('AWS_MINUTE_PUBLICATION');
    var pub = /(\d{4}\.\d{2}\.\d{2}\.\d{2}:\d{2})$/.exec(heading);
    var ms = pub && policy.instant(pub[1]);
    if (!pub || !policy.fresh(ms, now)) {
        var error = new Error('AWS_MINUTE_PUBLICATION');
        if (Number.isFinite(ms)) error.publication = new Date(ms).toISOString();
        throw error;
    }
    var rows = [],
        rejected = 0,
        seen = new Set(),
        table = $('table table');
    if (table.length !== 1) throw new Error('AWS_MINUTE_LAYOUT');
    var trs = table.find('tr');
    if (trs.length > 1001) throw new Error('AWS_MINUTE_TOO_MANY_ROWS');
    trs.each(function (index, tr) {
        var cells = $(tr).children('td');
        if (index === 0) return;
        if (cells.length !== columns.length) {
            rejected++;
            return;
        }
        var data = {};
        cells.each(function (i, td) {
            data[columns[i]] = $(td).text().trim();
        });
        var station = policy.stationId(data.stnId);
        if (!station || !data.stnName || data.stnName.length > 80) {
            rejected++;
            return;
        }
        if (seen.has(station)) throw new Error('AWS_MINUTE_DUPLICATE_STATION');
        seen.add(station);
        var values = {},
            rain = {};
        policy.fields.forEach(function (f) {
            var v = number(data[f]);
            if (policy.valid(f, v)) values[f] = v;
        });
        ['rs15m', 'rs1h', 'rs3h', 'rs6h', 'rs12h', 'rs1d'].forEach(function (f) {
            var v = number(data[f]);
            if (Number.isFinite(v) && v >= 0 && v <= 2000) rain[f] = v;
        });
        if (data.rns === '○') rain.rns = false;
        if (data.rns === '●') rain.rns = true;
        if (!Object.keys(values).length) {
            rejected++;
            return;
        }
        rows.push({
            _id: policy.id(station, ms),
            stationId: station,
            stationName: data.stnName,
            observedAt: new Date(ms),
            source: 'KMA_AWS_MINUTE',
            timeBasis: 'UTC',
            publicationKst: pub[1],
            values: values,
            rain: rain,
        });
    });
    if (!rows.length) throw new Error('AWS_MINUTE_EMPTY');
    return { observedAt: new Date(ms), accepted: rows.length, rejected: rejected, rows: rows };
};
