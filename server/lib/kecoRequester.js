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

var DOMAIN_ARPLTN_KECO = 'http://openapi.airkorea.or.kr/openapi/services/rest';

var PATH_MSRSTN_INFO_INQIRE_SVC = 'MsrstnInfoInqireSvc';
var NEAR_BY_MSRSTN_LIST = 'getNearbyMsrstnList';

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
        '경남', '제주'
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
        case '세종특별자치시':case '세종시':case '세종':case '충청남도':case '충남':
            return '충남';
        case '인천광역시': case '인천시': case '인천':
            return '인천';
        case '전라남도':case '전남':
            return '전남';
        case '전라북도':case '전북':
            return '전북';
        case '제주특별자치도':case '제주도':case '제주':
            return '제주';
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
    return time >= this._nextGetCtprvnTime;
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

    log.info(url);

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
 * @param khaiValue
 * @param khaiGrade
 * @param so2Grade
 * @param coGrade
 * @param o3Grade
 * @param no2Grade
 * @param pm10Grade
 * @returns {{}}
 */
Keco.prototype.makeArpltn = function (stationName, dataTime, so2Value, coValue,
                                      o3Value, no2Value, pm10Value, pm25Value, khaiValue,
                                      khaiGrade, so2Grade, coGrade, o3Grade,
                                      no2Grade, pm10Grade, pm25Grade) {
    var arpltn = {};
    arpltn.stationName = stationName?stationName:'';
    arpltn.dataTime = dataTime?dataTime:'';
    arpltn.so2Value = so2Value?so2Value==='-'?-1:so2Value:-1;
    arpltn.coValue = coValue?coValue==='-'?-1:coValue:-1;
    arpltn.o3Value = o3Value?o3Value==='-'?-1:o3Value:-1;
    arpltn.no2Value = no2Value?no2Value==='-'?-1:no2Value:-1;
    arpltn.pm10Value = pm10Value?pm10Value==='-'?-1:pm10Value:-1;
    arpltn.pm25Value = pm25Value?pm25Value==='-'?-1:pm25Value:-1;
    arpltn.khaiValue = khaiValue?khaiValue==='-'?-1:khaiValue:-1;
    arpltn.khaiGrade = khaiGrade?khaiGrade:-1;
    arpltn.so2Grade = so2Grade?so2Grade:-1;
    arpltn.coGrade = coGrade?coGrade:-1;
    arpltn.o3Grade = o3Grade?o3Grade:-1;
    arpltn.no2Grade = no2Grade?no2Grade:-1;
    arpltn.pm10Grade = pm10Grade?pm10Grade:-1;
    arpltn.pm25Grade = pm25Grade?pm25Grade:-1;
    return arpltn;
};

/**
 *
 * @param data
 * @param callback
 */
