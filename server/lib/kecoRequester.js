/**
 * 대기오염정보 조회 서비스 http://openapi.airkorea.or.kr/
 * provider에서 미세먼지 가지고와서 DB에 저장하기. #225
 * Created by aleckim on 2015. 10. 24..
 */

'use strict';

var async = require('async');
var req = require('request');

var Arpltn = require('../models/arpltnKeco.js');
var MsrStn = require('../models/modelMsrStnInfo.js');
var Frcst = require('../models/modelMinuDustFrcst');
var SidoArpltn = require('../models/sido.arpltn.keco.model');
var AirkoreaHourlyForecastCtrl = require('../controllers/airkorea.hourly.forecast.controller');

var kmaTimeLib = require('../lib/kmaTimeLib');

var config = require('../config/config');
var CtrlS3 = require('../s3/controller.s3');

var AIRKOREA_DOMAIN = 'openapi.airkorea.or.kr';
var DOMAIN_ARPLTN_KECO = 'http://'+AIRKOREA_DOMAIN+'/openapi/services/rest';

var PATH_MSRSTN_INFO_INQIRE_SVC = 'MsrstnInfoInqireSvc';
var NEAR_BY_MSRSTN_LIST = 'getNearbyMsrstnList';            //근접측정소 목록 조회
var MSRSTN_LIST = 'getMsrstnList';
var MINU_DUST_FRCST_DSPTH = 'getMinuDustFrcstDspth';        //미세먼지/오존 예보통보 조회

var PATH_ARPLTN_INFOR_INQIRE_SVC = 'ArpltnInforInqireSvc';
var CTPRVN_RLTM_MESURE_DNSTY = 'getCtprvnRltmMesureDnsty';  //시도별 실시간 측정정보 조회
var CTPRVN_MESURE_SIDO_LIST = 'getCtprvnMesureSidoLIst'; //시도별 실시간 평균정보 조회

var dnscache = require('dnscache')({
    "enable" : true,
    "ttl" : 300,
    "cachesize" : 1000
});

/**
 *
 * @constructor
 */
function Keco() {
    this._svcKeys ='';
    this._sidoList = [];
    this._currentRltmIndex = 0;
    this._currentSidoIndex = 0;
    this._daumApiKeys = '';  //for convert x,y
}

/**
 *
 * @param key
 * @returns {Keco}
 */
Keco.prototype.setDaumApiKeys = function (keys) {
    this._daumApiKeys = keys;
    return this;
};

/**
 *
 * @returns {string|*}
 */
Keco.prototype.getDaumApiKey = function () {
    return this._daumApiKeys[Math.floor(Math.random() * this._daumApiKeys.length)];
};

/**
 *
 * @param key
 * @returns {Keco}
 */
Keco.prototype.setServiceKeys = function(keys) {
    this._svcKeys = keys;
    log.info({svcKeys: this._svcKeys});
    return this;
};

/**
 *
 * @returns {Array}
 */
Keco.prototype.getCtprvnSidoList = function() {

    //get from town.js
    this._sidoList = Arpltn.getCtprvnSidoList();

    return this._sidoList;
};

/**
 *
 * @param regionName
 * @returns {string}
 */
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
 * @param apiPoint CTPRVN_RLTM_MESURE_DNSTY, CTPRVN_MESURE_SIDO_LIST
 * @returns {string}
 */
Keco.prototype.getUrlCtprvn = function(sido, key, apiPoint) {
    if (!key)  {
        key = this._svcKeys[0];
    }

    if (!key) {
        log.error("You have to set key");
        return;
    }
    sido = encodeURIComponent(sido);
    var url = DOMAIN_ARPLTN_KECO + '/' + PATH_ARPLTN_INFOR_INQIRE_SVC + '/' + apiPoint +
        '?ServiceKey='+key +
        '&sidoName='+sido +
        '&pageNo='+ 1 +
        '&numOfRows='+999+
        '&_returnType=json';
    if(apiPoint === CTPRVN_RLTM_MESURE_DNSTY) {
        url += '&ver=1.3';
    }
    else if (apiPoint === CTPRVN_MESURE_SIDO_LIST) {
        url += '&searchCondition=HOUR';
    }
    else {
        log.error('get url ctprn unknown apiPoint='+apiPoint);
    }
    return url;
};

