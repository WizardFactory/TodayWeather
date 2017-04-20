/**
 * 대기오염정보 조회 서비스 http://openapi.airkorea.or.kr/
 * provider에서 미세먼지 가지고와서 DB에 저장하기. #225
 * Created by aleckim on 2015. 10. 24..
 */

'use strict';

var xml2json  = require('xml2js').parseString;
var async = require('async');
var req = require('request');

var Arpltn = require('../models/arpltnKeco.js');
var MsrStn = require('../models/modelMsrStnInfo.js');
var Frcst = require('../models/modelMinuDustFrcst');
var kmaTimeLib = require('../lib/kmaTimeLib');

var DOMAIN_ARPLTN_KECO = 'http://openapi.airkorea.or.kr/openapi/services/rest';

var PATH_MSRSTN_INFO_INQIRE_SVC = 'MsrstnInfoInqireSvc';
var NEAR_BY_MSRSTN_LIST = 'getNearbyMsrstnList';
var MSRSTN_LIST = 'getMsrstnList';
var MINU_DUST_FRCST_DSPTH = 'getMinuDustFrcstDspth';

var PATH_ARPLTN_INFOR_INQIRE_SVC = 'ArpltnInforInqireSvc';
var CTPRVN_RLTM_MESURE_DNSTY = 'getCtprvnRltmMesureDnsty';

/**
 *
 * @constructor
 */
function Keco() {
    this._nextGetCtprvnTime = new Date();
    this._svcKey ='';
    this._sidoList = [];
    this._currentSidoIndex = 0;
    this._daumApiKey = '';  //for convert x,y
}

/**
 *
 * @param key
 * @returns {Keco}
 */
Keco.prototype.setDaumApiKey = function (key) {
    this._daumApiKey = key;
    return this;
};

/**
 *
 * @returns {string|*}
 */
Keco.prototype.getDaumApiKey = function () {
    return this._daumApiKey;
};

/**
 *
 * @param key
 * @returns {Keco}
 */
Keco.prototype.setServiceKey = function(key) {
    this._svcKey = key;
    return this;
};

/**
 *
 * @returns {string|*}
 */
Keco.prototype.getServiceKey = function() {
    return this._svcKey;
};

/**
 *
 * @returns {Array}
 */
Keco.prototype.getCtprvnSidoList = function() {

    //get from town.js
    this._sidoList = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '경기', '강원', '충북', '충남', '전북', '전남', '경북',
        '경남', '제주', '세종'
    ];

    return this._sidoList;
};

Keco.prototype.convertRegionToSido = function(regionName) {
    switch (regionName) {
        case '강원도': case '강원':
            return '강원';
        case '서울특별시': case '서울시': case '서울':
            return '서울';
        case '경기도': case '경기':
            return '경기';
        case '경상남도': case '경남':
            return '경남';
        case '경상북도': case '경북':
            return '경북';
        case '광주광역시': case '광주시': case '광주':
            return '광주';
        case '대구광역시': case '대구시': case '대구':
            return '대구';
        case '대전광역시': case '대전시': case '대전':
            return '대전';
        case '부산광역시': case '부산시': case '부산':
            return '부산';
        case '울산광역시': case '울산시': case '울산':
            return '울산';
        case '충청북도':case '충북':
            return '충북';
        case '충청남도':case '충남':
            return '충남';
        case '인천광역시': case '인천시': case '인천':
            return '인천';
        case '전라남도':case '전남':
            return '전남';
        case '전라북도':case '전북':
            return '전북';
        case '제주특별자치도':case '제주도':case '제주':
            return '제주';
        case '세종특별자치시':case '세종시':case '세종':
            return '세종';
    }
    return '';
};

/**
 *
 * @param sido
 * @param key
 * @returns {string}
 */
Keco.prototype.getUrlCtprvn = function(sido, key) {
    if (!key)  {
        key = this._svcKey;
    }

    if (!key) {
        log.error("You have to set key");
        return;
    }
    sido = encodeURIComponent(sido);
    return DOMAIN_ARPLTN_KECO + '/' + PATH_ARPLTN_INFOR_INQIRE_SVC + '/' + CTPRVN_RLTM_MESURE_DNSTY +
        '?ServiceKey='+key +
        '&sidoName='+sido +
        '&pageNo='+ 1 +
        '&ver=1.0'+
        '&numOfRows='+999;
};

/**
 *
 * @param time
 * @returns {boolean}
 */
