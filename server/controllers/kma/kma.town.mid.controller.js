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
            var err = new Error('KMA Town M> saveMid : unknown db type : ' + type);
            log.error(err.message);
            return callback(err);
        }

        log.silly(JSON.stringify(newData));

        async.waterfall([
            function(cb){
                var fcsDate = kmaTimelib.getKoreaDateObj(newData.date + newData.time);
                var newItem = {regId: regId, pubDate: pubDate, fcsDate: fcsDate, data: newData};

                //log.info(JSON.stringify(newItem));
                var query;
                if (overwrite) {
                    query =  {regId: regId};
                }
                else {
                    query = {regId: regId, pubDate: pubDate};
                }
                db.update(query, newItem, {upsert:true}, function(err){
                    if(err){
                        log.error('KMA Town M> Fail to update Mid : '+ type + ' ID : ' + regId);
                        log.info(JSON.stringify(newItem));
                        return cb();
                    }
                    cb();
                });
            }],
            function (err) {
                log.debug('KMA Town M> finished to save town.mid : ', type);

                var fcsDate;
                if (overwrite) {
                    fcsDate = pubDate;
                }
                else {
                    fcsDate = kmaTimelib.getPast8DaysTime(pubDate);
                }
                /**
                 * 불필요하게 중복해서 호출되고 있음.
                 */
                log.info('KMA Town M> remove '+ type + ' item before : ', fcsDate.toString());
                db.remove({regId: regId, "fcsDate": {$lt:fcsDate}}).exec();

                callback(err);
            }
        );
    }
    catch (e) {
        return callback(e);
    }
};

kmaTownMidController.prototype.getMidFromDB = function(type, indicator, req, callback) {

    try{
        var db = dbType[type];
        if(db == undefined){
            log.error('KMA Town M> getMidFromDB : unknown db type : ', type);
            return callback(new Error('unknown db type '+type));
        }

        if(req != undefined && req[type] != undefined){
            log.debug('KMA Town M> return existed data : ', type, JSON.stringify(req[type]));
            return callback(null, req[type]);
        }

        db.find({regId : indicator}, {_id: 0}).limit(1).lean().exec(function(err, result){
            if(err){
                log.warn('KMA Town M> Fail to file&get mid data from DB ', {type:type, regId: indicator});
                return callback(err);
            }

            if(result.length == 0){
                err = new Error('KMA Town M> There are no mid datas from DB ' + JSON.stringify({type, indicator}));
                log.warn(err.message);
                return callback(err);
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
                    return callback(err);
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

                callback(null, {pubDate: result[0].pubDate, ret: ret});
            }
        });
    }
    catch (e) {
        return callback(e);
    }
};


kmaTownMidController.prototype.checkPubDate = function(type, srcList, dateString, callback) {
    var pubDate = kmaTimelib.getKoreaDateObj(''+ dateString.date + dateString.time);

    log.info('KMA Town M> pubDate : ', pubDate.toString(), 'Type : ', type);
    try{
        var db = dbType[type];
        if(db == undefined) {
            var err = new Error('KMA Town M> check pub Date : unknown db type : ' + type);
            log.error(err);
            return callback(err);
        }

        async.mapSeries(srcList,
            function(src,cb){
                db.find({regId: src.code}, {_id: 0, regId: 1, pubDate: 1}).sort({"pubDate":1}).lean().exec(function(err, dbList){
                    if(err){
                        log.info('KMA Town M> There is no data matched to : ', src);
                        return cb(null, src);
                    }

                    for(var i=0 ; i<dbList.length ; i++){
                        if(dbList[i].pubDate.getTime() === pubDate.getTime()){
                            log.info('KMA Town M> Already updated : ', src, dateString, src.code);
                            return cb(null);
                        }
                    }

                    log.debug('KMA Town M> Need to update : ', src.code);
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

                return callback(null, result);
            }
        );
    }
    catch(e){
        return callback(e);
    }
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