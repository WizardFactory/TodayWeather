/**
 * Created by aleckim on 15. 11. 4..
 */

'use strict';

var async = require('async');

//var Town = require('../models/town');
var arpltnTown = require('../models/arpltnTownKeco');
var Arpltn = require('../models/arpltnKeco.js');
var MsrStn = require('../models/modelMsrStnInfo.js');
var Frcst = require('../models/modelMinuDustFrcst');
var keco = new (require('../lib/kecoRequester.js'))();
var kmaTimeLib = require('../lib/kmaTimeLib');

var convertGeocode = require('../utils/convertGeocode');

function arpltnController() {

}

/**
 * AQI grade 공통 사용.
 * @param grade
 * @param type so2, o3, co, no2
 * @returns {*}
 */
arpltnController.grade2str = function (grade, type) {
     switch (grade) {
        case 1:
            return __("LOC_GOOD");
        case 2:
            return __("LOC_MODERATE");
        case 3:
            return __("LOC_UNHEALTHY");
        case 4:
            return __("LOC_VERY_UNHEALTHY");
        default :
            log.error("Unknown grade="+grade+" type="+type);
    }
    return "";
};

/**
 * pm10, pm25는 넘어오는 grade값은 24h기준으로 오기 때문에, 1h로 변경함.
 * @param arpltn
 * @private
 */
arpltnController._recalculateValue = function (arpltn) {
    if (arpltn == undefined) {
        return arpltn;
    }

    if (arpltn.hasOwnProperty("pm10Value")) {
        arpltn.pm10Grade = (function (v) {
            if (v < 0) {
                return -1;
            }
            else if (v <= 30) {
                return 1;
            }
            else if (v <= 80) {
                return 2;
            }
            else if (v <= 150) {
                return 3;
            }
            else if (v > 150) {
                return 4;
            }
        })(arpltn.pm10Value);
    }

    if (arpltn.hasOwnProperty("pm25Value")) {
        arpltn.pm25Grade = (function (v) {
            if (v < 0) {
                return -1;
            }
            else if (v <=15) {
                return 1;
            }
            else if(v<=50) {
                return 2;
            }
            else if(v<=100) {
                return 3;
            }
            else if(v > 100) {
                return 4;
            }
        })(arpltn.pm25Value);
    }

    if (arpltn.hasOwnProperty("o3Value")) {
        arpltn.o3Grade = (function (v) {
            if (v < 0) {
                return -1;
            }
            else if (v <= 0.03) {
                return 1;
            }
            else if(v <= 0.09) {
                return 2;
            }
            else if(v <= 0.15) {
                return 3;
            }
            else if(v > 0.15) {
                return 4;
            }
        })(arpltn.o3Value);
    }

    if (arpltn.hasOwnProperty("no2Value")) {
        arpltn.no2Grade = (function (v) {
            if (v < 0) {
                return -1;
            }
            else if (v <= 0.03) {
                return 1;
            }
            else if(v <= 0.06) {
                return 2;
            }
            else if(v <= 0.2) {
                return 3;
            }
            else if(v > 0.2) {
                return 4;
            }
        })(arpltn.no2Value);
    }

    if (arpltn.hasOwnProperty("coValue")) {
        arpltn.coGrade = (function (v) {
            if (v < 0) {
                return -1;
            }
            else if (v <= 2) {
                return 1;
            }
            else if(v <= 9) {
                return 2;
            }
            else if(v <= 15) {
                return 3;
            }
            else if(v > 15) {
                return 4;
            }
        })(arpltn.coValue);
    }

    if (arpltn.hasOwnProperty("so2Value")) {
        arpltn.so2Grade = (function (v) {
            if (v < 0) {
                return -1;
            }
            else if (v <= 0.02) {
                return 1;
            }
            else if(v <= 0.05) {
                return 2;
            }
            else if(v <= 0.15) {
                return 3;
            }
            else if(v > 0.15) {
                return 4;
            }
        })(arpltn.so2Value);
    }

    if (arpltn.hasOwnProperty("khaiValue")) {
        arpltn.khaiGrade = (function (value) {
            if (value < 0) {
                return -1;
            }
            else if (value <= 50) {
                return 1;
            }
            else if(value <= 100) {
                return 2;
            }
            else if(value <= 250) {
                return 3;
            }
            else if(value > 250) {
                return 4;
            }
        })(arpltn.khaiValue);
    }

    return arpltn;
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

    //순서를 위해서 mapSeries를 사용
    async.mapSeries(msrStnList,
        function(msrStn, cb) {
            Arpltn.find({stationName: msrStn.stationName}, {_id: 0}).limit(1).lean().exec(function (err, arpltnList) {
                if (err) {
                    log.error(err);
                }
                if (arpltnList.length === 0) {
                    log.warn("Fail to find arpltn stationName="+msrStn.stationName);
                    return cb();
                }
                cb(err, arpltnList[0]);
            });
        },
        function(err, results) {
            if (err) {
                return callback(err);
            }

            results = results.filter(function (arpltn) {
                return !!arpltn;
            });

            callback(err, results);
        });

    return this;
};

/**
 * item 항목이 모두 채워지면 true
 * @param arpltn
 * @param itemList
 * @returns {boolean}
 * @private
 */
