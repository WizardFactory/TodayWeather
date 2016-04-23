/**
 * Created by aleckim on 15. 11. 4..
 */

'use strict';

var async = require('async');

var Town = require('../models/town');
var arpltnTown = require('../models/arpltnTownKeco');
var Arpltn = require('../models/arpltnKeco.js');
var MsrStn = require('../models/modelMsrStnInfo.js');
var Frcst = require('../models/modelMinuDustFrcst');
var keco = new (require('../lib/kecoRequester.js'))();
var kmaTimeLib = require('../lib/kmaTimeLib');

var convertGeocode = require('../utils/convertGeocode');

function arpltnController() {

}

arpltnController.parseSo2Info = function (so2Value, so2Grade) {
    if (so2Value < 0) {
        return "-";
    }
    else if (so2Value <= 0.02) {
        return "좋음";
    }
    else if(so2Value <= 0.05) {
        return "보통";
    }
    else if(so2Value <= 0.15) {
        return "나쁨";
    }
    else if(so2Value > 0.15) {
        return "매우나쁨";
    }
    else {
        log.warn("Fail to parse so2Value="+so2Value);
        switch (so2Grade) {
            case 1:
                return "좋음";
            case 2:
                return "보통";
            case 3:
                return "나쁨";
            case 4:
                return "매우나쁨";
            default :
                log.error("Unknown so2Grade="+so2Grade);
        }
    }
    return "-";
};

arpltnController.parseCoInfo = function (coValue, coGrade) {
      if (coValue < 0) {
        return "-";
    }
    else if (coValue <= 2) {
        return "좋음";
    }
    else if(coValue <= 9) {
        return "보통";
    }
    else if(coValue <= 15) {
        return "나쁨";
    }
    else if(coValue > 15) {
        return "매우나쁨";
    }
    else {
        log.warn("Fail to parse coValue="+coValue);
        switch (coGrade) {
            case 1:
                return "좋음";
            case 2:
                return "보통";
            case 3:
                return "나쁨";
            case 4:
                return "매우나쁨";
            default :
                log.error("Unknown coGrade="+coGrade);
        }
    }
    return "-";
};

arpltnController.parseNo2Info = function (no2Value, no2Grade) {
    if (no2Value < 0) {
        return "-";
    }
    else if (no2Value <= 0.03) {
        return "좋음";
    }
    else if(no2Value <= 0.06) {
        return "보통";
    }
    else if(no2Value <= 0.2) {
        return "나쁨";
    }
    else if(no2Value > 0.2) {
        return "매우나쁨";
    }
    else {
        log.warn("Fail to parse no2Value="+no2Value);
        switch (no2Grade) {
            case 1:
                return "좋음";
            case 2:
                return "보통";
            case 3:
                return "나쁨";
            case 4:
                return "매우나쁨";
            default :
                log.error("Unknown no2Grade="+no2Grade);
        }
    }
    return "-";
};

arpltnController.parseO3Info = function (o3Value, o3Grade) {
      if (o3Value < 0) {
        return "-";
    }
    else if (o3Value <= 0.03) {
        return "좋음";
    }
    else if(o3Value <= 0.09) {
        return "보통";
    }
    else if(o3Value <= 0.15) {
        return "나쁨";
    }
    else if(o3Value > 0.15) {
        return "매우나쁨";
    }
    else {
        log.warn("Fail to parse o3Value="+o3Value);
        switch (o3Grade) {
            case 1:
                return "좋음";
            case 2:
                return "보통";
            case 3:
                return "나쁨";
            case 4:
                return "매우나쁨";
            default :
                log.error("Unknown o3Grade="+o3Grade);
        }
    }
    return "-";
};

arpltnController.parseKhaiInfo = function (khaiValue, khaiGrade) {
    if (khaiValue < 0) {
        return "-";
    }
    else if (khaiValue <= 50) {
        return "좋음";
    }
    else if(khaiValue <= 100) {
        return "보통";
    }
    else if(khaiValue <= 250) {
        return "나쁨";
    }
    else if(khaiValue > 250) {
        return "매우나쁨";
    }
    else {
        log.warn("Fail to parse khaiValue="+khaiValue);
        switch (khaiGrade) {
            case 1:
                return "좋음";
            case 2:
                return "보통";
            case 3:
                return "나쁨";
            case 4:
                return "매우나쁨";
            default :
                log.error("Unknown khaiGrade="+khaiGrade);
        }
    }
    return "-";
};

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

    //순서를 위해서 mapSeries를 사용
    async.mapSeries(msrStnList,
        function(msrStn, cb) {
            Arpltn.find({stationName: msrStn.stationName}).limit(1).lean().exec(function (err, arpltnList) {
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

