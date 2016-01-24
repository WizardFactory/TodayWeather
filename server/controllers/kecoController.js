/**
 * Created by aleckim on 15. 11. 4..
 */

'use strict';

var arpltn = require('../models/arpltnTownKeco');
var convertGeocode = require('../utils/convertGeocode');

function arpltnController() {

}

/**
 *
 * @param pm10Value
 * @param pm10Grade
 * @returns {*}
 */
arpltnController.parsePm10Info = function(pm10Value, pm10Grade) {
    if (pm10Value < 0) {
       return "없음";
    }
    else if (pm10Value <= 30) {
        return "좋음";
    }
    else if (pm10Value <= 80) {
        return "보통";
    }
    else if (pm10Value <= 150) {
        return "나쁨";
    }
    else if (pm10Value > 150) {
        return "매우나쁨";
    }
    else {
        log.warn("Fail to parse pm10Value="+pm10Value);
        switch (pm10Grade) {
            case 1:
                return "좋음";
            case 2:
                return "보통";
            case 3:
                return "나쁨";
            case 4:
                return "매우나쁨";
            default :
                log.error("Unknown pm10Grade="+pm10Grade);
        }
    }
    return "-";
};

arpltnController.parsePm25Info = function (pm25Value, pm25Grade) {
    if (pm25Value < 0) {
        return "없음";
    }
    else if (pm25Value <=15) {
        return "좋음";
    }
    else if(pm25Value<=50) {
        return "보통";
    }
    else if(pm25Value<=100) {
        return "나쁨";
    }
    else if(pm25Value > 100) {
        return "매우나쁨";
    }
    else {
        log.warn("Fail to parse pm25Value="+pm25Value);
        switch (pm25Grade) {
            case 1:
                return "좋음";
            case 2:
                return "보통";
            case 3:
                return "나쁨";
            case 4:
                return "매우나쁨";
            default :
                log.error("Unknown pm25Grade="+pm25Grade);
        }
    }
    return "-";
};

arpltnController._mregeData = function(current, arpltnDataList, callback){
    var self = this;
    var err = undefined;

    try {
        if (arpltnDataList.length === 0) {
            err = new Error('Fail to find arpltn town='+JSON.stringify(town));
            return callback(err);
        }
        var arpltnData = arpltnDataList[0];
        if (!arpltnData) {
            err = new Error('Fail to find arpltn ' + JSON.stringify(town));
            log.error(err);
            return callback(err);
        }

        log.silly(JSON.stringify(arpltnData));

        current.arpltn = arpltnData.arpltn;
        current.arpltn.pm10Str = self.parsePm10Info(arpltnData.arpltn.pm10Value, arpltnData.arpltn.pm10Grade);
        current.arpltn.pm25Str = self.parsePm25Info(arpltnData.arpltn.pm25Value, arpltnData.arpltn.pm25Grade);
        return callback(err, arpltnData);
    }
    catch(e) {
        callback(e);
    }
};

arpltnController._appendFromDb = function(town, current, callback) {
    var self = this;
    var async = require('async');

    async.waterfall([
            function(cb){
                arpltn.find({town:town}).limit(1).lean().exec(function (err, arpltnDataList) {
                    if(err || arpltnDataList.length === 0){
                        log.warn(err);
                        return cb(null);
                    }

                    return cb('goto exit', arpltnDataList);

                });
            },
            function(cb){
                convertGeocode(town.first, town.second, town.third, function (err, result) {
                    if(err){
                        return cb(null);
                    }

                    arpltn.find({'mCoord.mx':result.mx, 'mCoord.my':result.my}).limit(1).lean().exec(function (err, arpltnDataList) {
                        if(err || arpltnDataList.length === 0){
                            log.warn(err);
                            return cb(null);
                        }

                        return cb('goto exit', arpltnDataList);

                    });
                });
            }
        ],
    function(err, result){
        if(result){
            self._mregeData(current, result, callback);
            return;
        }

        callback(new Error('Can not find data from DB'));
    });
};

arpltnController._appendFromKeco = function(town, current, callback) {

    var keyBox = require('../config/config').keyString;
    var keco = new (require('../lib/kecoRequester.js'))();
    keco.setServiceKey(keyBox.normal);
    keco.setDaumApiKey(keyBox.daum_key);

    var async = require('async');

    async.waterfall([
        function(cb) {
            convertGeocode(town.first, town.second, town.third, function(err, result) {
                if (err) {
                    return callback(err);
                }
                town.mCoord = result;
                return cb(err, result);
            });
        },
        function(geoCode, cb) {
            keco.getTmPointFromWgs84(keco.getDaumApiKey(), geoCode.lat, geoCode.lon,
                function (err, body) {
                    if (err) {
                        return cb(err);}

                    log.debug(body);
                    town.tmCoord = {x:body.x, y:body.y};
                    cb(err, town.tmCoord);
                });
        },
        function(tmCoord, cb) {
            keco.getNearbyMsrstn(keco.getServiceKey(), tmCoord.y, tmCoord.x, function(err, result) {
                if (err) {
                    return cb(err);}
                log.debug(result);
                return cb(err, result);
            });
        },
        function(xmlStationInfoList, cb) {
            keco.parseMsrstn(xmlStationInfoList, function (err, stationName) {
                if (err) {
                    return cb(err);}
                log.debug(stationName);
                town.kecoStationName = stationName;
                cb(err, stationName);
            });
        },
        function(stationName, cb) {
            var sido = keco.convertRegionToSido(town.first);
            keco.getCtprvn(keco.getServiceKey(), sido, function (err, body) {
                if (err) {
                    return cb(err);
                }
                cb(err, body);
            });
        },
        function(xmlCtprvn, cb) {
            keco.parseCtprvn(xmlCtprvn, function (err, parsedDataList) {
                if (err) {
                    return cb(err);
                }
                cb(err, parsedDataList);
            });
        },
        function(parsedDataList, cb) {
            keco.saveCtprvn(parsedDataList, function(err){
                if (err) {
                    log.warn(err);
                }
                log.debug('save ctprvn');
                //update townlist?
                //add arpltTownKeco

                //never mind about save
                //return cb(err);
            });

            parsedDataList.every(function(arpltn) {
                if (arpltn.stationName === town.kecoStationName) {
                    cb(undefined, arpltn);
                    return false;
                }
                return true;
            });
            return cb(new Error("Fail to find station "+town.kecoStationName));
        }
    ], function(err, arpltn) {
        if(err){
            return callback(err);
        }
        if (arpltn) {
            current.arpltn = arpltn;
        }

        log.debug(arpltn);

        //never mind about save
        var tempTown = { "first" : town.first, "second" : town.second, "third" : town.third};
        var mCoord = {mx: town.mCoord.mx, my:town.mCoord.my};
        arpltn.pm10Str = self.parsePm10Info(arpltn.pm10Value, arpltn.pm10Grade);
        arpltn.pm25Str = self.parsePm25Info(arpltn.pm25Value, arpltn.pm25Grade);

        keco.saveArpltnTown({town: tempTown, mCoord: mCoord}, arpltn, function (err) {
            if (err) {
                log.warn(err);
            }
        });

        callback(err, arpltn);
    });
};

arpltnController.appendData = function(town, current, callback) {
    var self = this;
    this._appendFromDb(town, current, function(err, arpltn) {
        if (err) {
            log.debug(err);
            return self._appendFromKeco(town, current, callback);
        }
        return callback(err, arpltn);
    });
};

module.exports = arpltnController;

