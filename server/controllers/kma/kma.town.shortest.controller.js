/**
 * Created by Peter on 2017. 10. 9..
 */
"use strict";
var async = require('async');

var modelKmaTownShortest = require('../../models/kma/kma.town.shortest.model.js');
var kmaTimelib = require('../../lib/kmaTimeLib');

function kmaTownShortestController(){
}

kmaTownShortestController.prototype.saveShortest = function(newData, callback){
    //log.info('KMA Town ST> save :', newData);
    var coord = {
        mx: newData[0].mx,
        my: newData[0].my
    };

    var pubDate = kmaTimelib.getKoreaDateObj(newData[0].pubDate);
    log.debug('KMA Town ST> pubDate :', pubDate.toString());
    //log.info('KMA Town ST> db find :', coord);

    try{
        async.mapSeries(newData,
            function(item, cb){
                var fcsDate = kmaTimelib.getKoreaDateObj(item.date + item.time);
                var newItem = {mCoord: coord, pubDate: pubDate, fcsDate: fcsDate, shortestData: item};
                log.debug('KMA Town ST> item : ', JSON.stringify(newItem));

                modelKmaTownShortest.update({mCoord: coord, fcsDate: fcsDate}, newItem, {upsert:true}, function(err){
                    if(err){
                        log.error('KMA Town ST> Fail to update short item');
                        log.info(JSON.stringify(newItem));
                        return cb();
                    }

                    cb();
                });
            },
            function(err){
                log.debug('KMA Town ST> finished to save town.short data');
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

kmaTownShortestController.prototype.getShortestFromDB = function(modelCurrent, coord, req, callback) {
    var errorNo = 0;

    try{
        if(req != undefined && req['modelShortest'] != undefined){
            return callback(errorNo, req['modelShortest']);
        }

        var query = {'mCoord.mx': coord.mx, 'mCoord.my': coord.my};
        modelKmaTownShortest.find(query, {_id: 0}).sort({"fcsDate":1}).batchSize(30).lean().exec(function(err, result){
            if(err){
                log.warn('KMA Town ST> Fail to file&get shortest data from DB');
                return callback(err);
            }

            if(result.length == 0){
                log.warn('KMA Town ST> There are no shortest datas from DB');
                errorNo = 1;
                return callback(errorNo);
            }

            var ret = [];
            var pubDate = kmaTimelib.getKoreaTimeString(result[result.length-1].pubDate);

            log.info('KMA Town ST> get Data : ', result.length);
            result.forEach(function(item){
                var newItem = {};
                var shortestData = item.shortestData;

                //log.info(JSON.stringify(item));
                commonString.forEach(function(string){
                    newItem[string] = shortestData[string];
                });
                shortestString.forEach(function(string){
                    newItem[string] = shortestData[string];
                });
                newItem.pubDate = kmaTimelib.getKoreaTimeString(item.pubDate);
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


kmaTownShortestController.prototype.checkPubDate = function(model, srcList, dateString, callback) {
    var pubDate = kmaTimelib.getKoreaDateObj(''+ dateString.date + dateString.time);
    var errCode = 0;

    log.info('KMA Town ST> pubDate : ', pubDate.toString());
    try{
        async.mapSeries(srcList,
            function(src,cb){
                modelKmaTownShortest.find({'mCoord.mx': src.mx, 'mCoord.my': src.my}, {_id: 0, mCoord:1, pubDate:1})
                    .sort({"pubDate":1})
                    .lean()
                    .exec(function(err, dbList) {
                        if(err){
                            log.info('KMA Town ST> There is no data matached to : ', src);
                            return cb(null, src);
                        }

                        for(var i=0 ; i<dbList.length ; i++){
                            if(dbList[i].pubDate.getTime() === pubDate.getTime()){
                                log.info('KMA Town ST> Already updated : ', src, dateString);
                                return cb(null);
                            }
                        }

                        cb(null, src);
                    });
            },
            function(err, result){
                result = result.filter(function(item){
                    if(item == undefined){
                        return false;
                    }
                    return true;
                });

                log.info('KMA Town ST> Count of the list for the updating : ', result.length);
                log.info('KMA Town ST> ', JSON.stringify(result));

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

kmaTownShortestController.prototype.remove = function (pubDate) {
    var limitedTime = kmaTimelib.getPast8DaysTime(pubDate);
    log.info('KMA Town ST> remove item if it is before : ', limitedTime.toString());
    modelKmaTownShortest.remove({"fcsDate": {$lte:limitedTime}}).exec();
};

module.exports = kmaTownShortestController;
