/**
 * Created by Peter on 2017. 9. 26..
 */
"use strict";
var async = require('async');

var modelKmaTownCurrent = require('../../models/kma/kma.town.current.model.js');
var kmaTimelib = require('../../lib/kmaTimeLib');

function kmaTownCurrentController(){
}

/**
 *
 * @param newData
 * @param callback
 * @returns {kmaTownCurrentController}
 */
kmaTownCurrentController.prototype.saveCurrent = function(newData, callback){
    //log.info('KMA Town C> save :', newData);
    var coord = {
        mx: newData[0].mx,
        my: newData[0].my
    };

    var pubDate = kmaTimelib.getKoreaDateObj(newData[0].pubDate);

    log.debug('KMA Town C> pubDate :', pubDate.toString());

    try{
        async.mapSeries(newData,
            function(item, cb){
                var fcsDate = kmaTimelib.getKoreaDateObj(item.date + item.time);
                if ( pubDate == null || isNaN(pubDate.getTime()) ) {
                    log.warn('pubDate is null, so copy from fcsDate');
                    pubDate = fcsDate;
                }
                var newItem = {mCoord: coord, pubDate: pubDate, fcsDate: fcsDate, currentData: item};
                log.debug('KMA Town C> item : ', JSON.stringify(newItem));

                modelKmaTownCurrent.update({mCoord: coord, fcsDate: fcsDate}, newItem, {upsert:true}, function(err){
                    if(err){
                        log.error('KMA Town C> Fail to update current item');
                        log.error(err);
                        log.info(JSON.stringify(newItem));
                        return cb();
                    }

                    cb();
                });
            },
            function(err){
                log.debug('KMA Town C> finished to save town.current data');
                callback(err);
            }
        );
    }
    catch(e){
        if(callback){
            callback(e);
        }
        else {
            log.error(e);
        }
    }

    return this;

};

/**
 *
 * @param modelCurrent
 * @param coord
 * @param req
 * @param callback
 * @returns {*}
 * @private
 */
kmaTownCurrentController.prototype.getCurrentFromDB = function(modelCurrent, coord, req, callback) {
    var errorNo = 0;

    try{
        if(req != undefined && req['modelCurrent'] != undefined){
            return callback(errorNo, req['modelCurrent']);
        }

        var query = {'mCoord.mx': coord.mx, 'mCoord.my': coord.my};
        modelKmaTownCurrent.find(query, {_id: 0}).sort({"fcsDate":1}).batchSize(30).lean().exec(function(err, result){
            if(err){
                log.warn('KMA Town C> Fail to file&get current data from DB');
                return callback(err);
            }

            if(result.length == 0){
                log.warn('KMA Town C> There are no current datas from DB');
                errorNo = 1;
                return callback(errorNo);
            }

            var ret = [];
            var pubDate = kmaTimelib.getKoreaTimeString(result[result.length-1].pubDate);

            log.info('KMA Town C> get Data : ', result.length);
            result.forEach(function(item){
                var newItem = {};
                var curData = item.currentData;

                //log.info(JSON.stringify(item));
                commonString.forEach(function(string){
                    newItem[string] = curData[string];
                });
                curString.forEach(function(string){
                    newItem[string] = curData[string];
                });
                ret.push(newItem);
            });

            callback(errorNo, {pubDate: pubDate, ret:ret});
        });

    }catch(e){
        if (callback) {
            callback(e);
        }
        else {
            log.error(e);
        }
    }
};


kmaTownCurrentController.prototype.checkPubDate = function(model, srcList, dateString, callback) {
    var pubDate = kmaTimelib.getKoreaDateObj(''+ dateString.date + dateString.time);
    var errCode = 0;

    log.info('KMA Town C> checkPubDate pubDate : ', pubDate.toString());
    try{
        async.mapSeries(srcList,
            function(src,cb){
                modelKmaTownCurrent.find({'mCoord.mx': src.mx, 'mCoord.my': src.my}, {_id: 0, mCoord:1, pubDate:1}).sort({"pubDate":1}).lean().exec(function(err, dbList){
                    if(err){
                        log.info('KMA Town C> There is no data matached to : ', src);
                        return cb(null, src);
                    }

                    for(var i=0 ; i<dbList.length ; i++){
                        if(dbList[i].pubDate.getTime() === pubDate.getTime()){
                            log.info('KMA Town C> Already updated : ', src, dateString);
                            return cb(null);
                        }
                    }

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

                log.info('KMA Town C> Count of the list for the updating : ', result.length);
                log.info(JSON.stringify(result));

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

kmaTownCurrentController.prototype.remove = function (pubDate) {
    var limitedTime = kmaTimelib.getPast8DaysTime(pubDate);
    log.info('KMA Town C> remove item if it is before : ', limitedTime.toString());
    modelKmaTownCurrent.remove({"fcsDate": {$lte:limitedTime}}).exec();
};

module.exports = kmaTownCurrentController;