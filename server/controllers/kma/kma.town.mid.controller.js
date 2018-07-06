/**
 * Created by Peter on 2017. 10. 15..
 */
"use strict";

var async = require('async');

var modelKmaTownMidForecast = require('../../models/kma/kma.town.mid.forecast.model.js');
var modelKmaTownMidLand = require('../../models/kma/kma.town.mid.land.model.js');
var modelKmaTownMidSea = require('../../models/kma/kma.town.mid.sea.model.js');
var modelKmaTownMidTemp = require('../../models/kma/kma.town.mid.temp.model.js');
var kmaTimelib = require('../../lib/kmaTimeLib');

var dbType = {
    modelMidForecast: modelKmaTownMidForecast,
    modelMidLand: modelKmaTownMidLand,
    modelMidSea: modelKmaTownMidSea,
    modelMidTemp: modelKmaTownMidTemp
};

function kmaTownMidController(){
}

kmaTownMidController.prototype.saveMid = function(type, newData, overwrite, callback){
    var regId = '';
    var errCode = 0;

    try{
        var pubDate = kmaTimelib.getKoreaDateObj(newData.pubDate);

        log.verbose('KMA Town M> pubDate :', pubDate.toString());

        if(newData.pointNumber !== undefined){
            regId = newData.pointNumber;
        }else{
            regId = newData.regId;
        }

        var db = dbType[type];
        if(db == undefined){
            errCode = 1;
            log.error('KMA Town M> saveMid : unknow db type : ', type);
            if(callback){
                callback(errCode);
            }
            return;
        }

        log.silly(JSON.stringify(newData));

        async.waterfall([
            function(cb){
                var fcsDate = kmaTimelib.getKoreaDateObj(newData.date + newData.time);
                var newItem = {regId: regId, pubDate: pubDate, fcsDate: fcsDate, data: newData};

                //log.info(JSON.stringify(newItem));
                if(overwrite){
                    db.update({regId: regId}, newItem, {upsert:true}, function(err){
                        if(err){
                            log.error('KMA Town M> Fail to update Mid : '+ type + ' ID : ' + regId);
                            log.info(JSON.stringify(newItem));
                            return cb();
                        }
                        cb();
                    });
                }else{
                    db.update({regId: regId, pubDate: pubDate}, newItem, {upsert:true}, function(err){
                        if(err){
                            log.error('KMA Town M> Fail to update Mid'+ type + 'item');
                            log.info(JSON.stringify(newItem));
                            return cb();
                        }

                        cb();
                    });
                }
            }],
            function(err){
                var limitedTime = kmaTimelib.getPast8DaysTime(pubDate);
                log.debug('KMA Town M> finished to save town.mid : ', type);
                if(overwrite){
                    log.info('KMA Town M> remove all item before pubData: ', pubDate.toString());
                    db.remove({regId: regId, "fcsDate": {$lt:pubDate}}).exec();
                }else{
                    log.info('KMA Town M> remove all past 8days items: ', limitedTime.toString());
                    db.remove({regId: regId, "fcsDate": {$lte:limitedTime}}).exec();
                }

                callback(err);
            }
        );


    }catch(e){
        if(callback){
            callback(e);
        }
        else {
            log.error(e);
        }
    }

    return this;
};

