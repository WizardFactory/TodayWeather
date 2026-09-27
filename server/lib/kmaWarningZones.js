/**
 * KMA warning zones (#2609): getPwnCd event replay and town-to-zone mapping.
 * Pure functions; the collector persists the state (models/modelKmaSpecialWeatherZone.js).
 *
 * Replay rules, checked against 60 days of getPwnCd rows on 2026-09-27:
 * - command 1 발표, 3 연장, 6 정정, 7 변경발표 → active with warnStress; 2 해제, 8 변경해제 → inactive.
 * - A release row with a nonzero allEndTime ends every warning of its zone (without this rule
 *   열대야 and 호우 releases are missed and zones stay active while t6 is "없음").
 * - cancel 1 rows are ignored; an event applies only if it is newer than the stored one, ordered by
 *   (tmFc, tmSeq, rank) with releases (rank 0) before issues (rank 1) of the same announcement.
 */

"use strict";

var fs = require('fs');
var path = require('path');

var ZONE_TABLE_FILE = path.join(__dirname, '../utils/data/kma_warning_zones.csv');
var ROOT_ZONE = 'L1000000';

// getPwnCd warnVar → situation weather code of models/modelKmaSpecialWeatherSituation.js
var WARN_VAR_WEATHER = {
    1: {weather: 1, weatherStr: '강풍'},
    2: {weather: 3, weatherStr: '호우'},
    3: {weather: 9, weatherStr: '한파'},
    4: {weather: 5, weatherStr: '건조'},
    5: {weather: 7, weatherStr: '폭풍해일'},
    6: {weather: 2, weatherStr: '풍랑'},
    7: {weather: 10, weatherStr: '태풍'},
    8: {weather: 4, weatherStr: '대설'},
    9: {weather: 11, weatherStr: '황사'},
    12: {weather: 12, weatherStr: '폭염'},
    13: {weather: 13, weatherStr: '열대야'}
};
var WARN_STRESS_LEVEL = {
    0: {level: 1, levelStr: '주의보'},
    1: {level: 2, levelStr: '경보'},
    2: {level: 4, levelStr: '중대경보'}
};
var ISSUE_COMMANDS = ['1', '3', '6', '7'];
var RELEASE_COMMANDS = ['2', '8'];

// Town region names that differ from the zone table's first-level names.
var PROVINCE_ALIASES = {
    '강원특별자치도': '강원도',
    '전북특별자치도': '전북자치도',
    '전라북도': '전북자치도',
    '제주특별자치도': '제주도'
};
// Island zones inside a city or county, matched on the town's city and town names.
var ISLAND_ZONES = [
    {second: '울릉', third: '', zone: '울릉도.독도'},
    {second: '신안', third: '흑산', zone: '흑산도.홍도'},
    {second: '제주시', third: '추자', zone: '추자도'},
    {second: '여수', third: '삼산', zone: '거문도.초도'},
    {second: '옹진', third: '백령', zone: '백령도.대청도'},
    {second: '옹진', third: '대청', zone: '백령도.대청도'},
    {second: '옹진', third: '연평', zone: '연평도.우도'}
];

var zoneTable = null;

function toNumber(value) {
    var n = Number(String(value === undefined || value === null ? '' : value).trim());
    return isNaN(n) ? 0 : n;
}

function toText(value) {
    return String(value === undefined || value === null ? '' : value).trim();
}

function baseName(name) {
    return name.replace(/\(.*\)\s*$/, '').trim();
}

/**
 * @param text kma_warning_zones.csv
 * @param nowStr YYYYMMDDHHmm KST; rows whose TM_ED is earlier are ignored
 */
function parseZoneTable(text, nowStr) {
    var table = {byId: {}, children: {}, firstLevel: []};
    text.split(/\r?\n/).forEach(function (line) {
        if (!line || line.charAt(0) === '#' || line.indexOf('REG_ID,') === 0) {
            return;
        }
        var f = line.split(',');
        if (f.length < 7 || (nowStr && f[2] < nowStr)) {
            return;
        }
        var zone = {id: f[0], up: f[4], ko: f[5], name: f[6]};
        table.byId[zone.id] = zone;
    });
    Object.keys(table.byId).forEach(function (id) {
        var zone = table.byId[id];
        (table.children[zone.up] = table.children[zone.up] || []).push(zone);
        if (zone.up === ROOT_ZONE) {
            table.firstLevel.push(zone);
        }
    });
    return table;
}

function getZoneTable() {
    if (!zoneTable) {
        var kst = new Date(Date.now() + 9*3600*1000).toISOString();
        var nowStr = kst.slice(0, 4) + kst.slice(5, 7) + kst.slice(8, 10) + kst.slice(11, 13) + kst.slice(14, 16);
        zoneTable = parseZoneTable(fs.readFileSync(ZONE_TABLE_FILE, 'utf8'), nowStr);
    }
    return zoneTable;
}

