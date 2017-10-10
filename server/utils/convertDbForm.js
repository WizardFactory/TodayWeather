/**
 * Created by Peter on 2017. 9. 29..
 */


"use strict";

var async = require('async');
var mongoose = require('mongoose');
var config = require('../config/config');
var convert = require('./coordinate2xy');
var targetName = './utils/data/base.csv';

var modelTown = require('../models/town');
var modelCurrent = require('../models/modelCurrent');
var modelShort = require('../models/modelShort');
var modelShortRss = require('../models/modelShortRss');
var modelShortest = require('../models/modelShortest');


var modelKmaTownCurrent = require('../models/kma/kma.town.current.model.js');
var modelKmaTownShort = require('../models/kma/kma.town.short.model.js');
var modelKmaTownShortRss = require('../models/kma/kma.town.short.rss.model.js');
var modelKmaTownShortest = require('../models/kma/kma.town.shortest.model.js');

var Logger = require('../lib/log');

global.log  = new Logger();

console.log('db connect '+config.db.path);
mongoose.connect(config.db.path, config.db.options, function(err){
    if(err){
        console.error('could net connect to MongoDB');
        console.error(err);
    }
});

function _getDate(curTime){
    return new Date(curTime.slice(0,4)+ '-' + curTime.slice(4,6) + '-' + curTime.slice(6,8) + 'T' + curTime.slice(8,10) + ':00:00+09:00');
}

