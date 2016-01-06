/**
 * Created by aleckim on 2015. 12. 29..
 */

var async = require('async');
var req = require('request');

var town = require('../models/town');
var modelCurrent = require('../models/modelCurrent');
var config = require('../config/config');

function PastConditionGather() {
    this.pubDateList; //{date: String, time: String}
    this.updateList = []; //{mCoord: {mx,my}, baseTimeList: {date, time}}
}

PastConditionGather.prototype.makePubDateList = function (days) {
    var pubDateList = [];
    var counts = days*24;
    var currentMins = (new Date()).getUTCMinutes();
    var startOffset;
    var currentDate;
    var dateString;

    if (currentMins > 40) {
        startOffset = 9;
    }
    else {
        startOffset = 8;
    }
    for (var i=0; i<counts; i++) {
        currentDate = manager.getWorldTime(startOffset--);

        dateString = {};
        dateString.date = currentDate.slice(0, 8);
        dateString.time = currentDate.slice(8,10) + '00';

        pubDateList.push(dateString);
    }
    return pubDateList;
};

PastConditionGather.prototype._checkBaseTime = function (callback) {
    var self = this;
    var updateObject;
    modelCurrent.find(null, {_id: 0}).lean().exec(function(err, modelList) {
        if (err) {
            return callback(err);
        }
        modelList.forEach(function (model) {
            updateObject = {mCoord: model.mCoord, baseTimeList: []};
            self.pubDateList.forEach(function (pubDate) {
                for (var i=0; i<model.currentData.length; i++) {
                    if (pubDate.date === model.currentData[i].date && pubDate.time === model.currentData[i].time) {
                        if (model.currentData[i].t1h === -50 || model.currentData[i].reh === -1) {
                            log.info('baseTime='+JSON.stringify(pubDate)+' data is invalid. so retry!');
                            break;
                        }
                        else {
                            log.debug('baseTime='+JSON.stringify(pubDate)+' is skipped');
                            return;
                        }
                    }
                }
                log.silly('baseTime='+JSON.stringify(pubDate)+' needs to get data');
                updateObject.baseTimeList.push(pubDate);
            });
            if (updateObject.baseTimeList.length) {
                self.updateList.push(updateObject);
            }
            else {
                log.debug('mCoord='+JSON.stringify(updateObject.mCoord)+' is already updated');
            }
        });
        callback();
    });
};

PastConditionGather.prototype.start = function (days, key, callback) {
    var self = this;

    async.waterfall([
        function(callback) {
            self.pubDateList = self.makePubDateList(days);
            callback();
        },
        function (callback) {
            self._checkBaseTime(function (err) {
                callback(err);
            });
        },
        function (callback) {
            manager.requestDataByUpdateList(manager.DATA_TYPE.TOWN_CURRENT, key, self.updateList, 10, function (err, results) {
                callback(err);
            });
        }
    ], function(err, results) {
        if (callback) {
            return callback(err);
        }
        if (err) {
            log.error(err);
        }
        log.silly(results);
    });

    return this;
};

module.exports = PastConditionGather;

