/**
 * convert modelKmaStnHourly to modelKmaStnHourly2
 * Created by aleckim on 2017. 6. 10..
 */

var KmaStnHourly = require('../models/modelKmaStnHourly');
var KmaStnHourly2 = require('../models/modelKmaStnHourly2');
var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var async = require('async');

module.exports = function(callback) {

    async.waterfall([
            function (cb) {
                KmaStnHourly2.count().exec(function (err, count) {
                    if (count > 0) {
                        log.info('skip kma stn hourly to kma stn hourly2');
                        return cb('skip');
                    }
                    cb();
                })
            },
            function (cb) {
                KmaStnHourly.find().lean().exec(function (err, list) {
                    if (list == undefined || list.length == 0) {
                        return cb(new Error("Fail to get kma stn hourlies"));
                    }
                    cb(null, list);
                });
            },
            function (list, cb) {
                var trySave = 0;
                var saved = 0;
                if (Array.isArray(list) == false || list.length == 0) {
                    return cb(new Error("list is not array or length is zero"));
                }

                list.forEach(function (kmaStnHour) {
                    kmaStnHour.hourlyData.forEach(function (hourData) {
                        var kmaStnHourly2 = {stnId: parseInt(kmaStnHour.stnId), stnName: kmaStnHour.stnName};
                        for (var key in hourData) {
                            if (key == 'date') {
                                kmaStnHourly2[key] = new Date(hourData[key]);
                            }
                            else {
                                kmaStnHourly2[key] = hourData[key];
                            }
                        }

                        //log.info(JSON.stringify(kmaStnHourly2));
                        trySave++;
                        KmaStnHourly2.update({stnId: kmaStnHourly2.stnId, date: kmaStnHourly2.date}, kmaStnHourly2,
                            {upsert: true}, function (err) {
                                if (err) {
                                    log.error(err.message + "in insert DB(KmaStnHourly)");
                                    log.warn(JSON.stringify(kmaStnHourly2));
                                    return cb(err);
                                }
                                saved++;
                                if (trySave <= saved) {
                                    //stn count(695) * 24 * 8 = 133440
                                    log.info("kmaStnHourly 2 kmaStnHourly2 trySave=" + trySave);
                                    cb();
                                }
                            });
                    });
                });
            }
        ],
        function(err) {
            if(err && err != 'skip') {
                log.error(err.message + "in convert kmaStnHourly To kmaStnHourly2");
                return callback(err);
            }
            callback();
        });
};