Keco.prototype.checkGetCtprvnTime = function(time) {
    return time.getTime() >= this._nextGetCtprvnTime.getTime();
};

/**
 *
 * @returns {Keco}
 */
Keco.prototype.updateTimeGetCtprvn = function() {
    this._nextGetCtprvnTime.setHours(this._nextGetCtprvnTime.getHours()+1);
    this._nextGetCtprvnTime.setMinutes(5);
    this._nextGetCtprvnTime.setSeconds(0);

    return this;
};

/**
 * It hasn't supported json format
 * @param key
 * @param sidoName
 * @param callback
 */
Keco.prototype.getCtprvn = function(key, sidoName, callback)  {
    var url = this.getUrlCtprvn(sidoName, key);

    log.debug(url);

    req(url, function(err, response, body) {
        if (err) {
            return callback(err);
        }
        if ( response.statusCode >= 400) {
            return callback(new Error(body));
        }
        return callback(err, body);
    });
};

/**
 * refer arpltnKeco.js
 * @param stationName
 * @param dataTime
 * @param so2Value
 * @param coValue
 * @param o3Value
 * @param no2Value
 * @param pm10Value
 * @param pm25Value
 * @param khaiValue
 * @param khaiGrade
 * @param so2Grade
 * @param coGrade
 * @param o3Grade
 * @param no2Grade
 * @param pm10Grade
 * @param pm25Grade
 * @returns {{}}
 */
Keco.prototype.makeArpltn = function (stationName, dataTime, so2Value, coValue,
                                      o3Value, no2Value, pm10Value, pm25Value, khaiValue,
                                      khaiGrade, so2Grade, coGrade, o3Grade,
                                      no2Grade, pm10Grade, pm25Grade) {
    var arpltn = {};
    arpltn.stationName = stationName?stationName:'';
    arpltn.dataTime = dataTime?dataTime:'';
    arpltn.so2Value = parseFloat(so2Value);
    arpltn.coValue = parseFloat(coValue);
    arpltn.o3Value = parseFloat(o3Value);
    arpltn.no2Value = parseFloat(no2Value);
    arpltn.pm10Value = parseInt(pm10Value);
    arpltn.pm25Value = parseInt(pm25Value);
    arpltn.khaiValue = parseInt(khaiValue);
    arpltn.khaiGrade = parseInt(khaiGrade);
    arpltn.so2Grade = parseInt(so2Grade);
    arpltn.coGrade = parseInt(coGrade);
    arpltn.o3Grade = parseInt(o3Grade);
    arpltn.no2Grade = parseInt(no2Grade);
    arpltn.pm10Grade = parseInt(pm10Grade);
    arpltn.pm25Grade = parseInt(pm25Grade);
    for (var name in arpltn) {
        if (name == 'stationName' || name == 'dataTime') {
            continue;
        }

        if (isNaN(arpltn[name])) {
            log.info('name='+arpltn.stationName+' data time='+arpltn.dataTime+' '+name + ' is NaN');
            arpltn[name] = -1;
        }
    }

    return arpltn;
};

/**
 *
 * @param data
 * @param callback
 */
Keco.prototype.parseCtprvn = function (data, callback) {
    log.debug('parse Ctpvrn');
    var self = this;

    xml2json(data, function (err, result) {
        if (err) {
            return callback(err);
        }

        //check header
        if(parseInt(result.response.header[0].resultCode[0]) !== 0) {
            err = new Error(result.response.header[0].resultMsg[0]);
            log.error(err);
            return callback(err);
        }

        var arpltnList = [];
        var itemList = result.response.body[0].items[0].item;
        log.debug('arpltn list length='+itemList.length);
        itemList.forEach(function(item) {
            log.debug(JSON.stringify(item));
            var arpltn = self.makeArpltn(
                    item.stationName[0], item.dataTime[0], item.so2Value[0], item.coValue[0], item.o3Value[0],
                    item.no2Value[0], item.pm10Value[0], item.pm25Value[0], item.khaiValue[0], item.khaiGrade[0], item.so2Grade[0],
                    item.coGrade[0], item.o3Grade[0], item.no2Grade[0], item.pm10Grade[0], item.pm25Grade[0]);
            //log.info(arpltn);
            arpltnList.push(arpltn);
        });

        callback(null, arpltnList);
    });
};

/**
 *
 * @param arpltnList
 * @param callback
 */