/**
 *
 * @param url
 * @param callback
 * @returns {Keco}
 * @private
 */
Keco.prototype._jsonRequest = function (url, callback) {
    log.debug({kecoJsonRequestUrl:url});
    req(url, {json:true}, function(err, response, body) {
        if (err) {
            return callback(err);
        }
        if ( response.statusCode >= 400) {
            err = new Error(response.statusMessage);
            err.statusCode = response.statusCode;
            return callback(err);
        }
        return callback(err, body);
    });

    return this;
};

/**
 *
 * @param index
 * @param sidoName
 * @param apiPoint CTPRVN_RLTM_MESURE_DNSTY, CTPRVN_MESURE_SIDO_LIST
 * @param callback
 * @returns {*}
 * @private
 */
Keco.prototype._retryGetCtprvn = function (index, sidoName, apiPoint, callback) {
    var self = this;
    if (index < 0) {
        return callback(new Error("EXCEEDS_LIMIT"));
    }
    var url = this.getUrlCtprvn(sidoName, self._svcKeys[index], apiPoint);
    self._jsonRequest(url, function (err, result) {
        if (self._checkLimit(result)) {
            return self._retryGetCtprvn(--index, sidoName, apiPoint, callback);
        }
        callback(err, result);
    });

    return this;
};

Keco.prototype.getRLTMCtprvn = function(sidoName, callback)  {
    this.getCtprvn(sidoName, CTPRVN_RLTM_MESURE_DNSTY, function (err, result) {
        callback(err, result);
    });
    return this;
};

/**
 * @param sidoName
 * @param apiPoint CTPRVN_RLTM_MESURE_DNSTY, CTPRVN_MESURE_SIDO_LIST
 * @param callback
 */
Keco.prototype.getCtprvn = function(sidoName, apiPoint, callback)  {
    this._retryGetCtprvn(this._svcKeys.length-1, sidoName, apiPoint, function (err, result) {
        callback(err, result);
    });
    return this;
};

/**
 *
 * @param data
 * @param callback
 */
Keco.prototype.parseRLTMCtprvn = function (data, callback) {
    log.debug('parse real time Ctpvrn');
    var self = this;

    if (typeof data === 'string') {
        if (data.indexOf('xml') !== -1) {
            callback(new Error(data));
            return;
        }
    }
    var arpltnList = [];
    try {
        var list = data.list;
        list.forEach(function (item) {
            log.debug(JSON.stringify(item));
            var arpltn = {};
            Arpltn.getKeyList().forEach(function (name) {
                if(item.hasOwnProperty(name))   {
                    if (name === 'stationName' || name === 'mangName' || name === 'dataTime') {
                       arpltn[name]  = item[name];
                       if (name === 'dataTime') {
                           arpltn.date = new Date(item[name]);
                       }
                    }
                    else {
                        if (name.indexOf('Value') !== -1){
                            arpltn[name] = parseFloat(item[name]);
                        }
                        else if (name.indexOf('Grade') !== -1){
                            arpltn[name] = parseInt(item[name]);
                        }
                        else {
                           log.error("Unknown name ="+name);
                        }
                        if (isNaN(arpltn[name])) {
                            log.verbose('name='+item.stationName+' data time='+item.dataTime+' '+name + ' is NaN');
                            delete arpltn[name];
                        }
                    }
                }
            });

            //pm10Grade -> pm10Grade24, pm10Grade1h -> pm10Grade,
            //pm25Grade -> pm25Grade24, pm25Grade1h -> pm25Grade,
            if (arpltn.hasOwnProperty('pm10Grade')) {
                arpltn.pm10Grade24 = arpltn.pm10Grade;
                delete arpltn.pm10Grade;
            }
            if(arpltn.hasOwnProperty('pm10Grade1h')) {
                arpltn.pm10Grade = arpltn.pm10Grade1h;
                delete arpltn.pm10Grade1h;
            }
            if (arpltn.hasOwnProperty('pm25Grade')) {
                arpltn.pm25Grade24 = arpltn.pm25Grade;
                delete arpltn.pm25Grade;
            }
            if(arpltn.hasOwnProperty('pm25Grade1h')) {
                arpltn.pm25Grade = arpltn.pm25Grade1h;
                delete arpltn.pm25Grade1h;
            }
            arpltnList.push(arpltn);
        });
    }
    catch (err) {
        return callback(err);
    }

    var prefix;
    try {
        prefix = 'airkorea/ctprvn/'+data.list[0].dataTime+'-'+data.parm.sidoName+'-rltmCtprvn.json';
    }
    catch(err) {
        log.error(err);
    }

    if (prefix) {
        this._uploadS3({prefix:prefix, data:data.list}, function (err, result) {
            if (err) {
                log.error(err);
            }
            else {
                log.debug(result);
            }
        });
    }

    callback(undefined, arpltnList);
};

