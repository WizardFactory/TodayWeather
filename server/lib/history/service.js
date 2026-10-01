'use strict';
var policy = require('./policy');
var Store = require('./store');
var Provider = require('./provider');
var Recovery = require('./recovery');
var config = require('../../config/config');
function settings() {
    return config.history || {};
}
function stations() {
    var value = settings().stations || [];
    return value
        .filter(function (id) {
            return policy.station(id) === id;
        })
        .slice(0, 200);
}
var ReadCache = require('./readCache');
var metadata = new ReadCache({ttl: 60000});
var snapshots = new ReadCache();
var legacy = new ReadCache();
exports.loadLegacyForTown = function (town, callback) {
    var coord = town && town.gCoord;
    if (!coord) return callback(null, []);
    var key = coord.lat + ',' + coord.lon + ':' + policy.key(Date.now(), true);
    legacy.read(key, function (done) {
        require('../../controllers/controllerKmaStnWeather').getCityHourlyList(town, done);
    }, callback);
};
exports.loadForTown = function (town, callback) {
    if (!settings().readEnabled) return callback(null, null);
    var ids = stations(), w = policy.window(), finished = false;
    var timer = setTimeout(function () {
        done({reason: 'cache-read-timeout', hourly: [], daily: []});
    }, 250);
    function done(data) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        callback(null, data);
    }
    if (!ids.length) return done({reason: 'stations-unconfigured', hourly: [], daily: []});
    metadata.read(ids.join(','), function (resolve) {
        require('../../models/modelKmaStnInfo')
            .find({stnId: {$in: ids}, isCityWeather: true}).maxTimeMS(2000).lean().exec(resolve);
    }, function (err, rows) {
        if (finished) return;
        if (err) return done({reason: 'station-read-failed', hourly: [], daily: []});
        var mapping = policy.nearest(town, rows, 100);
        if (!mapping) return done({reason: 'station-unavailable', hourly: [], daily: []});
        var key = mapping.stationId + ':' + w.start + ':' + w.end;
        snapshots.read(key, function (resolve) {
            var store;
            try { store = Store.create(); } catch (error) { return resolve(error); }
            Promise.all([
                store.read('hourly', mapping.stationId, w.start + '0000', w.end + '2300'),
                store.read('daily', mapping.stationId, w.start, w.end)
            ]).then(function (data) { resolve(null, {hourly: data[0], daily: data[1]}); }, resolve);
        }, function (error, data) {
            if (finished) return;
            if (error) return done({mapping: mapping, reason: 'cache-read-failed', hourly: [], daily: []});
            done({mapping: mapping, hourly: data.hourly, daily: data.daily});
        });
    });
};
exports.mergeHourly = function (req, data) {
    if (!data) return;
    req._history = data;
    policy.mergeHourly(req, data.hourly);
};
exports.mergeDaily = function (req) {
    if (!req._history) return;
    policy.mergeDaily(req, req._history.daily);
    req.historyStatus = policy.status(req);
    req.historyStatus.mapping = req._history.mapping;
    req.historyStatus.reason = req._history.reason;
};
var running = false,
    nextStation = 0;
exports.scheduled = function (callback) {
    if (!settings().enabled || running) return callback();
    var ids = stations();
    if (!ids.length || !settings().key) return callback(new Error('HISTORY_CONFIGURATION'));
    running = true;
    var w = policy.window(),
        recovery;
    try {
        recovery = new Recovery(Store.create(), new Provider({ key: settings().key }));
    } catch (e) {
        running = false;
        return callback(new Error('HISTORY_DB_UNAVAILABLE'));
    }
    var cursor = 0,
        reports = [],
        offset = nextStation,
        deadline = Date.now() + 5 * 60000;
    async function worker() {
        while (cursor < ids.length && Date.now() < deadline) {
            var index = (offset + cursor++) % ids.length;
            nextStation = (index + 1) % ids.length;
            var id = ids[index];
            try {
                reports.push(await recovery.run(id, w.start, w.end));
            } catch (e) {
                reports.push({ stationId: id, complete: false, reason: 'recovery-failed' });
            }
        }
    }
    Promise.all([worker(), worker()]).then(
        function () {
            running = false;
            if (cursor < ids.length)
                reports.push({
                    complete: false,
                    reason: 'schedule-budget',
                    remainingStations: ids.length - cursor
                });
            callback(null, reports);
        },
        function () {
            running = false;
            callback(new Error('HISTORY_RECOVERY_FAILED'));
        }
    );
};
exports.policy = policy;
