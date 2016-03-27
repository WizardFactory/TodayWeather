/**
 * Created by aleckim on 15. 11. 4..
 */

'use strict';

var Town = require('../models/town');
var arpltnTown = require('../models/arpltnTownKeco');
var Arpltn = require('../models/arpltnKeco.js');
var MsrStn = require('../models/modelMsrStnInfo.js');

var async = require('async');

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
       return "-";
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
        return "-";
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

arpltnController._mregeData = function(town, current, arpltnDataList, callback){
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
        return callback(err, arpltnData);
    }
    catch(e) {
        callback(e);
    }
};

/**
 *
 * @param msrStnList
 * @param callback
 * @returns {arpltnController}
 * @private
 */
arpltnController._getArpLtnList = function (msrStnList, callback) {
    if (!Array.isArray(msrStnList)) {
        callback(new Error("mstStnList is not array"));
        return this;
    }

    async.mapSeries(msrStnList,
        function(msrStn, cb) {
            Arpltn.find({stationName: msrStn.stationName}).limit(1).lean().exec(function (err, arpltnList) {
                if (err) {
                    log.error(err);
                }
                cb(err, arpltnList[0]);
            });
        },
        function(err, results) {
            if (err) {
                return callback(err);
            }
            //results.sort(function (a, b) {
            //    if (a.index < b.index) {
            //        return -1;
            //    }
            //    else if (a.index > b.index) {
            //        return 1;
            //    }
            //    return 0;
            //});
            callback(err, results);
        });

    return this;
};

/**
 *
 * @param arpltn
 * @returns {boolean}
 * @private
 */
arpltnController._checkArpltnDataValid = function (arpltn) {
    for (var key in arpltn) {
        if (typeof arpltn[key] === 'number' && arpltn[key] === -1) {
            return false;
        }
    }

    return true;
};

/**
 * 8시간 이내의 경우 사용
 * @param dateTime
 * @param arpltn
 * @returns {boolean}
 * @private
 */
arpltnController._checkDateTime = function(arpltn, dateTime) {
    var arpltnTime = new Date(arpltn.dataTime);
    dateTime.setHours(dateTime.getHours()-8);
    if (dateTime.getTime() < arpltnTime.getTime()) {
        return true;
    }
    return false;
};

/**
 *
 * @param arpltnList
 * @returns {*}
 * @private
 */
arpltnController._mergeArpltnList = function (arpltnList, currentTime) {
    var arpltn;
    var self = this;

    if (!Array.isArray(arpltnList)) {
        log.error(new Error("arpltn is not array"));
        return arpltn;
    }

    for (var i=0; i<arpltnList.length; i++) {
        var src = arpltnList[i];

        if(self._checkDateTime(src, currentTime)) {
            if (arpltn === undefined) {
                arpltn =  new Object(src);
            }
            else {
                ['co', 'khai', 'no2', 'o3', 'pm10', 'pm25', 'so2'].forEach(function (name) {
                    if (arpltn[name+'Value'] === -1 && src[name+'Value'] !== -1) {
                        arpltn[name+'Value'] = src[name+'Value'];
                        arpltn[name+'Grade'] = src[name+'Grade'];
                        arpltn[name+'StationName'] = src.stationName;
                    }
                });
            }
        }

        if (arpltn && self._checkArpltnDataValid(arpltn)) {
            break;
        }
    }

    return arpltn;
};

arpltnController.getArpLtnInfo = function (town, dateTime, callback) {
    var self = this;

    async.waterfall([
            function(cb) {
                Town.find({"town.first":town.first, "town.second":town.second, "town.third":town.third}).
                    limit(1).lean().exec(function (err, townInfo) {
                        if (err) {
                            return cb(err);
                        }
                        if(townInfo.length === 0) {
                            err = new Error("Fail to find town="+JSON.stringify(town));
                            return cb(err);
                        }
                        return cb(err, townInfo[0]);
                    });
            },
            function(townInfo, cb) {
                var coords = [townInfo.gCoord.lon, townInfo.gCoord.lat];
                MsrStn.find({geo: {$near:coords, $maxDistance: 1}}).limit(10).lean().exec(function (err, msrStnList) {
                    if (err) {
                        return cb(err);
                    }
                    return cb(err, msrStnList);
                });
            },
            function (msrStnList, cb) {
                self._getArpLtnList(msrStnList, function (err, arpltnList) {
                    if (err) {
                        return cb(err);
                    }
                    return cb(err, arpltnList);
                });
            },
            function (arpltnList, cb) {
                var arpltn = self._mergeArpltnList(arpltnList, dateTime);
                return cb(undefined, arpltn);
            }],
        function(err, arpltn) {
            if (err)  {
                return callback(err);
            }
            callback(err, arpltn);
        });

    return this;
};

arpltnController._appendFromDb = function(town, current, callback) {
    var self = this;

    async.waterfall([
            function(cb){
                arpltnTown.find({town:town}).limit(1).lean().exec(function (err, arpltnDataList) {
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

                    arpltnTown.find({'mCoord.mx':result.mx, 'mCoord.my':result.my}).limit(1).lean().exec(function (err, arpltnDataList) {
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
            self._mregeData(town, current, result, callback);
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
            keco.getStationNameFromMsrstn(xmlStationInfoList, function (err, stationName) {
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

