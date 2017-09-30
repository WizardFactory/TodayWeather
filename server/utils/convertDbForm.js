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
var modelKmaTownCurrent = require('../models/kma/kma.town.current.model.js');

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

                                log.info('To convert : ', town.mx, town.my);
                                var current = curData[0];
                                var mCoord = {mx: current.mCoord.mx, my: current.mCoord.my};
                                async.mapSeries(current.currentData,
                                    function(curData, curCb){
                                        var pubDate = _getDate(''+ curData.date + curData.time);
                                        var newItem = {
                                            mCoord: mCoord,
                                            pubDate: pubDate,
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

                                        modelKmaTownCurrent.update({mCoord: mCoord, pubDate: pubDate}, newItem, {upsert:true}, function(err){
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
                            cb(null);
                        }
                    ],
                    function(err, townResult){
                        callback(null);
                    }
                );
            },
            function(errList, results){
                log.info('Complete to convert DB data : ', listTown.length);
            }
        );
    });
}

convertDbForm();