function descendants(table, zone, out) {
    (table.children[zone.id] || []).forEach(function (child) {
        out.push(child);
        descendants(table, child, out);
    });
    return out;
}

/**
 * Roots, their descendants and ancestors.
 */
function expand(table, roots) {
    var set = {};
    roots.forEach(function (root) {
        [root].concat(descendants(table, root, [])).forEach(function (zone) {
            set[zone.id] = true;
        });
        for (var up = table.byId[root.up]; up; up = table.byId[up.up]) {
            set[up.id] = true;
        }
    });
    return Object.keys(set);
}

/**
 * Warning zones of a town (decision 8): the city/county zone with its sub-zones and ancestors.
 * Split parents therefore over-warn; there is no 읍면동-level mapping.
 * @param {{first: string, second: string, third: string}} town
 * @returns {string[]} areaCodes
 */
function zonesForTown(town) {
    if (!town || !town.first) {
        return [];
    }
    var table = getZoneTable();
    var provinceName = PROVINCE_ALIASES[town.first] || town.first;
    var province = table.firstLevel.filter(function (zone) {
        return zone.name === provinceName;
    })[0];
    if (!province) {
        return [];
    }
    var second = town.second || '';
    var third = town.third || '';

    var island = ISLAND_ZONES.filter(function (rule) {
        return second.indexOf(rule.second) !== -1 && third.indexOf(rule.third) !== -1;
    })[0];
    if (island) {
        return expand(table, Object.keys(table.byId).map(function (id) {
            return table.byId[id];
        }).filter(function (zone) {
            return zone.name === island.zone;
        }));
    }

    if (second.length === 0) {
        return expand(table, [province]);
    }

    var subtree = descendants(table, province, []);
    var candidates = subtree.filter(function (zone) {
        var base = baseName(zone.name);
        return base === second || (/[시군구]$/.test(base) && second.indexOf(base) === 0);
    });
    candidates = candidates.filter(function (zone) {
        return !candidates.some(function (other) {
            return other !== zone && descendants(table, other, []).indexOf(zone) !== -1;
        });
    });
    if (candidates.length > 0) {
        return expand(table, candidates);
    }

    // Metropolitan district: the remainder zone named like the city (인천광역시), else every sub-zone
    // that is not a separate county or city (서울 4 권역, 부산 3 zones, 대구중부).
    var children = table.children[province.id] || [];
    var same = children.filter(function (zone) {
        return zone.name === province.name;
    });
    if (same.length > 0) {
        return expand(table, same);
    }
    var rest = children.filter(function (zone) {
        return !/[시군]$/.test(baseName(zone.name));
    });
    return expand(table, rest.length > 0 ? rest : [province]);
}

function zoneName(areaCode) {
    var zone = getZoneTable().byId[areaCode];
    return zone ? zone.name : undefined;
}

function weatherOf(warnVar) {
    return WARN_VAR_WEATHER[warnVar] || {weather: 0, weatherStr: ''};
}

function levelOf(warnStress) {
    return WARN_STRESS_LEVEL[warnStress] || {level: 0, levelStr: ''};
}

function stateKey(areaCode, warnVar) {
    return areaCode + '|' + warnVar;
}

function normalizeRow(row) {
    return {
        areaCode: toText(row.areaCode),
        areaName: toText(row.areaName),
        warnVar: toNumber(row.warnVar),
        warnStress: toNumber(row.warnStress),
        command: toText(row.command),
        cancel: toText(row.cancel) === '1',
        tmFc: toNumber(row.tmFc),
        tmSeq: toNumber(row.tmSeq),
        endTime: toNumber(row.endTime),
        allEndTime: toNumber(row.allEndTime)
    };
}

/**
 * Normalize, drop cancelled rows and duplicates (consecutive pages repeat boundary rows), sort ascending.
 * @param rows getPwnCd items in any order
 * @returns {Array} events
 */
function prepareEvents(rows) {
    var seen = {};
    var events = [];
    (rows || []).forEach(function (row) {
        var event = normalizeRow(row);
        if (!event.areaCode || !event.tmFc || event.cancel) {
            return;
        }
        var id = [event.areaCode, event.warnVar, event.tmFc, event.tmSeq, event.command, event.warnStress,
                  event.endTime, event.allEndTime].join('|');
        if (seen[id]) {
            return;
        }
        seen[id] = true;
        event.rank = ISSUE_COMMANDS.indexOf(event.command) !== -1 ? 1 : 0;
        events.push(event);
    });
    events.sort(function (a, b) {
        return a.tmFc - b.tmFc || a.tmSeq - b.tmSeq || a.rank - b.rank;
    });
    return events;
}