function convertDbForm() {
    modelTown.distinct("mCoord").lean().exec(function (errTown, listTown) {
        if(errTown){
            log.info('Fail to get townlist');
            return;
        }

        if(listTown.length == 0){
            log.info('There is no town info');
            return;
        }

        log.info('Townlist : ', listTown.length);
        async.mapSeries(listTown,
            function(town, callback){
                async.waterfall(
                    [
                        /*
                        function(cb){
                            // current data
                            modelCurrent.find({"mCoord.mx":town.mx, "mCoord.my":town.my}).limit(1).lean().exec(function(err, curData){
                                if(err){
                                    log.info('Fail to get old DB data : ', town.mx, town.my);
                                    return cb(null);
                                }

                                if(curData == 0){
                                    log.info('There is no current item in DB : ', town.mx, town.my);
                                    return cb(null);
                                }

                                log.info('Courrent : To convert : ', town.mx, town.my);
                                var current = curData[0];
                                var mCoord = {mx: current.mCoord.mx, my: current.mCoord.my};
                                async.mapSeries(current.currentData,
                                    function(curData, curCb){
                                        var fcsDate = _getDate(''+ curData.date + curData.time);
                                        var pubDate = _getDate(current.pubDate);
                                        var newItem = {
                                            mCoord: mCoord,
                                            pubDate: pubDate,
                                            fcsDate: fcsDate,
                                            currentData: {
                                                date: curData.date,
                                                time: curData.time,
                                                mx: curData.mx,
                                                my: curData.my,
                                                t1h: curData.t1h,
                                                rn1: curData.rn1,
                                                sky: curData.sky,
                                                uuu: curData.uuu,
                                                vvv: curData.vvv,
                                                reh: curData.reh,
                                                pty: curData.pty,
                                                lgt: curData.lgt,
                                                vec: curData.vec,
                                                wsd: curData.wsd
                                            }
                                        };

                                        modelKmaTownCurrent.update({mCoord: mCoord, fcsDate: fcsDate}, newItem, {upsert:true}, function(err){
                                            if(err){
                                                log.error('Fail to update current item : ', mCoord);
                                                log.info(JSON.stringify(newItem));
                                            }
                                            //log.info('crrent OK : ', JSON.stringify(newItem));
                                            curCb(null);
                                        });
                                    },
                                    function(err, results){
                                        cb(null);
                                    }
                                );

                            });
                        },
                        function(cb){
                            // short data
                            modelShort.find({"mCoord.mx":town.mx, "mCoord.my":town.my}).limit(1).lean().exec(function(err, curData){
                                if(err){
                                    log.info('Fail to get short of old DB data : ', town.mx, town.my);
                                    return cb(null);
                                }

                                if(curData == 0){
                                    log.info('There is no short item in DB : ', town.mx, town.my);
                                    return cb(null);
                                }

                                log.info('Short to convert : ', town.mx, town.my);
                                var short = curData[0];
                                var mCoord = {mx: short.mCoord.mx, my: short.mCoord.my};
                                var pubDate = _getDate(short.pubDate);
                                async.mapSeries(short.shortData,
                                    function(shortData, curCb){
                                        var fcsDate = _getDate(''+ shortData.date + shortData.time);
                                        var newItem = {
                                            mCoord: mCoord,
                                            pubDate: pubDate,
                                            fcsDate: fcsDate,
                                            shortData: {
                                                date: shortData.date,
                                                time: shortData.time,
                                                mx: shortData.mx,
                                                my: shortData.my,
                                                pop: shortData.pop,
                                                pty: shortData.pty,
                                                r06: shortData.r06,
                                                reh: shortData.reh,
                                                s06: shortData.s06,
                                                sky: shortData.sky,
                                                t3h: shortData.t3h,
                                                tmn: shortData.tmn,
                                                tmx: shortData.tmx,
                                                uuu: shortData.uuu,
                                                vvv: shortData.vvv,
                                                wav: shortData.wav,
                                                vec: shortData.vec,
                                                wsd: shortData.wsd
                                            }
                                        };

                                        modelKmaTownShort.update({mCoord: mCoord, fcsDate: fcsDate}, newItem, {upsert:true}, function(err){
                                            if(err){
                                                log.error('Fail to update short item : ', mCoord);
                                                log.info(JSON.stringify(newItem));
                                            }
                                            //log.info('crrent OK : ', JSON.stringify(newItem));
                                            curCb(null);
                                        });
                                    },
                                    function(err, results){
                                        cb(null);
                                    }
                                );

                            });
                        },
                        */
                        function(cb){
                            // short rss data
                            modelShortRss.find({"mCoord.mx":town.mx, "mCoord.my":town.my}).limit(1).lean().exec(function(err, curData){
                                if(err){
                                    log.info('Fail to get short rss of old DB data : ', town.mx, town.my);
                                    return cb(null);
                                }

                                if(curData == 0){
                                    log.info('There is no short rss item in DB : ', town.mx, town.my);
                                    return cb(null);
                                }

                                log.info('Short Rss convert : ', town.mx, town.my);
                                var short = curData[0];
                                var mCoord = {mx: short.mCoord.mx, my: short.mCoord.my};
                                var pubDate = _getDate(short.pubDate);
                                async.mapSeries(short.shortData,
                                    function(shortData, curCb){
                                        var fcsDate = _getDate(''+ shortData.date);
                                        var newItem = {
                                            mCoord: mCoord,
                                            pubDate: pubDate,
                                            fcsDate: fcsDate,
                                            shortData: {
                                                ftm: shortData.ftm,
                                                date: shortData.date,
                                                temp: shortData.temp,
                                                tmx: shortData.tmx,
                                                tmn: shortData.tmn,
                                                sky: shortData.sky,
                                                pty: shortData.pty,
                                                wfKor: shortData.wfKor,
                                                wfEn: shortData.wfEn,
                                                pop: shortData.pop,
                                                r12: shortData.r12,
                                                s12: shortData.s12,
                                                ws: shortData.ws,
                                                wd: shortData.wd,
                                                wdKor: shortData.wdKor,
                                                wdEn: shortData.wdEn,
                                                reh: shortData.reh,
                                                r06: shortData.r06,
                                                s06: shortData.s06
                                            }
                                        };

                                        modelKmaTownShortRss.update({mCoord: mCoord, fcsDate: fcsDate}, newItem, {upsert:true}, function(err){
                                            if(err){
                                                log.error('Fail to update short rss item : ', mCoord);
                                                log.info(JSON.stringify(newItem));
                                            }
                                            //log.info('crrent OK : ', JSON.stringify(newItem));
                                            curCb(null);
                                        });
                                    },
                                    function(err, results){
                                        cb(null);
                                    }
                                );

                            });
                        },
                        /*
                        function(cb){
                            // shortest data
                            modelShortest.find({"mCoord.mx":town.mx, "mCoord.my":town.my}).limit(1).lean().exec(function(err, curData){
                                if(err){
                                    log.info('Fail to get shortest of old DB data : ', town.mx, town.my);
                                    return cb(null);
                                }

                                if(curData == 0){
                                    log.info('There is no shortest item in DB : ', town.mx, town.my);
                                    return cb(null);
                                }

                                log.info('Shortest convert : ', town.mx, town.my);
                                var shortest = curData[0];
                                var mCoord = {mx: shortest.mCoord.mx, my: shortest.mCoord.my};
                                var pubDate = _getDate(shortest.pubDate);
                                async.mapSeries(shortest.shortestData,
                                    function(shortestData, curCb){
                                        var fcsDate = _getDate(''+ shortestData.date + shortestData.time);
                                        var newItem = {
                                            mCoord: mCoord,
                                            pubDate: pubDate,
                                            fcsDate: fcsDate,
                                            shortestData: {
                                                date: shortestData.date,
                                                time: shortestData.time,
                                                mx: shortestData.mx,
                                                my: shortestData.my,
                                                pty: shortestData.pty,
                                                rn1: shortestData.rn1,
                                                sky: shortestData.sky,
                                                lgt: shortestData.lgt,
                                                t1h: shortestData.t1h,
                                                reh: shortestData.reh,
                                                uuu: shortestData.uuu,
                                                vvv: shortestData.vvv,
                                                vec: shortestData.vec,
                                                wsd: shortestData.wsd
                                            }
                                        };

                                        modelKmaTownShortest.update({mCoord: mCoord, fcsDate: fcsDate}, newItem, {upsert:true}, function(err){
                                            if(err){
                                                log.error('Fail to update shortest item : ', mCoord);
                                                log.info(JSON.stringify(newItem));
                                            }
                                            //log.info('crrent OK : ', JSON.stringify(newItem));
                                            curCb(null);
                                        });
                                    },
                                    function(err, results){
                                        cb(null);
                                    }
                                );

                            });
                        }
                        */
                    ],
                    function(err, townResult){
                        callback(null);
                    }
                );
            },
            function(errList, results){
                log.info('Complete to convert DB data : ', listTown.length);
                return;
            }
        );
    });
}

convertDbForm();