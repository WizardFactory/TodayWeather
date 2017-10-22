/**
 * Created by Peter on 2017. 9. 29..
 */


"use strict";

var async = require('async');
var mongoose = require('mongoose');
var config = require('../config/config');
var convert = require('./coordinate2xy');
var targetName = './utils/data/base.csv';

var kmaTimelib = require('../lib/kmaTimelib');

var modelTown = require('../models/town');
var modelCurrent = require('../models/modelCurrent');
var modelShort = require('../models/modelShort');
var modelShortRss = require('../models/modelShortRss');
var modelShortest = require('../models/modelShortest');
var modelMidForecast = require('../models/modelMidForecast');
var modelMidLand = require('../models/modelMidLand');
var modelMidSea = require('../models/modelMidSea');
var modelMidTemp = require('../models/modelMidTemp');
var modelMidRss = require('../models/modelMidRss');


var modelKmaTownCurrent = require('../models/kma/kma.town.current.model.js');
var modelKmaTownShort = require('../models/kma/kma.town.short.model.js');
var modelKmaTownShortRss = require('../models/kma/kma.town.short.rss.model.js');
var modelKmaTownShortest = require('../models/kma/kma.town.shortest.model.js');
var modelKmaTownMidForecast = require('../models/kma/kma.town.mid.forecast.model.js');
var modelKmaTownMidLand = require('../models/kma/kma.town.mid.land.model.js');
var modelKmaTownMidSea = require('../models/kma/kma.town.mid.sea.model.js');
var modelKmaTownMidTemp = require('../models/kma/kma.town.mid.temp.model.js');
var modelKmaTownMidRss = require('../models/kma/kma.town.mid.rss.model.js');

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

