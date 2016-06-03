/**
 * Created by Peter on 2016. 5. 29..
 */
"use strict";

var print = require('tracer').colorConsole({level:'info'});

var fs = require('fs');
var async = require('async');

var modelGeocode = require('../../models/worldWeather/modelGeocode');
var modelWuForecast = require('../../models/worldWeather/modelWuForecast');

var config = require('../../config/config');
var metRequester = require('../../lib/MET/metRequester');
var owmRequester = require('../../lib/OWM/owmRequester');
var wuRequester = require('../../lib/WU/wuRequester');


function ConCollector() {
    var self = this;

    self.keybox = config.keyString;
}

ConCollector.prototype.collectWeather = function(funcList, isRetry, callback){
    var self = this;

    try{
        async.waterfall([
                function(first_cb){
                    // 1. get location list which contains either geocode or city name.
                    self.getGeocodeList(modelGeocode, function(err, list){
                        if(err){
                            print.error('Fail to get geocode list');
                            first_cb('fail:getGeocodeList');
                            return;
                        }

                        first_cb(undefined, list);
                    });
                },
                function(geocodeList, first_cb){

                    async.mapSeries(funcList,
                        function(funcCollector, sec_cb){
                            funcCollector(geocodeList, isRetry, function(err, failList){
                                if(err){
                                    var errString = 'Fail to funcCollect[' + funcList.indexOf(funcCollector) + ']';
                                    print.error(errString);
                                    // it always return success, even though there is error to get data,
                                    sec_cb(null);
                                    return;
                                }
                                sec_cb(null);
                                return;
                            });
                        },
                        function(sec_err){
                            if(sec_err){
                                print.error('Collecting is not completed!! : ', sec_err);
                                first_cb('fail:collecting');
                                return;
                            }
                            print.info('Collecting is completed!!');
                            first_cb(null);
                        }
                    );

                }
            ],
            function(first_err){
                if(first_err){
                    print.error('Something was wrong:', first_err);
                }
                print.info('Finish : collectWeather');
                callback(first_err);
            }
        );
    }catch(e){
        print.error('Exception!!!');
        if(callback){
            callback(e);
        }
    }
};

ConCollector.prototype.getGeocodeList = function(db, callback){
    db.getGeocode(function(err, resultList){
        if(err){
            print.error('Fail to get geocode');
        }
        callback(err, resultList);
    });
};

ConCollector.prototype.processWuForecast = function(list, isRetry, callback){
    var self = this;
    var key = self.getWuKey();
    var failList = [];

    if(list.length === 0){
        print.info('There is no geocode');
        callback(0, failList);
        return;
    }
    try{
        async.mapSeries(list,
            function(location, cb){
                var requester = new wuRequester;
                requester.getForecast(location.geocode, key, function(err, result){
                    if(err){
                        print.error('Wu: get fail', location);
                        failList.push(location);
                        cb(null);
                        return;
                    }

                    print.info(result);
                    self.saveWuForecast(location.geocode, result, function(err){
                        cb(null);
                    })
                });
            },
            function(err){
                if(err){
                    print.error('');
                }

                if(isRetry > 0){
                    return self.processWuForecast(failList, --isRetry, callback);
                }else{
                    callback(err, failList);
                    return;
                }
            }
        );
    }
    catch(e){
        print.error('Exception!!!');
        if(callback){
            callback(e);
        }
    }
};

ConCollector.prototype.processWuCurrent = function(list, callback){
    var self = this;
};

ConCollector.prototype.makeDefaultWuForecast = function(){
    var self = this;
    var result = {};

    return result;
};

ConCollector.prototype.parseWuForecast = function(data){
    var self = this;
    var result = {};

    return result;
};

ConCollector.prototype.saveWuForecast = function(geocode, data, callback){
    var self = this;

    try{
        modelWuForecast.find({geocode:geocode}, function(err, list){
            if(err){
                print.error('fail to find from DB');
                callback(err);
                return;
            }
            callback(err);
        });
    }catch(e){
        print.error('Exception!!!');
        if(callback){
            callback(e);
        }
    }
};

ConCollector.prototype.saveWuCurrent = function(){
    var self = this;
};

ConCollector.prototype.getWuKey = function(){
    var self = this;
    return {id: self.keybox.wu_id, key: self.keybox.wu_key};
};

module.exports = ConCollector;