Keco.prototype.saveCtprvn = function (arpltnList, callback) {
    log.debug('save Ctpvrn');

    async.map(arpltnList,
        function(arpltn, callback) {
            Arpltn.update({stationName: arpltn.stationName}, arpltn, {upsert:true}, function (err, raw) {
                if (err) {
                    log.error(err);
                    return callback(err);
                }
                log.silly('The raw response from Mongo was ', JSON.stringify(raw));
                callback(err, raw);
            });
        },
        function (err, results) {
            if (err) {
                return callback(err);
            }
            callback(null, results);
        });
};

/**
 *
 * @param key
 * @param callback
 */
Keco.prototype.getMsrstnList = function(key, callback) {
    var url = DOMAIN_ARPLTN_KECO + '/' + PATH_MSRSTN_INFO_INQIRE_SVC + '/' + MSRSTN_LIST +
        '?ServiceKey='+key +
        '&ver=1.0'+
        '&numOfRows='+999 +
        '&_returnType=json';

    log.debug(url);

    req(url, {json:true}, function(err, response, body) {
        if (err) {
            return callback(err);
        }
        if ( response.statusCode >= 400) {
            return callback(new Error(body));
        }
        return callback(err, body);
    });
};

/**
 *
 * @param MsrStnList
 * @returns {*}
 */
Keco.prototype.parseMsrstnList = function(MsrStnList) {
    var parsedMsrStnList = [];

    if (!Array.isArray(MsrStnList))  {
        var err = new Error("msr stn list is not array");
        log.error(err);
        return parsedMsrStnList;
    }

    MsrStnList.forEach(function (msrStn) {
        var parsedMsrStn = {};
        if (!msrStn.stationName || !msrStn.dmY || !msrStn.dmX) {
            return log.error('stationName or dmY, dmX is invalid msrStn=',JSON.stringify(msrStn));
        }
        parsedMsrStn.stationName = msrStn.stationName;
        parsedMsrStn.geo = [parseFloat(msrStn.dmY), parseFloat(msrStn.dmX)];
        if (typeof msrStn.item === 'string')  {
            parsedMsrStn.item = msrStn.item.split(",");
        }
        else {
            log.warn('item is not string msrStn=',JSON.stringify(msrStn));
        }
        parsedMsrStn.addr = msrStn.addr;
        parsedMsrStn.mangName = msrStn.mangName;
        parsedMsrStn.map = msrStn.map;
        parsedMsrStn.oper = msrStn.oper;
        parsedMsrStn.photo = msrStn.photo;
        parsedMsrStn.year = msrStn.year;
        parsedMsrStnList.push(parsedMsrStn);
    });

    log.info('parsed msr stn list length=', parsedMsrStnList.length);
    return parsedMsrStnList;
};

/**
 *
 * @param msrStnList
 * @param callback
 * @returns {*}
 */
Keco.prototype.saveMsrstnList = function(msrStnList, callback) {
    if (!Array.isArray(msrStnList))  {
        var err = new Error("msr stn list is not array");
        return callback(err);
    }

    log.info('save msr stn list length=', msrStnList.length);

    async.map(msrStnList,
        function(msrStn, cb) {
            log.silly('save msr stn =', JSON.stringify(msrStn));
            MsrStn.update({stationName: msrStn.stationName}, msrStn, {upsert:true}, function (err, raw) {
                if (err) {
                    return cb(err);
                }
                log.silly('The raw response from Mongo was ', JSON.stringify(raw));
                cb(err, raw);
            });
        },
        function (err, results) {
            if (err) {
                return callback(err);
            }
            callback(err, results);
        });

};

Keco.prototype.getGeoInfo = function(address, callback) {
    var convert = require('../utils/convertGeocode');

    log.info(address);
    convert(address,'','', function (err, result) {
        if (err) {
            return callback(err);
        }
        log.info(JSON.stringify(result));
        callback(err, {lat:result.lat, lon:result.lon});
    });
};

Keco.prototype.completeGeoMsrStnInfo = function(list, callback) {
    var self = this;
    async.map(list,
        function (msrStn, cb) {
            if (msrStn.dmY !== '' && msrStn.dmX !== '') {
                return cb(undefined, msrStn);
            }

            self.getGeoInfo(msrStn.addr, function (err, result) {
                if (err) {
                    log.error(err);
                    //when get error just print err message
                }
                else {
                    msrStn.dmY = result.lon;
                    msrStn.dmX = result.lat;
                }
                return cb(err, msrStn);
            });
        },
        function (err, results) {
            if (err) {
                return callback(err);
            }
            return callback(err, results);
        });

    return this;
};

