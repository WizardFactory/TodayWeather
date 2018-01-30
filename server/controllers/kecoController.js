/**
 * Created by aleckim on 15. 11. 4..
 */

'use strict';

var async = require('async');

var SidoArpltn = require('../models/sido.arpltn.keco.model');

//var Town = require('../models/town');
var arpltnTown = require('../models/arpltnTownKeco');
var Arpltn = require('../models/arpltnKeco.js');
var MsrStn = require('../models/modelMsrStnInfo.js');
var Frcst = require('../models/modelMinuDustFrcst');
var keco = new (require('../lib/kecoRequester.js'))();
var kmaTimeLib = require('../lib/kmaTimeLib');

var AqiConverter = require('../lib/aqi.converter');
var convertGeocode = require('../utils/convertGeocode');

function arpltnController() {

}


/**
 * pm10, pm25는 넘어오는 grade값은 24h기준으로 오기 때문에, 1h로 변경함.
 * @param arpltn
 * @private
 */
arpltnController.recalculateValue = function (arpltn, airUnit) {

    if (arpltn == undefined) {
        return arpltn;
    }

    log.debug('airUnit : ', airUnit);

    ['pm10', 'pm25', 'o3', 'no2', 'co', 'so2'].forEach(function (name) {
        if (arpltn.hasOwnProperty(name+'Value')) {
            if (airUnit === 'airkorea' && arpltn.hasOwnProperty(name+'Grade') && arpltn[name+'Grade'] !== -1) {
                //skip for using data from airkorea server
                log.debug('skip name:'+name);
            }
            else {
                arpltn[name+'Index'] = AqiConverter.value2index(airUnit, name, arpltn[name+'Value']);
                arpltn[name+'Grade'] = AqiConverter.value2grade(airUnit, name, arpltn[name+'Value']);
                if (arpltn[name+'Grade'] === -1) {
                    delete  arpltn[name+'Grade'];
                    delete  arpltn[name+'Value'];
                    delete  arpltn[name+'Str'];
                }
            }
        }
    });

    if (airUnit === 'airkorea' && arpltn.khaiValue && arpltn.khaiValue !== -1) {
        arpltn.aqiIndex = arpltn.aqiValue = arpltn.khaiValue;
        arpltn.aqiGrade = arpltn.hasOwnProperty('khaiGrade')?arpltn.khaiGrade: AqiConverter.value2grade(airUnit, 'aqi', arpltn.aqiValue);
    }
    else {
        //aqicn은 가산점 줘야 하는지 확인 필요.
        var aqiValue = -1;
        ['pm10', 'pm25', 'o3', 'no2', 'co', 'so2'].forEach(function (name) {
            if (!arpltn.hasOwnProperty(name+'Index')) {
                arpltn[name+'Index'] = AqiConverter.value2index(airUnit, name, arpltn[name+'Value']);
            }
            if (arpltn[name+'Index'] > aqiValue) {
                aqiValue = arpltn[name+'Index'];
            }
        });
        arpltn.khaiValue = arpltn.aqiIndex = arpltn.aqiValue = aqiValue;
        arpltn.khaiGrade = arpltn.aqiGrade = AqiConverter.value2grade(airUnit, 'aqi', arpltn.aqiValue);
    }

    if (arpltn.aqiGrade === -1) {
        delete  arpltn.aqiGrade;
        delete  arpltn.aqiValue;
        delete  arpltn.aqiStr;
    }
    if (arpltn.khaiGrade === -1) {
        delete  arpltn.khaiGrade;
        delete  arpltn.khaiValue;
        delete  arpltn.khaiStr;
    }
    //xxxStr은 insertStrForData에서 진행

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
arpltnController._getArpLtnList = function (msrStnList, dateTime, callback) {
    if (!Array.isArray(msrStnList)) {
        callback(new Error("mstStnList is not array"));
        return this;
    }

    var limitTime = new Date(dateTime);
    limitTime.setHours(limitTime.getHours()-24);

    //순서를 위해서 mapSeries를 사용
    async.mapSeries(msrStnList,
        function(msrStn, cb) {
            Arpltn.find({stationName: msrStn.stationName, date: {$gt:limitTime}}, {_id: 0})
                .sort({date:-1})
                .lean()
                .exec(function (err, arpltnList) {
                    if (err) {
                        log.error(err);
                    }
                    if (arpltnList.length === 0) {
                        log.warn("Fail to find arpltn stationName="+msrStn.stationName);
                        return cb();
                    }
                    cb(err, arpltnList);
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
 * 가장 가까운 10개중에 가장 최근 것을 합침
 * @param arpltnList [가장 가까운 10개][최근 24시간]
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
        var src = arpltnList[i][0];

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

/**
 * convertUnits에서 grade값을 1증가시켜 실황 grade와 맞추고 있음
 * @param str
 * @returns {*}
 * @private
 */
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

arpltnController.getDustFrcst = function (town, date, callback) {
    var region = this._convertDustFrcstRegion(town.region, town.city);
    var self = this;
    var informDate = kmaTimeLib.convertYYYYMMDDtoYYYY_MM_DD(date);

    Frcst.find({"informData": {$gte:informDate}}, {_id:0}).lean().exec(function (err, dustFrcstList) {
        if (err) {
            return callback(err);
        }
        if (dustFrcstList.length == 0) {
            err = new Error("Fail to find dust forecast query="+JSON.stringify(query));
            return callback(err);
        }

        var resultList = [];

        dustFrcstList.forEach(function (dustFrcst) {
            for (var i=0; i<dustFrcst.informGrade.length;i++) {
                if (dustFrcst.informGrade[i].region === region)  {
                    if (dustFrcst.informGrade[i].grade != '예보없음') {

                        var result = resultList.filter(function (r) {
                            if (r.date == kmaTimeLib.convertYYYY_MM_DDtoYYYYMMDD(dustFrcst.informData)) {
                                return true;
                            }
                            return false;
                        })[0];

                        if (result == null) {
                            result = {};
                            result.date = kmaTimeLib.convertYYYY_MM_DDtoYYYYMMDD(dustFrcst.informData);
                            result.dustForecast = {};
                            result.dustForecast.sido = region;
                            resultList.push(result);
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

        if (resultList.length == 0) {
            err = new Error("dust forecast length is zero region:"+region+" informDate:"+informDate);
            return callback(err);
        }

        callback(err, resultList);
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
                self._getArpLtnList(msrStnList, dateTime, function (err, arpltnList) {
                    if (err) {
                        return cb(err);
                    }
                    return cb(err, arpltnList);
                });
            },
            function (arpltnList, cb) {
                //arpltn = [가장 가까운 10개][최근 24시간]
                var arpltn = self._mergeArpltnList(arpltnList, dateTime);
                return cb(undefined, {arpltn:arpltn, list: arpltnList[0]});
            }],
        function(err, arpltnObj) {
            if (err)  {
                return callback(err);
            }
            callback(err, arpltnObj);
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
    keco.setServiceKeys(JSON.parse(keyBox.airkorea_keys));
    keco.setDaumApiKeys(JSON.parse(keyBox.daum_keys));

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
            keco.getNearbyMsrstn(tmCoord.y, tmCoord.x, function(err, result) {
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
            keco.getRLTMCtprvn(sido, function (err, body) {
                if (err) {
                    return cb(err);
                }
                cb(err, body);
            });
        },
        function(xmlCtprvn, cb) {
            keco.parseRLTMCtprvn(xmlCtprvn, function (err, parsedDataList) {
                if (err) {
                    return cb(err);
                }
                cb(err, parsedDataList);
            });
        },
        function(parsedDataList, cb) {
            keco.saveRLTMCtprvn(parsedDataList, function(err){
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

arpltnController.getSidoArpltn = function (callback) {
    SidoArpltn.find({"cityName" : ""}).sort({date:-1}).limit(20).lean().exec(function (err, list) {
        if (err) {
            return callback(err);
        }
        if (list.length === 0) {
            return callback(new Error("Fail to find sido arpltn"));
        }
        var last = list[0].date;
        list = list.filter(function (obj) {
            return obj.date.getTime() === last.getTime();
        });
        if (list.length < 17) {
            log.error("Fail to get full sido arpltn");
        }
        callback(null, list);
    });
};

module.exports = arpltnController;

