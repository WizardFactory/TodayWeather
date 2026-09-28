/**
 * Push registrations in MongoDB (`pushes`, `alertpushes`): the default store and the rollback path for #2626.
 * The queries were moved here from controllerPush.js and alert.push.controller.js. Token changes and FCM disabling
 * now update every record of the token (`multi`), and removal narrows by cityIndex/id whenever they are given
 * (cityIndex 0 included).
 */
'use strict';

var async = require('async');

var PushInfo = require('../../models/modelPush');
var AlertPush = require('../../models/alert.push.model');

function tokenQuery(selector) {
    var query = {};
    query[selector.tokenKind] = selector.token;
    if (selector.cityIndex !== undefined) {
        query.cityIndex = selector.cityIndex;
        if (selector.id !== undefined) {
            query.id = selector.id;
        }
    }
    return query;
}

function keyQuery(info) {
    var query = {type: info.type, cityIndex: info.cityIndex, id: info.id};
    if (info.registrationId) {
        query.registrationId = info.registrationId;
    }
    else if (info.fcmToken) {
        query.fcmToken = info.fcmToken;
    }
    return query;
}

function removeWithResult(Model, name, selector, callback) {
    var query = tokenQuery(selector);
    log.info('remove ' + name + ' push ' + JSON.stringify(query));
    Model.remove(query, function (err, result) {
        if (err) {
            return callback(err);
        }
        if (!result) {
            return callback(new Error('Fail to get ' + name + ' result query:' + JSON.stringify(query)));
        }
        log.debug('remove ' + name + ' result ' + JSON.stringify(result));
        callback(undefined, result);
    });
}

function updateToken(Model, kind, newToken, oldToken, callback) {
    var query = {};
    var update = {};
    query[kind] = oldToken;
    update[kind] = newToken;
    Model.update(query, {$set: update}, {multi: true}, callback);
}

function disableByFcm(Model, fcmToken, callback) {
    Model.update({fcmToken: fcmToken},
        {$set: {enable: false, updatedAt: new Date(), updatedBy: 'push'}},
        {multi: true},
        callback);
}

/**
 * (registrationId) + cityIndex + id가 중복된 경우 updatedAt이 오래된 데이터 삭제
 */
function removeDuplicates(Model, name, callback) {
    var query = [
        {
            $group: {
                _id: {registrationId: "$registrationId", cityIndex: "$cityIndex", id: "$id"},
                updatedAts: {"$addToSet": {updatedAt: "$updatedAt"}},
                count: {"$sum": 1}
            }
        },
        {
            $match: {count: {"$gt": 1}}
        }];
    Model.aggregate(query).exec(function (err, results) {
        if (err) {
            log.error(err);
            return callback(null);
        }
        results = results.filter(function (obj) {
            return obj._id.registrationId != undefined;
        });

        log.info(name + 'Duplicates:' + results.length);
        if (results.length <= 0) {
            return callback(null);
        }
        log.info('duplicates:', JSON.stringify(results));

        async.mapSeries(results,
            function (obj, callback) {
                var updatedAt = obj.updatedAts[0].updatedAt < obj.updatedAts[1].updatedAt ?
                    obj.updatedAts[0].updatedAt : obj.updatedAts[1].updatedAt;
                var removeQuery = {
                    registrationId: obj._id.registrationId,
                    cityIndex: obj._id.cityIndex,
                    id: obj._id.id,
                    updatedAt: updatedAt
                };
                Model.remove(removeQuery).exec(callback);
            },
            function (err) {
                if (err) {
                    log.error(err);
                }
                callback(null);
            });
    });
}

module.exports = {
    kind: 'mongo',

    upsertAlarm: function (pushInfo, callback) {
        PushInfo.update(keyQuery(pushInfo), pushInfo, {upsert: true}, function (err, result) {
            if (err) {
                return callback(err);
            }
            return callback(undefined, result);
        });
    },
    removeAlarms: function (selector, callback) {
        removeWithResult(PushInfo, 'alarm', selector, callback);
    },
    updateAlarmToken: function (kind, newToken, oldToken, callback) {
        updateToken(PushInfo, kind, newToken, oldToken, callback);
    },
    disableAlarmsByFcm: function (fcmToken, callback) {
        disableByFcm(PushInfo, fcmToken, callback);
    },
    getAlarmsByTime: function (time, callback) {
        function enable() {
            //enable이 없거나, true이면 true
            return this.enable !== false;
        }
        PushInfo.find({pushTime: time}, {__v: 0}).$where(enable).lean().exec(callback);
    },
    removeDuplicateAlarms: function (callback) {
        removeDuplicates(PushInfo, 'push', callback);
    },

    upsertAlert: function (alertPush, callback) {
        var query = keyQuery(alertPush);
        AlertPush.find(query)
            .lean()
            .exec(function (err, list) {
                if (err) {
                    return callback(err);
                }
                if (list.length === 0) {
                    (new AlertPush(alertPush)).save(callback);
                }
                else {
                    if (list.length > 1) {
                        log.error('alert push was duplicated list:' + JSON.stringify(list));
                    }
                    AlertPush.update(query, {$set: alertPush}, callback);
                }
            });
    },
    removeAlerts: function (selector, callback) {
        removeWithResult(AlertPush, 'alert', selector, callback);
    },
    updateAlertToken: function (kind, newToken, oldToken, callback) {
        updateToken(AlertPush, kind, newToken, oldToken, callback);
    },
    disableAlertsByFcm: function (fcmToken, callback) {
        disableByFcm(AlertPush, fcmToken, callback);
    },
    getAlertsByTime: function (time, callback) {
        /**
         * 둘다 push한 시간이 6시간 이내여만 추가로 검토하지 않음.
         * 아래 function이 mongodb 내부에서 도는지 es6를 지원하지 않는 경우도 있음.
         * @returns {boolean}
         */
        function checkUpdateInterval() {
            var limitPushTime = new Date();
            limitPushTime.setHours(limitPushTime.getHours()-6);
            var needToCheck = true;
            if (this.precipAlerts) {
                if (this.precipAlerts.pushTime >= limitPushTime) {
                    needToCheck = false;
                }
            }
            if (this.airAlerts) {
                if (this.airAlerts.pushTime >= limitPushTime) {
                    needToCheck = false;
                }
            }
            return needToCheck;
        }

        /**
         * 기준시(time)보다 시작시간이 작아야 하고, 기준시보다 종료가 커야 함.
         * |--------|-----------|-------------|-------|
         * 0시  startTime     {time}       endtime   24시
         */
        var queryN = {enable: true, reverseTime: false, startTime: {$lte: time}, endTime: {$gte: time}};
        var queryR = {enable: true, reverseTime: true, $or: [{startTime: {$lte: time}}, {endTime: {$gte: time}}]};
        AlertPush.find({$or: [queryN, queryR]}).$where(checkUpdateInterval).lean().exec(callback);
    },
    updateAlertState: function (alertPush, callback) {
        AlertPush.update(
            {_id: alertPush._id},
            {$set: {"airAlerts": alertPush.airAlerts, "precipAlerts": alertPush.precipAlerts}},
            function (err, result) {
                if (err) {
                    return callback(err);
                }
                return callback(undefined, result);
            });
    },
    removeDuplicateAlerts: function (callback) {
        removeDuplicates(AlertPush, 'alertPush', callback);
    },
    removeOldAlerts: function (before, callback) {
        AlertPush.remove({"updateAt": {$lt: before}}, callback);
    }
};