Keco.prototype.getAllMsrStnInfo = function(callback) {
    var self = this;

    async.waterfall([
        function (cb) {
            log.info('get msr stn list');
            self.getMsrstnList(self.getServiceKey(), function (err, body) {
                if (err) {
                    return cb(err);
                }
                if (!body.list || !Array.isArray(body.list)) {
                    return cb(new Error("body of get msr stn list is not array"));
                }

                return cb(err, body.list);
            });
        },
        function (msrStnList, cb) {
            self.completeGeoMsrStnInfo(msrStnList, function (err, list) {
               if (err)  {
                   return cb(err);
               }
                return cb(err, list);
            });
        },
        function (msrStnList, cb) {
            log.info('parse msr stn list');
            var parsedList = self.parseMsrstnList(msrStnList);
            if (parsedList.length === 0) {
                return cb(new Error("Fail to parse msr stn list"));
            }
            return cb(undefined, parsedList);
        },
        function (parsedMsrStnList, cb) {
            //log.info('save msr stn list');
            self.saveMsrstnList(parsedMsrStnList, function (err, results) {
                if (err) {
                   return cb(err) ;
                }

                cb(err, results);
            });
        }
    ], function (err, result) {
        if (err) {
            return callback(err);
        }
        log.info('saved msr stn list length=', result.length);
        callback(err, result);
    });

    return this;
};

/**
 *
 * @param callback
 * @returns {Keco}
 * @private
 */
Keco.prototype._checkDataTime = function (callback) {
    var dataDate;
    var now = kmaTimeLib.toTimeZone(9);

    var dataHours;
    var currentHours = now.getHours();
    if (currentHours < 5) {
        //yesterday 23
        now.setDate(now.getDate()-1);
        dataHours = '23시 발표';
    }
    else if (currentHours < 11) {
        dataHours = '05시 발표';
    }
    else if (currentHours < 17) {
        dataHours = '11시 발표';
    }
    else if (currentHours < 23) {
        dataHours = '17시 발표';
    }
    else {
        dataHours = '23시 발표';
    }

    dataDate = kmaTimeLib.convertDateToYYYY_MM_DD(now);

    log.info('minu dust frcst latest data time = '+dataDate+' '+dataHours);

    Frcst.find({dataTime: dataDate+' '+dataHours}).lean().exec(function (err, frcstList) {
        if (err)  {
            return callback(err);
        }
        if (frcstList.length == 0) {
            return callback(err, {isLatest: false, dataTime:{dataDate: dataDate, dataHours: dataHours}});
        }

        return callback(err, {isLatest: true, dataTime:{dataDate: dataDate, dataHours: dataHours}});
    });

    return this;
};

/**
 * date format is YYYY-MM-DD
 * @param key
 * @param date
 * @param callback
 * @private
 */
Keco.prototype._getFrcst = function(key, date, callback) {
    var url =  DOMAIN_ARPLTN_KECO + '/' + PATH_ARPLTN_INFOR_INQIRE_SVC + '/' + MINU_DUST_FRCST_DSPTH +
        '?ServiceKey='+key +
        '&searchDate=' + date +
        '&ver=1.0'+
        '&pageNo='+ 1 +
        '&numOfRows='+999 +
        '&_returnType=json';

    log.debug(url);

    req(url, {json:true}, function(err, response, body) {
        if (err) {
            return callback(err);
        }
        if ( response.statusCode >= 400) {
            return callback(new Error(body));
        }
        return callback(err, body);
    });

    return this;
};

Keco.prototype._parseFrcst = function (rawData, dataTime) {
    var rawDataList = rawData.list;
    var parsedList = [];

    if (rawDataList == undefined || !Array.isArray(rawDataList)) {
        log.error('keco parseFrcst rawData is not array');
        return;
    }

    //remove old time frcst
    rawDataList = rawDataList.filter(function (rawData) {
        return rawData.dataTime === dataTime;
    });

    rawDataList.forEach(function (rawData) {
        var parsedData = {};
        parsedData.dataTime = rawData.dataTime;
        parsedData.informCode = rawData.informCode;
        parsedData.informData = rawData.informData;
        parsedData.informCause = rawData.informCause;
        parsedData.informOverall = rawData.informOverall;
        parsedData.informGrade = [];
        var gradeList = rawData.informGrade.split(",");
        gradeList.forEach(function (grade) {
            var gradeObjectList = grade.split(" : ") ;
            parsedData.informGrade.push({"region":gradeObjectList[0], "grade":gradeObjectList[1]});
        });
        parsedData.imageUrl = [];
        parsedData.imageUrl.push(rawData.imageUrl1);
        parsedData.imageUrl.push(rawData.imageUrl2);
        parsedData.imageUrl.push(rawData.imageUrl3);
        parsedData.imageUrl.push(rawData.imageUrl4);
        parsedData.imageUrl.push(rawData.imageUrl5);
        parsedData.imageUrl.push(rawData.imageUrl6);

        parsedList.push(parsedData);
    });

    return parsedList;
};