kmaTownMidController.prototype.getMidFromDB = function(type, indicator, req, callback) {

    try{
        var db = dbType[type];
        if(db == undefined){
            log.error('KMA Town M> getMidFromDB : unknown db type : ', type);
            if(callback){
                callback(new Error('unknow db type'));
            }
            return [];
        }

        if(req != undefined && req[type] != undefined){
            log.debug('KMA Town M> return existed data : ', type, JSON.stringify(req[type]));
            callback(undefined, req[type]);
            return req[type];
        }

        db.find({regId : indicator}, {_id: 0}).limit(1).lean().exec(function(err, result){
            if(err){
                log.warn('KMA Town M> Fail to file&get mid data from DB : ', type);
                callback(err);
                return [];
            }

            if(result.length == 0){
                log.warn('KMA Town M> There are no mid datas from DB : ', type);
                callback(new Error('There are no mid datas'));
                return [];
            }

            if(result.length > 1){
                log.error('KMA Town M> _getMidDataFromDB : what happened?? ' + result.length + ' regId='+indicator);
            }

            log.silly('KMA Town M>', JSON.stringify(result[0]));
            if(callback){
                var ret = [];
                var privateString = [];
                if(result[0].data.hasOwnProperty('wfsv')){
                    privateString = forecastString;
                } else if(result[0].data.hasOwnProperty('wh10B')){
                    privateString = seaString;
                } else if(result[0].data.hasOwnProperty('taMax10')){
                    privateString = tempString;
                } else if(result[0].data.hasOwnProperty('wf10')){
                    privateString = landString;
                } else {
                    err = new Error('KMA Town M> ~> what is it???'+JSON.stringify(result[0].data));
                    log.error(err);
                    callback(err);
                    return [];
                }

                var newItem = {};
                commonString.forEach(function(string){
                    newItem[string] = result[0].data[string];
                });
                privateString.forEach(function(string){
                    newItem[string] = result[0].data[string];
                });
                //log.info(newItem);
                ret.push(newItem);

                callback(0, {pubDate: result[0].pubDate, ret: ret});
            }
            return result[0];
        });

    }catch(e){
        if (callback) {
            callback(e);
        }
        else {
            log.error(e);
        }

        return [];
    }
};


kmaTownMidController.prototype.checkPubDate = function(type, srcList, dateString, callback) {
    var pubDate = kmaTimelib.getKoreaDateObj(''+ dateString.date + dateString.time);
    var errCode = 0;

    log.info('KMA Town M> pubDate : ', pubDate.toString(), 'Type : ', type);
    try{
        var db = dbType[type];
        if(db == undefined){
            errCode = 1;
            log.error('KMA Town M> check pub Date : unknow db type : ', type);
            if(callback){
                callback(errCode);
            }
            return;
        }

        async.mapSeries(srcList,
            function(src,cb){
                db.find({regId: src.code}, {_id: 0, regId: 1, pubDate: 1}).sort({"pubDate":1}).lean().exec(function(err, dbList){
                    if(err){
                        log.info('KMA Town M> There is no data matached to : ', src);
                        return cb(null, src);
                    }

                    for(var i=0 ; i<dbList.length ; i++){
                        if(dbList[i].pubDate.getTime() === pubDate.getTime()){
                            log.info('KMA Town M> Already updated : ', src, dateString, src.code);
                            return cb(null);
                        }
                    }

                    log.info('KMA Town M> Need to update : ', src.code);
                    cb(null, src);
                });
            },
            function(err, result){
                result = result.filter(function(item){
                    if(item === undefined){
                        return false;
                    }
                    return true;
                });

                log.info('KMA Town M> Count of the list for the updating : ', result.length);
                log.silly('KMA Town M> ', JSON.stringify(result));

                return callback(errCode, result);
            }
        );
    }catch(e){
        if (callback) {
            callback(e);
        }
        else {
            log.error(e);
        }
    }

    return this;
};

kmaTownMidController.prototype.checkForecastPubDate = function(model, srcList, dateString, callback) {
    return kmaTownMidController.prototype.checkPubDate('modelMidForecast', srcList, dateString, callback);
};

kmaTownMidController.prototype.checkLandPubDate = function(model, srcList, dateString, callback) {
    return kmaTownMidController.prototype.checkPubDate('modelMidLand', srcList, dateString, callback);
};

kmaTownMidController.prototype.checkSeaPubDate = function(model, srcList, dateString, callback) {
    return kmaTownMidController.prototype.checkPubDate('modelMidSea', srcList, dateString, callback);
};

kmaTownMidController.prototype.checkTempPubDate = function(model, srcList, dateString, callback) {
    return kmaTownMidController.prototype.checkPubDate('modelMidTemp', srcList, dateString, callback);
};

module.exports = kmaTownMidController;