arpltnController._checkArpltnDataValid = function (arpltn, itemList) {
    for (var i=0; i<itemList.length; i++) {
        if (arpltn[itemList[i]+'Value'] == undefined) {
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
    var arpltnTime;
    if (arpltn.dataTime.indexOf('24:00') >= 0) {
        //set 00:00 of next date
        arpltnTime = new Date(arpltn.dataTime.substr(0,10));
        arpltnTime.setDate(arpltnTime.getDate()+1);
        arpltnTime.setHours(0);
    }
    else {
        arpltnTime = new Date(arpltn.dataTime);
    }

    dateTime.setHours(dateTime.getHours()-8);

    return dateTime.getTime() < arpltnTime.getTime();
};

/**
 *
 * @param arpltnList
 * @param currentTime
 * @returns {*}
 * @private
 */
arpltnController._mergeArpltnList = function (arpltnList, currentTime) {
    var arpltn;
    var self = this;
    var itemList = ['co', 'khai', 'no2', 'o3', 'pm10', 'pm25', 'so2'];

    if (!Array.isArray(arpltnList)) {
        log.error(new Error("arpltn is not array"));
        return;
    }

    for (var i=0; i<arpltnList.length; i++) {
        var src = arpltnList[i];

        if(self._checkDateTime(src, currentTime)) {
            if (arpltn === undefined) {
                arpltn =  {};
                for (var key in src) {
                    if (src[key] != undefined && src[key] != -1) {
                        arpltn[key] = src[key];
                    }
                }
            }
            else {
                itemList.forEach(function (name) {
                    if (arpltn[name+'Value'] == undefined && src[name+'Value'] !== -1) {
                        arpltn[name+'Value'] = src[name+'Value'];
                        arpltn[name+'Grade'] = src[name+'Grade'];
                        arpltn[name+'StationName'] = src.stationName;
                    }
                });
            }
        }

        if (arpltn && self._checkArpltnDataValid(arpltn, itemList)) {
            break;
        }
    }

    return arpltn;
};

arpltnController._convertDustFrcstRegion = function (region, city) {
    var sido = keco.convertRegionToSido(region);

    if (sido ==='강원' || sido ==='경기') {
        var regionName;
        city = city.slice(0,3);
        for (var i=0; i<manager.codeTable.length; i++) {
            var codeItem =  manager.codeTable[i];
            if (codeItem.first === region && codeItem.second === city) {
                regionName = codeItem.regionName;
                break;
            }
        }
        switch (regionName) {
            case '강원동부':
                sido = '영동';
                break;
            case '강원서부':
            case '강원남서':
                sido = '영서';
                break;
            case '경기북부':
                sido = '경기북부';
                break;
            case '경기서부':
            case '경기남부':
                sido = '경기남부';
                break;
            default :
                log.error("dust forecast region : Fail to find region sido="+sido);
                break;
        }
   }

    return sido;
};

arpltnController._convertDustForecastStrToGrade = function (str) {
    switch (str) {
        case "좋음":
            return 0;
            break;
        case "보통":
            return 1;
            break;
        case "나쁨":
            return 2;
            break;
        case "매우나쁨":
            return 3;
            break;
        default:
            log.error("Fail to convert dust forecast str="+str);
            break;
    }
    return "";
};

arpltnController.getDustFrcst = function (town, dateList, callback) {
    var region = this._convertDustFrcstRegion(town.region, town.city);
    var informDataList = [];
    var self = this;

    dateList.forEach(function (date) {
        informDataList.push(kmaTimeLib.convertYYYYMMDDtoYYYY_MM_DD(date));
    });

    async.map(informDataList, function (informData, cb) {
        Frcst.find({informData: informData}, {_id:0}).lean().exec(function (err, dustFrcstList) {
            if (err) {
                return cb(err)
            }

            if (dustFrcstList.length === 0) {
                return cb(err);
            }

            var result = {};
            result.date = kmaTimeLib.convertYYYY_MM_DDtoYYYYMMDD(informData);

            dustFrcstList.forEach(function (dustFrcst) {
                for (var i=0; i<dustFrcst.informGrade.length;i++) {
                    if (dustFrcst.informGrade[i].region === region)  {
                        if (dustFrcst.informGrade[i].grade != '예보없음') {
                            if (result.dustForecast === undefined) {
                                result.dustForecast = {};
                            }
                            var keyGradeStr = dustFrcst.informCode+"Grade";
                            var keyStrStr = dustFrcst.informCode+"Str";
                            result.dustForecast[keyGradeStr] = self._convertDustForecastStrToGrade(dustFrcst.informGrade[i].grade);
                            result.dustForecast[keyStrStr] = dustFrcst.informGrade[i].grade;
                        }
                        return;
                    }
                }
            });

            if (result.dustForecast == undefined) {
                return cb(err);
            }
            result.dustForecast.sido = region;
            cb(err, result);
        });
    }, function (err, results) {
        if (err) {
            return callback(err);
        }
        results = results.filter(function (result) {
            return !!result;
        });
        return callback(err, results);
    });

    return this;
};

/**
 *
 * @param townInfo
 * @param dateTime
 * @param callback
 * @returns {arpltnController}
 */
arpltnController.getArpLtnInfo = function (townInfo, dateTime, callback) {
    var self = this;

    async.waterfall([
            function(cb) {
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
            },
            function (arpltn, cb) {
                return cb(undefined, self._recalculateValue(arpltn));
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