Keco.prototype._saveFrcst = function(frcstList, callback) {
    async.map(frcstList,
        function (objFrcst, cb) {
            Frcst.find({informData:objFrcst.informData, informCode: objFrcst.informCode}).exec(function (err, shFrcstList) {
                if (err) {
                    return cb(err);
                }
                if (shFrcstList.length == 0) {
                    log.verbose('save new minu dust frcst'+ objFrcst.informData + ' '+ objFrcst.informCode);
                    var shFrcst = new Frcst(objFrcst);
                    shFrcst.save(function (err) {
                        cb(err, objFrcst);
                    });
                }
                else {
                    log.verbose('update minu dust frcst '+ objFrcst.informData + ' '+ objFrcst.informCode);
                    if (shFrcstList.length > 1) {
                        log.error("minu dust frcst dspth is duplicated!!");
                    }
                    for (var name in objFrcst) {
                        if (objFrcst.hasOwnProperty(name)) {
                            if (name == "informGrade") {
                                var informGradeArray = objFrcst[name];
                                for (var i=0; i<informGradeArray.length; i++) {
                                    if (informGradeArray[i].grade != "예보없음") {
                                        for (var j=0; j<shFrcstList[0][name].length; j++) {
                                            if (shFrcstList[0][name][j].region == informGradeArray[i].region) {
                                                shFrcstList[0][name][j].grade = informGradeArray[i].grade;
                                                break;
                                            }
                                        }
                                        if (j == shFrcstList[0][name].length) {
                                            log.warn("_saveFrcst : region is new? name="+informGradeArray[i].region);
                                            shFrcstList[0][name].push(informGradeArray[i]);
                                        }
                                    }
                                }
                            }
                            else {
                                shFrcstList[0][name] = objFrcst[name];
                            }
                        }
                    }
                    shFrcstList[0].save(function (err) {
                        cb(err, objFrcst.informData);
                    });
                }
            });
        },
        function (err, results) {
            if (err)  {
                return callback(err);
            }
            callback(err, results);
        });

    return this;
};

Keco.prototype.getMinuDustFrcstDspth = function(callback) {
    var self = this;

    async.waterfall([function (cb) {
        self._checkDataTime(function (err, result) {
            if (err) {
                return cb(err);
            }
            if (result.isLatest) {
                log.info('minu dust forecast is already latest');
                return cb('skip');
            }
            cb(undefined, result.dataTime);
        });
    }, function (dataTime, cb) {
        self._getFrcst(self.getServiceKey(), dataTime.dataDate, function (err, body) {
            if (err) {
                return cb(err);
            }
            return cb(err, body, dataTime);
        });
    }, function (body, dataTime, cb) {
        var parsedList = self._parseFrcst(body, dataTime.dataDate+' '+dataTime.dataHours);
        if (!parsedList) {
            return cb(new Error("Fail to parse minu dust frcst dspth"));
        }
        return cb(undefined, parsedList);
    }, function (parsedFrcstList, cb) {
        self._saveFrcst(parsedFrcstList, function (err, result) {
            if (err) {
                return cb(err);
            }
            cb(err, result);
        });
    }], function (err, result) {
        if (err) {
            return callback(err);
        }
        callback(err, result);
    });

    return this;
};

/**
 *
 * @param list
 * @param index
 * @param callback
 */
