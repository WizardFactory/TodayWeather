/**
 * Created by Peter on 2017. 10. 7..
 */
"use strict";

var async = require('async');

var modelKmaTownShort = require('../../models/kma/kma.town.short.model.js');
var kmaTimelib = require('../../lib/kmaTimeLib');

function kmaTownShortController(){
}

kmaTownShortController.prototype.saveShort = function(newData, callback){
    //log.info('KMA Town S> save :', newData);
    var coord = {
        mx: newData[0].mx,
        my: newData[0].my
    };

    var pubDate = kmaTimelib.getKoreaDateObj(newData[0].pubDate);
    log.verbose('KMA Town S> pubDate :', pubDate.toString());
    //log.info('KMA Town S> db find :', coord);

    try{
        async.mapSeries(newData,
            function(item, cb){
                var fcsDate = kmaTimelib.getKoreaDateObj(item.date + item.time);
                var newItem = {mCoord: coord, pubDate: pubDate, fcsDate: fcsDate, shortData: item};
                log.debug('KMA Town S> item : ', JSON.stringify(newItem));

                modelKmaTownShort.update({mCoord: coord, fcsDate: fcsDate}, newItem, {upsert:true}, function(err){
                    if(err){
                        log.error('KMA Town S> Fail to update short item');
                        log.info(JSON.stringify(newItem));
                        return cb();
                    }

                    cb();
                });
            },
            function(err){
                log.debug('KMA Town S> finished to save town.short data');
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

kmaTownShortController.prototype.getShortFromDB = function(modelCurrent, coord, req, callback) {
    var errorNo = 0;

    try{
        if(req != undefined && req['modelShort'] != undefined){
            return callback(errorNo, req['modelShort']);
        }

        var query = {'mCoord.mx': coord.mx, 'mCoord.my': coord.my};
        modelKmaTownShort.find(query, {_id: 0}).sort({"fcsDate":1}).batchSize(30).lean().exec(function(err, result){
            if(err){
                log.warn('KMA Town S> Fail to file&get short data from DB');
                return callback(err);
            }

            if(result.length == 0){
                log.warn('KMA Town S> There are no short datas from DB');
                errorNo = 1;
                return callback(errorNo);
            }

            var ret = [];
            var pubDate = kmaTimelib.getKoreaTimeString(result[result.length-1].pubDate);

            log.info('KMA Town S> get Data : ', result.length);
            result.forEach(function(item){
                var newItem = {};
                var shortData = item.shortData;

                //log.info(JSON.stringify(item));
                commonString.forEach(function(string){
                    newItem[string] = shortData[string];
                });
                shortString.forEach(function(string){
                    newItem[string] = shortData[string];
                });
                ret.push(newItem);
            });

            log.info('KMA Town S> pubDate : ', pubDate);
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


kmaTownShortController.prototype.checkPubDate = function(model, srcList, dateString, callback) {
    var pubDate = kmaTimelib.getKoreaDateObj(''+ dateString.date + dateString.time);
    var errCode = 0;

    log.info('KMA Town S> pubDate : ', pubDate.toString());
    try{
        async.mapSeries(srcList,
            function(src,cb){
                modelKmaTownShort.find({'mCoord.mx': src.mx, 'mCoord.my': src.my}, {_id: 0, mCoord:1, pubDate:1})
                    .sort({"pubDate":1})
                    .lean()
                    .exec(function(err, dbList) {
                        if(err){
                            log.info('KMA Town S> There is no data matached to : ', src);
                            return cb(null, src);
                        }

                        for(var i=0 ; i<dbList.length ; i++){
                            if(dbList[i].pubDate.getTime() === pubDate.getTime()){
                                log.info('KMA Town S> Already updated : ', src, dateString);
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

                log.info('KMA Town S> Count of the list for the updating : ', result.length);
                log.info('KMA Town S> ', JSON.stringify(result));

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

kmaTownShortController.prototype.remove = function (pubDate) {
    var limitedTime = kmaTimelib.getPast8DaysTime(pubDate);
    log.info('KMA Town S> remove item if it is before : ', limitedTime.toString());
    modelKmaTownShort.remove({"fcsDate": {$lte:limitedTime}}).exec();
};

module.exports = kmaTownShortController;