Keco.prototype.parseCtprvn = function (data, callback) {
    log.info('parse Ctpvrn');
    var self = this;

    xml2json(data, function (err, result) {
        if (err) {
            callback(err);
            return;
        }

        //check header
        if(parseInt(result.response.header[0].resultCode[0]) !== 0) {
            err = new Error(result.response.header[0].resultMsg[0]);
            log.error(err);
            callback(err);
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
    log.info('save Ctpvrn');

    async.mapSeries(arpltnList,
        function(arpltn, callback) {
            Arpltn.update({stationName: arpltn.stationName}, arpltn, {upsert:true}, function (err, raw) {
                if (err) {
                    log.error(err);
                    callback(err);
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

    async.mapSeries(list,
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
Keco.prototype.parseMsrstn = function(data, callback) {
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
 * @param callback
 */
Keco.prototype.loadTownList = function(lean, callback) {
    var Town = require('../models/town');
    var q;
    if (typeof lean === 'function') {
        callback = lean;
        lean = undefined;
    }
    if (lean) {
        q = Town.find({}, {_id:0}).lean();
    }
    else {
        q = Town.find({});
    }
    q.exec(function(err, townList) {
        if (err)  {
            log.error("Fail to load townlist");
            return callback(err);
        }
        log.info("areaList="+townList.length);
        return callback(err, townList);
    });
};

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
            console.log(body);
            return callback(new Error(body.message));
        }
        return callback(err, body);
    });
};

Keco.prototype.addMsrstnInfoToTown = function(callback) {
    var self = this;

    this.loadTownList(function (err, townList) {
        if (err) {
            return callback(err);
        }

        log.info('loaded town list');

        async.mapSeries(townList,
            function(town, mapCallback) {

                //서버 시작할때매다, 갱신함.
                //if (town.kecoStationName) {
                //    log.verbose('skip this town='+town.town);
                //    return mapCallback(undefined, {town: town});
                //}

                async.waterfall([
                    function(cb) {
                       self.getTmPointFromWgs84(self.getDaumApiKey(), town.gCoord.lat, town.gCoord.lon,
                                function (err, body) {
                           if (err) {
                               return cb(err);}

                           //body = {x: Number, y:Number}
                           log.silly(body);
                           town.tmCoord = {x:body.x, y:body.y};
                           cb(err, town.tmCoord);
                       });
                    },
                    function(tmCoord, cb) {
                        self.getNearbyMsrstn(self.getServiceKey(), tmCoord.y, tmCoord.x, function(err, result) {
                            if (err) {
                                return cb(err);}

                            log.silly(result);
                            cb(err, result);
                        });
                    },
                    function(xmlStationInfoList, cb) {
                        self.parseMsrstn(xmlStationInfoList, function (err, stationName) {
                            if (err) {
                                return cb(err);}
                            town.kecoStationName = stationName;
                            cb(err);
                        });
                    },
                    function (cb) {
                        log.debug(town.toString());
                        town.save(function (err) {
                            cb(err);
                        });
                    }
                ], function(err) {
                    return mapCallback(err, {town: town.toJSON()});
                });
            },
            function (err, results) {
                if(err) {
                    log.error(err);
                    return callback(err);
                }
                log.debug(JSON.stringify(results));
                log.info('Finished add Msrstn info to town');
                return callback(err, results);
            });
    });
};

Keco.prototype.saveArpltnTown = function(town, arpltn, callback)  {
    var ArpltnTown = require('../models/arpltnTownKeco.js');

    var arpltnTown = {town: town.town, mCoord: town.mCoord, arpltn: arpltn};

    log.verbose(arpltnTown.town);
    log.verbose(arpltnTown.mCoord);
    log.verbose(arpltnTown.arpltn.stationName);

    ArpltnTown.update({town: town.town}, arpltnTown, {upsert:true}, function (err, raw) {
        if (err) {
            log.error(err);
            return callback(err);
        }
        log.debug('The raw response from Mongo was ', raw);
        return callback(err, raw);
    });
};

Keco.prototype.updateTownArpltnInfo = function (callback) {
    //loadTown
    var self = this;

    this.loadTownList(true, function (err, townList) {
        if (err) {
            return callback(err);
        }

        //townList = townList.slice(0,1);
        async.mapSeries(townList,
            function(town, callback1) {
                if (!town.kecoStationName) {
                    log.warn('Fail to get stationName town='+town.town.toString());
                    return callback1(undefined, town);
                }
                //log.debug(town.toString());
                log.debug(town.kecoStationName);
                Arpltn.findOne({stationName: town.kecoStationName}).lean().exec(function (err, arpltn) {
                    if (err) {
                        return callback1(err);
                    }
                    if(!arpltn) {
                        log.warn("Fail to find arpltn stationName="+town.kecoStationName);
                        return callback1(undefined);
                    }

                    //log.info(JSON.stringify(arpltn));

                    self.saveArpltnTown(town, arpltn, function (err, raw) {
                        return callback1(err, raw);
                    });
                });
            },
            function(err, results) {
                if (err) {
                    log.error(err);
                    return callback(err);
                }

                log.info('Finished update arpltn town info');
                return callback(err, results);
            });
    });
};

Keco.prototype.cbMainProcess = function (self, callback) {
    //check and update
    var date = new Date();

    callback = callback || function(){};

    if (self.checkGetCtprvnTime(date)) {
        self.getAllCtprvn(function (err) {
            if (err) {
                log.warn('Stopped index='+self._currentSidoIndex);
                return callback(err);
            }
            self.updateTownArpltnInfo(function (err) {
                if (err) {
                    log.warn(err);
                }
                callback(err);
            });
        });
    }
    else {
        callback();
    }

    return this;
};

/**
 * start to get data from Keco
 */
Keco.prototype.start = function () {
    log.info('start KECO SERVICE');

    this.addMsrstnInfoToTown(function (err) {
       log.error(err);
    });

    this.getCtprvnSidoList();

    setInterval(this.cbMainProcess, 60*1000*10, this); //10min
};

module.exports = Keco;