/**
 *
 * @param arpltnList
 * @param callback
 */
Keco.prototype.saveRLTMCtprvn = function (arpltnList, callback) {
    log.debug('save Ctpvrn');

    async.map(arpltnList,
        function(arpltn, callback) {
            Arpltn.update({stationName: arpltn.stationName, date: arpltn.date}, arpltn, {upsert:true}, function (err, raw) {
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

Keco.prototype._retryGetMsrstnList = function (index, callback) {
    var self = this;
    var url = DOMAIN_ARPLTN_KECO + '/' + PATH_MSRSTN_INFO_INQIRE_SVC + '/' + MSRSTN_LIST +
        '?ServiceKey='+self._svcKeys[index] +
        '&ver=1.0'+
        '&numOfRows='+999 +
        '&_returnType=json';

    self._jsonRequest(url, function (err, result) {
        if (self._checkLimit(result)) {
            return self._retryGetMsrstnList(--index, callback);
        }
        callback(err, result);
    });

    return this;
};

/**
 *
 * @param callback
 */
Keco.prototype.getMsrstnList = function(callback) {
    this._retryGetMsrstnList(this._svcKeys.length-1, function (err, result) {
        callback(err, result);
    });

    return this;
};

Keco.prototype._uploadS3 = function(obj, callback) {
    if (config.s3 == undefined || config.s3.bucketName == undefined || config.s3.bucketName.length === 0) {
        return callback(new Error('undefined s3 information'));
    }

    var ctrlS3 = new CtrlS3(config.s3.region, config.s3.bucketName);
    var s3Path = obj.prefix;
    var dataString = JSON.stringify(obj.data, null, 2);
    ctrlS3.uploadData(dataString, s3Path)
        .then(function (result) {
           callback(null, result);
        })
        .catch(function (err) {
            callback(err);
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

    var prefix = 'airkorea/msrstn/'+new Date().toISOString() +'-msrStn.json';
    this._uploadS3({prefix:prefix, data: MsrStnList}, function (err, result) {
        if (err) {
            log.error(err);
        }
        else {
            log.debug(result);
        }
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
                if (msrStn.dmX > 100) {
                    //18-1-25 6개 정보의 측정소 위치 정보가 잘 못 전달되고 있음.
                    log.warn("invalid geoinfo from airkorea", msrStn.stationName, 'dmX=', msrStn.dmX, 'dmY=', msrStn.dmY);
                    var tmpX = msrStn.dmX;
                    msrStn.dmX = msrStn.dmY;
                    msrStn.dmY = tmpX;
                }
                return cb(undefined, msrStn);
            }

            if (msrStn.addr == null || msrStn.addr.length == 0) {
                log.warn('There is not addr msrStn:'+JSON.stringify(msrStn));
                return cb(undefined, msrStn);
            }
            else if (msrStn.addr.indexOf('이동차량') >= 0) {
                //강원 평창군 대관령면 솔봉로 325이동차량
                log.warn('stn location is not fixed msrStn:'+JSON.stringify(msrStn));
                msrStn.addr = msrStn.addr.replace('이동차량', '');
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
                return cb(null, msrStn);
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
            self.getMsrstnList(function (err, body) {
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

Keco.prototype._makeFrcstUrl = function (key, date) {
    return DOMAIN_ARPLTN_KECO + '/' + PATH_ARPLTN_INFOR_INQIRE_SVC + '/' + MINU_DUST_FRCST_DSPTH +
        '?ServiceKey='+key +
        '&searchDate=' + date +
        '&ver=1.3'+
        '&pageNo='+ 1 +
        '&numOfRows='+999 +
        '&_returnType=json';
};

Keco.prototype._checkLimit = function (result) {
    if (typeof result === 'string') {
       if (result.indexOf('LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR') !== -1) {
           return true;
       }
       else if (result.indexOf('DEADLINE HAS EXPIRED ERROR') !== -1) {
           log.error('DEADLINE HAS EXPIRED ERROR');
           return true;
       }
    }
    return false;
};

Keco.prototype._retryGetFrcst = function (index, date, callback) {
    var self = this;

    if (index < 0) {
        return callback(new Error("EXCEEDS_LIMIT"));
    }

    log.info({getFrcstIndex:index});
    var url = self._makeFrcstUrl(self._svcKeys[index], date);
    self._jsonRequest(url, function (err, result) {
        if (self._checkLimit(result)) {
            return self._retryGetFrcst(--index, date, callback);
        }
        callback(err, result);
    });

    return this;
};

/**
 * date format is YYYY-MM-DD
 * @param date
 * @param callback
 * @private
 */
Keco.prototype._getFrcst = function(date, callback) {
    var self = this;

    self._retryGetFrcst(self._svcKeys.length-1, date, function (err, result) {
        return callback(err, result);
    });

    return this;
};

Keco.prototype._parseFrcst = function (rawData, dataTime) {
    var rawDataList = rawData.list;
    var parsedList = [];

    if (rawDataList == undefined || !Array.isArray(rawDataList)) {
        log.error({rawData:rawData});
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
        parsedData.actionKnack = rawData.actionKnack;
        parsedData.imageUrl = [];
        parsedData.imageUrl.push(rawData.imageUrl1);
        parsedData.imageUrl.push(rawData.imageUrl2);
        parsedData.imageUrl.push(rawData.imageUrl3);
        parsedData.imageUrl.push(rawData.imageUrl4);
        parsedData.imageUrl.push(rawData.imageUrl5);
        parsedData.imageUrl.push(rawData.imageUrl6);
        parsedData.imageUrl.push(rawData.imageUrl7);
        parsedData.imageUrl.push(rawData.imageUrl8);
        parsedData.imageUrl.push(rawData.imageUrl9);

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
                                            log.warn("save Frcst : region is new? name="+informGradeArray[i].region);
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

Keco.prototype.removeMinuDustFrcst = function (callback) {
    var removeDate = new Date();
    removeDate.setDate(removeDate.getDate()-10);
    var strRemoveDataTime = kmaTimeLib.convertDateToYYYY_MM_DD(removeDate);

    Frcst.remove({"informData": {$lt:strRemoveDataTime} }, function (err) {
        log.info('removed keco frcst from date : ' + strRemoveDataTime);
        if (callback)callback(err);
    });
};

Keco.prototype.getMinuDustFrcstDspth = function(callback) {
    var self = this;

    var dataTime;

    async.waterfall([
            function (cb) {
                self._checkDataTime(function (err, result) {
                    if (err) {
                        return cb(err);
                    }
                    dataTime = result.dataTime;

                    if (result.isLatest) {
                        log.info('minu dust forecast is already latest');
                        return cb('skip');
                    }
                    cb(undefined, result.dataTime);
                });
            },
            function (dataTime, cb) {
                self._getFrcst(dataTime.dataDate, function (err, body) {
                    if (err) {
                        return cb(err);
                    }
                    return cb(err, body, dataTime);
                });
            },
            function (body, dataTime, cb) {
                var parsedList = self._parseFrcst(body, dataTime.dataDate+' '+dataTime.dataHours);
                if (!parsedList) {
                    return cb(new Error("Fail to parse minu dust frcst dspth"));
                }
                return cb(undefined, parsedList);
            },
            function (parsedFrcstList, cb) {
                self._saveFrcst(parsedFrcstList, function (err, result) {
                    if (err) {
                        return cb(err);
                    }
                    cb(err, result);
                });
            }
        ],
        function (err, result) {
            (new AirkoreaHourlyForecastCtrl()).do(dataTime.dataDate+' '+dataTime.dataHours);
            if (err) {
                return callback(err);
            }
            callback(err, result);
        });

    self.removeMinuDustFrcst();
    return this;
};

Keco.prototype.saveAvgSidoArpltn = function (sido, rltmArpltnList) {

    if (rltmArpltnList.length === 0) {
        log.error('rltm arpltn length is zero');
    }
    else {
        var latestDataTime = "";
        //부산의 경우 6:56분에 7시 데이터 "도로변대기"가 올라온적이 있음
        rltmArpltnList.forEach(function (item) {
            if (item.dataTime > latestDataTime && item.mangName === '도시대기') {
                latestDataTime = item.dataTime;
            }
        });

        var sidoArpltnList = rltmArpltnList.filter(function (item) {
            return item.dataTime === latestDataTime && item.mangName === '도시대기';
        });

        if (sidoArpltnList.length === 0) {
            log.info('sido arpltn list length is 0 so stop save avg sigo arpltn');
            return;
        }
        var avgSidoArpltn = {};
        var avgSidoArpltnCount={};

        avgSidoArpltn.sidocityName = sido;
        avgSidoArpltn.sidoName = sido;
        avgSidoArpltn.date = sidoArpltnList[0].date;
        avgSidoArpltn.dataTime = sidoArpltnList[0].dataTime;
        avgSidoArpltn.cityName = "";
        avgSidoArpltn.cityNameEng = "";

        sidoArpltnList.forEach(function (item) {
            for (var key in item) {
                if (key.indexOf("Value") >= 0) {
                    if (avgSidoArpltn[key] === undefined) {
                        avgSidoArpltn[key] = 0;
                        avgSidoArpltnCount[key]  = 0;
                    }
                    avgSidoArpltn[key] += item[key];
                    avgSidoArpltnCount[key]++;
                }
            }
        });

        for (var key in avgSidoArpltn) {
            if (key.indexOf("Value") >= 0) {
                avgSidoArpltn[key] = avgSidoArpltn[key]/avgSidoArpltnCount[key];
            }
        }
        ['pm10Value', 'pm25Value', 'khaiValue', 'pm10Value24', 'pm25Value24'].forEach(function (key) {
            if (avgSidoArpltn.hasOwnProperty(key)) {
                avgSidoArpltn[key] = Math.round(avgSidoArpltn[key]);
            }
        });
        ['no2Value', 'o3Value', 'coValue', 'so2Value'].forEach(function (key) {
            if (avgSidoArpltn.hasOwnProperty(key)) {
                avgSidoArpltn[key] = Math.round(avgSidoArpltn[key]*1000)/1000;
            }
        });

        SidoArpltn.update(
            {
                sidocityName: avgSidoArpltn.sidocityName,
                date: avgSidoArpltn.date},
            avgSidoArpltn,
            {upsert:true},
            function (err, raw) {
                if (err) {
                    log.error(err);
                }
                log.silly('The raw response from Mongo was ', JSON.stringify(raw));
            });
    }
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
        index = this._currentRltmIndex;
    }
    if (typeof index === 'function') {
        callback = index;
        index = this._currentRltmIndex;
    }

    var self = this;
    list = list.slice(index);

    log.info('get all Ctprvn start from '+list[0]);

    async.mapSeries(list,
        function(sido, callback) {
            async.waterfall([
                function(cb) {
                    self.getCtprvn(sido, CTPRVN_RLTM_MESURE_DNSTY, function (err, body) {
                        if (err) {
                            return cb(err);
                        }
                        cb(err, body);
                    });
                },
                function(rcv, cb) {
                    self.parseRLTMCtprvn(rcv, function (err, parsedDataList) {
                        if (err) {
                            return cb(err);
                        }
                        cb(err, parsedDataList);
                    });
                },
                function(parsedDataList, cb) {
                    self.saveRLTMCtprvn(parsedDataList, function(err){
                        log.debug(err);
                        return cb(err);
                    });
                    //save avgSido
                    self.saveAvgSidoArpltn(sido, parsedDataList);
                }
            ], function(err) {
                callback(err, {sido: sido});
            });
        },
        function(err, results) {
            if(err) {
                if (err.statusCode == 503 || err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') {
                    log.warn(err);
                }
                else {
                    log.error(err);
                }
                self._currentRltmIndex = self._sidoList.indexOf(results[results.length-1].sido);
                log.info('KECO: next index='+self._currentRltmIndex);
                return callback(err);
            }

            self._currentRltmIndex = 0;

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


Keco.prototype._retryGetNearbyMsrStn = function (index, my, mx, callback) {
    var self = this;
    if (index < 0) {
        return callback(new Error("EXCEEDS_LIMIT"));
    }

    var url = DOMAIN_ARPLTN_KECO + '/' + PATH_MSRSTN_INFO_INQIRE_SVC + '/' + NEAR_BY_MSRSTN_LIST +
        '?ServiceKey='+self._svcKeys[index] +
        '&tmY='+my +
        '&tmX='+mx +
        '&pageNo='+ 1 +
        '&numOfRows='+999 +
        '&_returnType=json';

    self._jsonRequest(url, function (err, result) {
        if (self._checkLimit(result)) {
            return self._retryGetNearbyMsrStn(--index, my, mx, callback);
        }
        callback(err, result);
    });

    return this;
};

/**
 *
 * @param my
 * @param mx
 * @param callback
 */
Keco.prototype.getNearbyMsrstn = function(my, mx, callback)  {
    this._retryGetNearbyMsrStn(this._svcKeys.length-1, my, mx, function (err, result) {
        callback(err, result);
    });
};

/**
 *
 * @param data
 * @param callback
 */
Keco.prototype.getStationNameFromMsrstn = function(data, callback) {
     if (typeof data === 'string') {
        if (data.indexOf('xml') !== -1) {
            callback(new Error(data));
            return;
        }
    }
    var stnName;
    try {
        stnName = data.list[0].stationName;
    }
    catch (err) {
        return callback(err);
    }
    return callback(null, stnName);
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

    this._jsonRequest(url, function (err, result) {
        callback(err, result);
    });
};

Keco.prototype.retryGetAllCtprvn = function (self, count, callback) {
    if (count <= 0)  {
        return callback(new Error("KECO: Fail to get all ctpvrn it's stoped index="+self._currentRltmIndex));
    }
    count--;

    self.getAllCtprvn(function (err) {
        if (err) {
            log.warn('KECO: Stopped index='+self._currentRltmIndex);
            return self.retryGetAllCtprvn(self, count, callback);
        }
        callback(err);
    });

    return this;
};

Keco.prototype.removeOldAllCtprvn = function (callback) {
    var removeDate = new Date();
    removeDate.setDate(removeDate.getDate()-10);
    var strRemoveDataTime = kmaTimeLib.convertDateToYYYY_MM_DD_HHoMM(removeDate);

    Arpltn.remove({"dataTime": {$lt:strRemoveDataTime} }, function (err) {
        log.info('removed keco all data from date : ' + strRemoveDataTime);
        if (callback)callback(err);
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

    self.retryGetAllCtprvn(self, 10, function (err) {
        if (err) {
            log.warn('KECO: Stopped all index='+self._currentRltmIndex);
            return callback(err);
        }
        callback(err);
    });

    self.removeOldAllCtprvn();
    return this;
};

/**
 *
 * @param data
 * @param callback
 */
Keco.prototype.parseSidoCtprvn = function (data, callback) {
    log.debug('parse Sido Ctpvrn');

    if (typeof data === 'string') {
        if (data.indexOf('xml') !== -1) {
            callback(new Error(data));
            return;
        }
    }

    var sidoArpltnList = [];
    try {
        var list = data.list;
        list.forEach(function (item) {
            log.debug(JSON.stringify(item));
            var sidoArpltn = {};
            SidoArpltn.getKeyList().forEach(function (name) {
                if(item.hasOwnProperty(name))   {
                    if (name === 'sidoName' || name === 'cityName' || name === 'cityNameEng' || name === 'dataTime') {
                       sidoArpltn[name]  = item[name];
                       if (name === 'dataTime') {
                           sidoArpltn.date = new Date(item[name]);
                       }
                       if (name === 'cityName') {
                           sidoArpltn.sidocityName = item.sidoName+'/'+item.cityName;
                       }
                    }
                    else {
                        if (name.indexOf('Value') !== -1){
                            sidoArpltn[name] = parseFloat(item[name]);
                        }
                        else {
                           log.error("Unknown name ="+name);
                        }
                        if (isNaN(sidoArpltn[name])) {
                            log.debug('name='+item.sidoName+'/'+item.cityName+' data time='+item.dataTime+' '+name + ' is NaN');
                            delete sidoArpltn[name];
                        }
                    }
                }
            });
            sidoArpltnList.push(sidoArpltn);
        });
    }
    catch (err) {
        return callback(err);
    }

    callback(undefined, sidoArpltnList);
};

/**
 *
 * @param arpltnList
 * @param callback
 */
Keco.prototype.saveSidoCtprvn = function (arpltnList, callback) {
    log.debug('save Sido Ctpvrn');

    async.map(arpltnList,
        function(sidoArpltn, callback) {
            SidoArpltn.update({sidocityName: sidoArpltn.sidocityName, date: sidoArpltn.date}, sidoArpltn, {upsert:true}, function (err, raw) {
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
 * @param list
 * @param index
 * @param callback
 */
Keco.prototype.getSidoCtprvn = function(list, index, callback) {
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

    log.info('get Sido Ctprvn start from '+list[0]);

    async.mapSeries(list,
        function(sido, callback) {
            async.waterfall([
                function(cb) {
                    self.getCtprvn(sido, CTPRVN_MESURE_SIDO_LIST, function (err, body) {
                        if (err) {
                            return cb(err);
                        }
                        cb(err, body);
                    });
                },
                function(rcv, cb) {
                    self.parseSidoCtprvn(rcv, function (err, parsedDataList) {
                        if (err) {
                            return cb(err);
                        }
                        cb(err, parsedDataList);
                    });
                },
                function(parsedDataList, cb) {
                    self.saveSidoCtprvn(parsedDataList, function(err){
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
                if (err.statusCode == 503) {
                    log.warn(err);
                }
                else {
                    log.error(err);
                }
                self._currentSidoIndex = self._sidoList.indexOf(results[results.length-1].sido);
                log.info('KECO: next index='+self._currentSidoIndex);
                return callback(err);
            }

            self._currentSidoIndex = 0;

            if(callback) {
                callback(err);
            }
        });
};

Keco.prototype.retryGetSidoCtprvn = function (self, count, callback) {
    if (count <= 0)  {
        return callback(new Error("KECO: Fail to get Sido ctpvrn it's stoped index="+self._currentSidoIndex));
    }
    count--;

    self.getSidoCtprvn(function (err) {
        if (err) {
            log.warn('KECO: Stopped sido index='+self._currentSidoIndex);
            return self.retryGetSidoCtprvn(self, count, callback);
        }
        callback(err);
    });

    return this;
};

Keco.prototype.removeOldSidoCtprvn = function (callback) {
    var removeDate = new Date();
    removeDate.setDate(removeDate.getDate()-10);

    SidoArpltn.remove({"date": {$lt:removeDate} }, function (err) {
        log.info('removed keco sido data from date : ' + removeDate);
        if (callback)callback(err);
    });
};

Keco.prototype.cbKecoSidoProcess = function (self, callback) {

    callback = callback || function(){};

    self.retryGetSidoCtprvn(self, 10, function (err) {
        if (err) {
            log.warn('KECO: Stopped sido index='+self._currentSidoIndex);
            return callback(err);
        }
        callback(err);
    });

    self.removeOldSidoCtprvn();
    return this;
};

/**
 * start to get data from Keco
 */
// Keco.prototype.start = function () {
//     log.info('start KECO SERVICE');
//
//     this.getAllMsrStnInfo(function (err) {
//         if (err) {
//             if (err.statusCode == 503) {
//                 log.warn(err);
//             }
//             else {
//                 log.error(err);
//             }
//         }
//         else {
//             log.info('keco get all msr stn info list');
//         }
//     });
//
//     this.getCtprvnSidoList();
//
//     setInterval(this.cbKecoProcess, 60*1000*10, this); //10min
// };

module.exports = Keco;