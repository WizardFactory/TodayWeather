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

var UnitConverter = require('../lib/unitConverter');
var convertGeocode = require('../utils/convertGeocode');

function arpltnController() {

}

/**
 *
 * @param Mal
 *           so2 분자량 : 15.99 + 15.99 + 32.07 = 64.05
 *           no2 분자량 : 15.99 + 15.99 + 14.01 = 45.99
 *           O3 분자량 : 15.99 + 15.99 + 15.99 = 47.97
 *           CO 분자량 : 15.99 + 12.01 = 28
 * @param value
 * @returns {Number}
 * @private
 */
arpltnController._convertPpmToUm = function (Mol, value){
    var ppb = parseFloat(value * 1000);
    var molList = {
        so2: 64.05,
        no2: 45.99,
        o3: 47.97,
        co: 28.00
    };

    if(molList[Mol] == undefined){
        return -1;
    }

    return parseFloat(ppb * molList[Mol] / 22.4);
};

/**
 * pm10, pm25는 넘어오는 grade값은 24h기준으로 오기 때문에, 1h로 변경함.
 * @param arpltn
 * @private
 */
arpltnController.recalculateValue = function (arpltn, aqiUnit, ts) {
    var self = this;

    if (arpltn == undefined) {
        return arpltn;
    }

    log.info('aqiUnit : ', aqiUnit);

    if (arpltn.hasOwnProperty("pm10Value")) {
        arpltn.pm10Grade = (function (v, aqiUnit) {
            var unit = [0, 30, 80, 150];

            if(aqiUnit == 'airkorea_who'){
                unit = [0, 30, 50, 100];
            }else if(aqiUnit == 'airnow'){
                unit = [0, 54, 154, 254, 354, 424];
            }else if(aqiUnit == 'aircn'){
                unit = [0, 50, 150, 250, 350, 420];
            }
            else if(aqiUnit == 'airkorea'){
                unit = [0, 30, 80, 150];
            }

            if (v < unit[0]) {
                return -1;
            }
            else if (v <= unit[1]) {
                return 1;
            }
            else if (v <= unit[2]) {
                return 2;
            }
            else if (v <= unit[3]) {
                return 3;
            }
            else if (v > unit[3]) {

                if(unit.length > 4){
                    if(v <= unit[4]){
                        return 4;
                    }else if(v <= unit[5]){
                        return 5;
                    }else if(v > unit[5]){
                        return 6;
                    }
                }

                return 4;
            }
        })(arpltn.pm10Value, aqiUnit);
    }

    if (arpltn.hasOwnProperty("pm25Value")) {
        arpltn.pm25Grade = (function (v, aqiUnit) {
            var unit = [0, 15, 50, 100];

            if(aqiUnit == 'airkorea_who'){
                unit = [0, 15, 25, 50];
            }else if(aqiUnit == 'airnow'){
                unit = [0, 12.0, 35.4, 55.4, 150.4, 250.4];
            }else if(aqiUnit == 'aircn'){
                unit = [0, 35, 75, 115, 150, 250];
            }
            else if (aqiUnit == 'airkorea') {
                unit = [0, 15, 50, 100];
            }

            if (v < unit[0]) {
                return -1;
            }
            else if (v <= unit[1]) {
                return 1;
            }
            else if(v<=unit[2]) {
                return 2;
            }
            else if(v<=unit[3]) {
                return 3;
            }
            else if(v > unit[3]) {

                if(unit.length > 4){
                    if(v <= unit[4]){
                        return 4;
                    }else if(v <= unit[5]){
                        return 5;
                    }else if(v > unit[5]){
                        return 6;
                    }
                }

                return 4;
            }
        })(arpltn.pm25Value, aqiUnit);
    }

    if (arpltn.hasOwnProperty("o3Value")) {
        arpltn.o3Grade = (function (v) {
            var unit = [0,0.03, 0.09, 0.15];
            var tmpValue = 0;
            if(aqiUnit == 'airnow'){
                unit = [0, 54, 124, 164, 204, 404];

                v = v * 1000;   // ppm -> ppb

            }else if(aqiUnit == 'aircn'){
                unit = [0, 160, 200, 300, 400, 800];

                // ppm -> ug/m3
                tmpValue = self._convertPpmToUm('o3', arpltn.o3Value);
                if(tmpValue > 0){
                    v = tmpValue;
                }
            }
            else if (aqiUnit == 'airkorea' || aqiUnit == 'airkorea_who') {
                unit = [0, 0.03, 0.09, 0.15];
            }

            if (v < unit[0]) {
                return -1;
            }
            else if (v <= unit[1]) {
                return 1;
            }
            else if(v <= unit[2]) {
                return 2;
            }
            else if(v <= unit[3]) {
                return 3;
            }
            else if(v > unit[3]) {

                if(unit.length > 4){
                    if(v <= unit[4]){
                        return 4;
                    }else if(v <= unit[5]){
                        return 5;
                    }else if(v > unit[5]){
                        return 6;
                    }
                }

                return 4;
            }
        })(arpltn.o3Value);
    }

    if (arpltn.hasOwnProperty("no2Value")) {
        arpltn.no2Grade = (function (v) {
            var unit = [0, 0.03, 0.06, 0.2];
            var tmpValue = 0;
            if(aqiUnit == 'airnow'){
                unit = [0, 53, 100, 360, 649, 1249];

                v = v * 1000;    // ppm -> ppb

            }else if(aqiUnit == 'aircn'){
                unit = [0, 100, 200, 700, 1200, 2340];

                // ppm --> ug/m3
                tmpValue = self._convertPpmToUm('no2', arpltn.no2Value);
                if(tmpValue > 0){
                    v = tmpValue;
                }
            }
            else if (aqiUnit == 'airkorea' || aqiUnit == 'airkorea_who') {
                unit = [0, 0.03, 0.06, 0.2];
            }

            if (v < unit[0]) {
                return -1;
            }
            else if (v <= unit[1]) {
                return 1;
            }
            else if(v <= unit[2]) {
                return 2;
            }
            else if(v <= unit[3]) {
                return 3;
            }
            else if(v > unit[3]) {

                if(unit.length > 4){
                    if(v <= unit[4]){
                        return 4;
                    }else if(v <= unit[5]){
                        return 5;
                    }else if(v > unit[5]){
                        return 6;
                    }
                }

                return 4;
            }
        })(arpltn.no2Value);
    }

    if (arpltn.hasOwnProperty("coValue")) {
        arpltn.coGrade = (function (v) {
            var unit = [0, 2, 9, 15];
            var tmpValue = 0;
            if(aqiUnit == 'airnow'){
                unit = [0, 4.4, 9.4, 12.4, 15.4, 30.4];
            }else if(aqiUnit == 'aircn'){
                unit = [0, 5, 10, 35, 60, 90];

                // ppm --> mg/m3
                tmpValue = self._convertPpmToUm('no2', arpltn.no2Value) * 1000;
                if(tmpValue > 0){
                    v = tmpValue;
                }
            }
            else if (aqiUnit == 'airkorea' || aqiUnit == 'airkorea_who') {
                unit = [0, 2, 9, 15];
            }

            if (v < unit[0]) {
                return -1;
            }
            else if (v <= unit[1]) {
                return 1;
            }
            else if(v <= unit[2]) {
                return 2;
            }
            else if(v <= unit[3]) {
                return 3;
            }
            else if(v > unit[3]) {

                if(unit.length > 4){
                    if(v <= unit[4]){
                        return 4;
                    }else if(v <= unit[5]){
                        return 5;
                    }else if(v > unit[5]){
                        return 6;
                    }
                }

                return 4;
            }
        })(arpltn.coValue);
    }

    if (arpltn.hasOwnProperty("so2Value")) {
        arpltn.so2Grade = (function (v) {
            var unit = [0, 0.02, 0.05, 0.15];
            var tmpValue = 0;
            if(aqiUnit == 'airnow'){
                unit = [0, 35, 75, 185, 304, 604];

                v = v * 1000;   // ppm -> ppb
            }else if(aqiUnit == 'aircn'){
                unit = [0, 150, 500, 650, 800, 1600];

                // ppm --> ug/m3
                tmpValue = self._convertPpmToUm('no2', arpltn.no2Value);
                if(tmpValue > 0){
                    v = tmpValue;
                }
            }
            else if (aqiUnit == 'airkorea' || aqiUnit == 'airkorea_who') {
                unit = [0, 0.02, 0.05, 0.15];
            }

            if (v < unit[0]) {
                return -1;
            }
            else if (v <= unit[1]) {
                return 1;
            }
            else if(v <= unit[2]) {
                return 2;
            }
            else if(v <= unit[3]) {
                return 3;
            }
            else if(v > unit[3]) {

                if(unit.length > 4){
                    if(v <= unit[4]){
                        return 4;
                    }else if(v <= unit[5]){
                        return 5;
                    }else if(v > unit[5]){
                        return 6;
                    }
                }

                return 4;
            }
        })(arpltn.so2Value);
    }

    if (arpltn.hasOwnProperty("khaiValue")) {
        arpltn.khaiGrade = (function (v) {
            var unit = [0, 50, 100, 250];

            if(aqiUnit == 'airnow' || aqiUnit == 'aircn'){
                unit = [0, 50, 100, 150, 200, 300];
            }
            else if (aqiUnit == 'airkorea' || aqiUnit == 'airkorea_who') {
                unit = [0, 50, 100, 250];
            }

            if (v < unit[0]) {
                return -1;
            }
            else if (v <= unit[1]) {
                return 1;
            }
            else if(v <= unit[2]) {
                return 2;
            }
            else if(v <= unit[3]) {
                return 3;
            }
            else if(v > unit[3]) {

                if(unit.length > 4){
                    if(v <= unit[4]){
                        return 4;
                    }else if(v <= unit[5]){
                        return 5;
                    }else if(v > unit[5]){
                        return 6;
                    }
                }

                return 4;
            }
        })(arpltn.khaiValue);
    }

    ['pm10', 'pm25', 'o3', 'no2', 'co', 'so2', 'khai'].forEach(function (name) {
        if (arpltn[name+'Grade'] == -1) {
            delete  arpltn[name+'Grade'];
            delete  arpltn[name+'Value'];
            delete  arpltn[name+'Str'];
        }
    });

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
arpltnController._getArpLtnList = function (msrStnList, callback) {
    if (!Array.isArray(msrStnList)) {
        callback(new Error("mstStnList is not array"));
        return this;
    }

    //순서를 위해서 mapSeries를 사용
    async.mapSeries(msrStnList,
        function(msrStn, cb) {
            Arpltn.find({stationName: msrStn.stationName}, {_id: 0}).sort({date:-1}).limit(1).lean().exec(function (err, arpltnList) {
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
    var self = this;

    var query;
    var array = [];
    dateList.forEach(function (date) {
        var q = {informData: kmaTimeLib.convertYYYYMMDDtoYYYY_MM_DD(date)};
        array.push(q);
    });
    query = {$or: array};
    Frcst.find(query, {_id:0}).lean().exec(function (err, dustFrcstList) {
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
            err = new Error("dust forecast length is zero query="+JSON.stringify(query));
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

module.exports = arpltnController;