function isNewer(event, entry) {
    if (!entry) {
        return true;
    }
    return event.tmFc - entry.eventTmFc || event.tmSeq - entry.eventTmSeq || event.rank - entry.eventRank;
}

function entryFor(event, warnVar, active) {
    return {
        areaCode: event.areaCode,
        areaName: event.areaName,
        warnVar: warnVar,
        warnStress: event.warnStress,
        active: active,
        command: event.command,
        eventTmFc: event.tmFc,
        eventTmSeq: event.tmSeq,
        eventRank: event.rank
    };
}

/**
 * @param state {stateKey: entry}, modified in place
 * @param events prepareEvents() output
 * @returns {string[]} changed state keys
 */
function applyEvents(state, events) {
    var changed = [];
    function mark(key) {
        if (changed.indexOf(key) === -1) {
            changed.push(key);
        }
    }
    events.forEach(function (event) {
        var isIssue = ISSUE_COMMANDS.indexOf(event.command) !== -1;
        var isRelease = RELEASE_COMMANDS.indexOf(event.command) !== -1;
        if (!isIssue && !isRelease) {
            return;
        }
        var key = stateKey(event.areaCode, event.warnVar);
        var allClear = state[stateKey(event.areaCode, 0)];
        if (isNewer(event, state[key]) > 0) {
            // An issue older than the zone's latest all-clear is already over.
            state[key] = entryFor(event, event.warnVar, isIssue && isNewer(event, allClear) > 0);
            mark(key);
        }
        if (isRelease && event.allEndTime > 0) {
            var markerKey = stateKey(event.areaCode, 0);
            if (isNewer(event, state[markerKey]) > 0) {
                state[markerKey] = entryFor(event, 0, false);
                mark(markerKey);
            }
            Object.keys(state).forEach(function (other) {
                var entry = state[other];
                if (entry.areaCode === event.areaCode && entry.warnVar > 0 && entry.active && isNewer(event, entry) > 0) {
                    state[other] = entryFor(event, entry.warnVar, false);
                    state[other].areaName = entry.areaName;
                    state[other].warnStress = entry.warnStress;
                    mark(other);
                }
            });
        }
    });
    return changed;
}

/**
 * @param entries zone state documents
 * @param areaCodes zonesForTown() output
 * @returns {Array} [{weather, weatherStr, level, levelStr, locationName}], highest weather code first
 */
function specialInfoFor(entries, areaCodes) {
    var inTown = {};
    (areaCodes || []).forEach(function (code) {
        inTown[code] = true;
    });
    var seen = {};
    var list = [];
    (entries || []).forEach(function (entry) {
        if (!entry.active || !(entry.warnVar > 0) || !inTown[entry.areaCode]) {
            return;
        }
        var weather = weatherOf(entry.warnVar);
        var level = levelOf(entry.warnStress);
        var item = {weather: weather.weather, weatherStr: weather.weatherStr, level: level.level, levelStr: level.levelStr,
                    locationName: entry.areaName};
        var id = [item.weather, item.level, item.locationName].join('|');
        if (!seen[id]) {
            seen[id] = true;
            list.push(item);
        }
    });
    return list.sort(function (a, b) {
        if (a.weather !== b.weather) {
            return b.weather - a.weather;
        }
        if (a.level !== b.level) {
            return b.level - a.level;
        }
        return a.locationName < b.locationName ? -1 : (a.locationName > b.locationName ? 1 : 0);
    });
}

/**
 * Compare the active state with the national t6 text (logging only).
 * @returns {{active: number, none: boolean, missing: string[]}}
 */
function driftFromT6(entries, t6) {
    var compact = toText(t6).replace(/\s+/g, '');
    var none = compact.indexOf('없음') !== -1 && !/(주의보|경보)/.test(compact);
    var active = 0;
    var missing = [];
    (entries || []).forEach(function (entry) {
        if (!entry.active || !(entry.warnVar > 0)) {
            return;
        }
        active++;
        var name = weatherOf(entry.warnVar).weatherStr + levelOf(entry.warnStress).levelStr;
        if ((none || compact.indexOf(name) === -1) && missing.indexOf(name) === -1) {
            missing.push(name);
        }
    });
    return {active: active, none: none, missing: missing};
}

module.exports = {
    weatherOf: weatherOf,
    levelOf: levelOf,
    stateKey: stateKey,
    normalizeRow: normalizeRow,
    prepareEvents: prepareEvents,
    applyEvents: applyEvents,
    parseZoneTable: parseZoneTable,
    zonesForTown: zonesForTown,
    zoneName: zoneName,
    specialInfoFor: specialInfoFor,
    driftFromT6: driftFromT6
};