String.prototype.hashCode = function(){
    var hash = 0;
    if (this.length == 0) return hash;
    for (var i = 0; i < this.length; i++) {
        var char = this.charCodeAt(i);
        hash = ((hash<<5)-hash)+char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
};

function convertDbForm(){
    async.waterfall([
        function(cb){
            convertTownDbForm(function(){
                cb(null);
            });
        },
        function(cb){
            convertTownMidDbForm(function(){
                cb(null);
            })
        }],
        function(err, result){
            log.info('Finished to convert all db data');
        }
    )
}

function convertTownMidDbForm(fnCallback){
    async.waterfall([
        function(cb){
            // mid forecast
            modelMidForecast.find({}, {_id: 0}).lean().exec(function(err, midForecastList){
                log.info('Forcaset count : ', midForecastList.length);
                async.mapSeries(midForecastList,
                    function(mid, callback){
                        var id  = mid.regId.hashCode();
                        var pubDate = kmaTimelib.getKoreaDateObj(mid.pubDate);

                        log.info('mid forecast : ', mid.regId, id, mid.pubDate, mid.data.length);
                        async.mapSeries(mid.data,
                            function(item, cbMidData){
                                var fcsDate = kmaTimelib.getKoreaDateObj(item.date + item.time);
                                var newItem = {id: id, regId: mid.regId, pubDate: pubDate, fcsDate: fcsDate, data: item};
                                modelKmaTownMidForecast.update({id:id, fcsDate: fcsDate}, newItem, {upsert:true}, function(err){
                                    if(err){
                                        log.info('Failed to update Mid Forecast Data : ', newItem);
                                    }
                                    //log.info('save mid forecast : ', JSON.stringify(newItem));
                                    cbMidData(null);
                                });
                            },
                            function(err, res){
                                log.info('convert Mid Forecast : ', id, mid.regId);
                                return callback(null);
                            }
                        );
                    },
                    function(err, results){
                        log.info('Finished to convert all Mid Forecast Data');
                        return cb(null);
                    }
                );
            });
        },
        function(cb){
            // mid land
            modelMidLand.find({}, {_id: 0}).lean().exec(function(err, midLandList){
                async.mapSeries(midLandList,
                    function(mid, callback){
                        var id  = mid.regId.hashCode();
                        var pubDate = kmaTimelib.getKoreaDateObj(mid.pubDate);

                        async.mapSeries(mid.data,
                            function(item, cbMidData){
                                var fcsDate = kmaTimelib.getKoreaDateObj(item.date + item.time);
                                var newItem = {id: id, regId: mid.regId, pubDate: pubDate, fcsDate: fcsDate, data: item};
                                modelKmaTownMidLand.update({id:id, fcsDate: fcsDate}, newItem, {upsert:true}, function(err){
                                    if(err){
                                        log.info('Failed to update Mid Land Data : ', newItem);
                                    }
                                    //log.info('save mid land : ', JSON.stringify(newItem));
                                    cbMidData(null);
                                });
                            },
                            function(err, res){
                                log.info('convert Mid Land : ', id, mid.regId);
                                return callback(null);
                            }
                        );
                    },
                    function(err, results){
                        log.info('Finished to convert all Mid Land Data');
                        return cb(null);
                    }
                );
            });
        },
        function(cb){
            // mid sea
            modelMidSea.find({}, {_id: 0}).lean().exec(function(err, midSeaList){
                async.mapSeries(midSeaList,
                    function(mid, callback){
                        var id  = mid.regId.hashCode();
                        var pubDate = kmaTimelib.getKoreaDateObj(mid.pubDate);

                        async.mapSeries(mid.data,
                            function(item, cbMidData){
                                var fcsDate = kmaTimelib.getKoreaDateObj(item.date + item.time);
                                var newItem = {id: id, regId: mid.regId, pubDate: pubDate, fcsDate: fcsDate, data: item};
                                modelKmaTownMidSea.update({id:id, fcsDate: fcsDate}, newItem, {upsert:true}, function(err){
                                    if(err){
                                        log.info('Failed to update Mid Sea Data : ', newItem);
                                    }
                                    //log.info('save mid sea : ', JSON.stringify(newItem));
                                    cbMidData(null);
                                });
                            },
                            function(err, res){
                                log.info('convert Mid Sea : ', id, mid.regId);
                                return callback(null);
                            }
                        );
                    },
                    function(err, results){
                        log.info('Finished to convert all Mid Sea Data');
                        return cb(null);
                    }
                );
            });
        },
        function(cb){
            // mid temp
            modelMidTemp.find({}, {_id: 0}).lean().exec(function(err, midTempList){
                async.mapSeries(midTempList,
                    function(mid, callback){
                        var id  = mid.regId.hashCode();
                        var pubDate = kmaTimelib.getKoreaDateObj(mid.pubDate);

                        async.mapSeries(mid.data,
                            function(item, cbMidData){
                                var fcsDate = kmaTimelib.getKoreaDateObj(item.date + item.time);
                                var newItem = {id: id, regId: mid.regId, pubDate: pubDate, fcsDate: fcsDate, data: item};
                                modelKmaTownMidTemp.update({id:id, fcsDate: fcsDate}, newItem, {upsert:true}, function(err){
                                    if(err){
                                        log.info('Failed to update Mid Temp Data : ', newItem);
                                    }
                                    //log.info('save temp sea : ', JSON.stringify(newItem));
                                    cbMidData(null);
                                });
                            },
                            function(err, res){
                                log.info('convert Temp Sea : ', id, mid.regId);
                                return callback(null);
                            }
                        );
                    },
                    function(err, results){
                        log.info('Finished to convert all Mid Temp Data');
                        return cb(null);
                    }
                );
            });
        },
        function(cb){
            // mid rss
            modelMidRss.find({}, {_id: 0}).lean().exec(function(err, midRssList){
                async.mapSeries(midRssList,
                    function(mid, callback){
                        var id  = mid.regId.hashCode();
                        var pubDate = kmaTimelib.getKoreaDateObj(mid.pubDate);
                        var newItem = {
                            id: id,
                            stnId: mid.stnId,
                            regId: mid.regId,
                            province: mid.province,
                            city: mid.city,
                            mCoord: mid.mCoord,
                            gCoord: mid.gCoord,
                            pubDate: pubDate,
                            midData: mid.midData
                        };
                        modelKmaTownMidRss.update({id:id}, newItem, {upsert:true}, function(err){
                            if(err){
                                log.info('Failed to update Mid temp Data : ', newItem);
                            }else{
                                log.info('convert Temp Rss : ', id, mid.regId);
                            }
                            //log.info('save temp sea : ', JSON.stringify(newItem));
                            callback(null);
                        });
                    },
                    function(err, results){
                        log.info('Finished to convert all Mid Temp Data');
                        return cb(null);
                    }
                );
            });
        }],
        function(err, result){
            log.info('Finished to convert all Mid DB data');
            fnCallback();
        }
    )
}

function convertTownDbForm(fnCallback) {
    modelTown.distinct("mCoord").lean().exec(function (errTown, listTown) {
        if(errTown){
            log.info('Fail to get townlist');
            return fnCallback();
        }

        if(listTown.length == 0){
            log.info('There is no town info');
            return fnCallback();
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
                                        return cb(null);
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
                                        return cb(null);
                                    }
                                );

                            });
                        },

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
                                        return cb(null);
                                    }
                                );

                            });
                        },

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
                                        return cb(null);
                                    }
                                );

                            });
                        }

                    ],
                    function(err, townResult){
                        callback(null);
                    }
                );
            },
            function(errList, results){
                log.info('Complete to convert Town Short&Current DB data : ', listTown.length);
                return fnCallback();
            }
        );
    });
}

convertDbForm();