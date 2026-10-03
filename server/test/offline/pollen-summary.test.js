'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const time = require('../../lib/kmaTimeLib');
function load(file, deps = {}) {
    const module = {exports: {}};
    const noop = () => {};
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8'), {
        module, exports: module.exports, Date, console,
        log: {info: noop, warn: noop, error: noop, debug: noop, silly: noop},
        require: name => deps[name] || function () {}
    }, {filename: file});
    return module.exports;
}
const Controller = load('controllers/lifeIndexKmaController.js', {'../lib/kmaTimeLib': time});
const Town = load('controllers/controllerTown.js', {'../controllers/lifeIndexKmaController': Controller});
const Requester = load('lib/lifeIndexKmaRequester.js', {'../lib/kmaTimeLib': time});

test('spring, autumn, low and absent pollen produce max grade and localized labels', () => {
    for (const [values, expected] of [
        [{flowerWoody: 2, flowerPine: 1}, 2], [{flowerWeeds: 1}, 1],
        [{flowerWeeds: 0}, 0], [{}, undefined]
    ]) {
        const day = {date: '20261003'};
        Controller._addIndexData2([day], Object.entries(values).map(([indexType, index]) =>
            ({indexType, index, date: time.convertStringToDate(day.date)})));
        const town = new Town();
        town._makeStrForKma(day, {__: key => 'translated:' + key});
        const current = {date: day.date};
        town._appendLifeIndexToCurrent(current, [], [day]);
        assert.equal(day.pollenGrade, expected);
        assert.equal(current.pollenGrade, expected);
        if (expected === undefined) {
            assert.equal('pollenStr' in day, false);
            assert.equal('pollenGrade' in current, false);
        } else {
            assert.equal(day.pollenStr, 'translated:' + ['LOC_LOW', 'LOC_NORMAL', 'LOC_HIGH'][expected]);
            assert.equal(current.pollenStr, day.pollenStr);
        }
        for (const type of ['flowerWoody', 'flowerPine', 'flowerWeeds']) {
            assert.equal(type in day, type in values);
            assert.equal(type + 'Grade' in day, type in values);
            assert.equal(type + 'Str' in day, type in values);
        }
    }
});

test('both publication hours use KST modulo 24 and next due times align to them', () => {
    const service = new Requester();
    for (let hour = 0; hour < 24; hour++) {
        const date = new Date(Date.UTC(2026, 9, 3, hour - 9));
        assert.equal(Requester.isPollenPublicationHour(date), hour === 6 || hour === 18);
    }
    assert.equal(service.nextPollenTime(new Date('2026-10-02T21:10:00Z')).toISOString(), '2026-10-03T09:10:00.000Z');
    assert.equal(service.nextPollenTime(new Date('2026-10-03T09:10:00Z')).toISOString(), '2026-10-03T21:10:00.000Z');
});

test('all V3 operations map current spec day fields, grades 0–3 and omit missing values', () => {
    const service = new Requester();
    for (const [type, operation] of Object.entries({flowerWoody: 'getOakPollenRiskIdxV3',
        flowerPine: 'getPinePollenRiskIdxV3', flowerWeeds: 'getWeedsPollenRiskndxV3'})) {
        const fixture = {areaNo: '1100000000', date: '2026100306', today: '0', tomorrow: '1',
            dayaftertomorrow: '2', todaysaftertomorrow: '3'};
        const rows = service.convertPollenItemsV3(type, [fixture]);
        assert.deepEqual(Array.from(rows, row => row.index), [0, 1, 2, 3]);
        assert.deepEqual(Array.from(rows, row => time.convertDateToYYYYMMDD(row.date)),
            ['20261003', '20261004', '20261005', '20261006']);
        assert.ok(rows.every(row => row.indexType === type));
        const url = new URL(service.getPollenUrlV3(type, '2026100306', 1, 'fixture'));
        assert.ok(url.pathname.endsWith(operation));
        assert.equal(url.searchParams.get('dataType'), 'JSON');
        assert.equal(url.searchParams.get('areaNo'), '');
        assert.equal(url.searchParams.get('time'), '2026100306');
        assert.equal(service.convertPollenItemsV3(type, [{...fixture, today: '', tomorrow: null,
            dayaftertomorrow: 'bad', todaysaftertomorrow: undefined}]).length, 0);
    }
});

test('all six client and server locales contain pollen risk and official type labels', () => {
    for (const folder of ['client/www/locales', 'server/locales']) {
        for (const locale of ['de', 'en', 'ja', 'ko', 'zh-CN', 'zh-TW']) {
            const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../..', folder, locale + '.json')));
            for (const key of ['LOC_POLLEN_RISK', 'LOC_POLLEN_OAK', 'LOC_POLLEN_PINE', 'LOC_POLLEN_WEEDS']) {
                assert.ok(data[key], folder + '/' + locale + ' missing ' + key);
            }
        }
    }
});