Keco.prototype.getAllCtprvn = function(list, index, callback) {
    if (!list) {
        list = this._sidoList;
    }
    if (typeof list === 'function') {
        callback = list;
        list = this._sidoList;
    }

    if (!index) {
        index = this._currentSidoIndex;
    }
    if (typeof index === 'function') {
        callback = index;
        index = this._currentSidoIndex;
    }

    var self = this;
    list = list.slice(index);

    log.info('get all Ctprvn start from '+list[0]);

    async.map(list,
        function(sido, callback) {
            async.waterfall([
                function(cb) {
                    self.getCtprvn(self.getServiceKey(), sido, function (err, body) {
                        if (err) {
                            return cb(err);
                        }
                        cb(err, body);
                    });
                },
                function(rcv, cb) {
                    self.parseCtprvn(rcv, function (err, parsedDataList) {
                        if (err) {
                            return cb(err);
                        }
                        cb(err, parsedDataList);
                    });
                },
                function(parsedDataList, cb) {
                    self.saveCtprvn(parsedDataList, function(err){
                        log.debug(err);
                        return cb(err);
                    });
                }
            ], function(err) {
                callback(err, {sido: sido});
            });
        },
        function(err, results) {
            if(err) {
                log.error(err);
                self._currentSidoIndex = self._sidoList.indexOf(results[results.length-1].sido);
                log.info('next index='+self._currentSidoIndex);
                return callback(err);
            }

            self.updateTimeGetCtprvn();
            self._currentSidoIndex = 0;

            if(callback) {
                callback(err);
            }
        });
};

/**
 * It didn't works well, don't use this
 * @param key
 * @param umdName
 * @param callback
 */
//Keco.prototype.getTMStdrCrdnt = function(key, umdName, callback)  {
//    var url = DOMAIN_ARPLTN_KECO + '/' + PATH_MSRSTN_INFO_INQIRE_SVC + '/getTMStdrCrdnt' +
//        '?ServiceKey='+key +
//        '&umdName='+umdName;
//    log.info(url);
//    req(url, function(err, response, body) {
//        if (err) {
//            return callback(err);
//        }
//        if ( response.statusCode >= 400) {
//            return callback(new Error(body));
//        }
//        return callback(err, body);
//    });
//};

/**
 *
 * @param key
 * @param my
 * @param mx
 * @param callback
 */
Keco.prototype.getNearbyMsrstn = function(key, my, mx, callback)  {
    var url = DOMAIN_ARPLTN_KECO + '/' + PATH_MSRSTN_INFO_INQIRE_SVC + '/' + NEAR_BY_MSRSTN_LIST +
        '?ServiceKey='+key +
        '&tmY='+my +
        '&tmX='+mx +
        '&pageNo='+ 1 +
        '&numOfRows='+999;

    log.debug(url);
    req(url, function(err, response, body) {
        if (err) {
            return callback(err);
        }
        if ( response.statusCode >= 400) {
            return callback(new Error(body));
        }
        return callback(err, body);
    });
};

/**
 *
 * @param data
 * @param callback
 */
Keco.prototype.getStationNameFromMsrstn = function(data, callback) {
    xml2json(data, function (err, result) {
        if (err) {
            return callback(err);
        }

        //check header
        if(parseInt(result.response.header[0].resultCode[0]) !== 0) {
            err = new Error(result.response.header[0].resultMsg[0]);
            log.error(err);
            return callback(err);
        }

        var stnName = result.response.body[0].items[0].item[0].stationName[0];

        log.silly(stnName);

        return callback(null, stnName);
    });
};

/**
 *
 * @param key
 * @param y
 * @param x
 * @param callback
 */
Keco.prototype.getTmPointFromWgs84 = function (key, y, x, callback) {
    var url = 'https://apis.daum.net/local/geo/transcoord';
    url += '?apiKey='+key;
    url += '&fromCoord=WGS84';
    url += '&x='+x;
    url += '&y='+y;
    url += '&toCoord=TM';
    url += '&output=json';

    log.debug(url);

    req(url, {json:true}, function(err, response, body) {
        if (err) {
            return callback(err);
        }
        if ( response.statusCode >= 400) {
            err = new Error("response.statusCode="+response.statusCode);
            return callback(err);
        }
        return callback(err, body);
    });
};

/**
 * 20분에도 데이터가 갱신되지 않은 경우가 있어서, 2분 가장 마지막, 35분 초기에도 시도함.
 * @param self
 * @param callback
 * @returns {Keco}
 */
Keco.prototype.cbKecoProcess = function (self, callback) {

    callback = callback || function(){};

    self.getAllCtprvn(function (err) {
        if (err) {
            log.warn('Stopped index='+self._currentSidoIndex);
            return callback(err);
        }
        callback(err);
    });

    return this;
};

/**
 * start to get data from Keco
 */
Keco.prototype.start = function () {
    log.info('start KECO SERVICE');

    this.getAllMsrStnInfo(function (err) {
        if (err) {
            log.error(err);
        }
        else {
            log.info('keco get all msr stn info list');
        }
    });

    this.getCtprvnSidoList();

    setInterval(this.cbKecoProcess, 60*1000*10, this); //10min
};

module.exports = Keco;