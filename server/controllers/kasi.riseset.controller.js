/**
 * Created by aleckim on 2017. 7. 2..
 */

'use strict';

var async = require('async');
var req = require('request');
var config = require('../config/config');

var kmaTimeLib = require('../lib/kmaTimeLib');
var KasiRiseSet = require('../models/modelKasiRiseSet');
var Town = require('../models/town');

var APIS_DATA_GO_DOMAIN = 'apis.data.go.kr';
var kasiUrl = 'http://'+APIS_DATA_GO_DOMAIN+'/B090041/openapi/service/RiseSetInfoService';
var apiLocationName = 'getLCRiseSetInfo';
var apiAreaName = 'getAreaRiseSetInfo';

var dnscache = require('dnscache')({
    "enable" : true,
    "ttl" : 300,
    "cachesize" : 1000
});

function kasiRiseSet() {
}

kasiRiseSet._makeLocationApiUrl = function (geocode, date) {
    var url = kasiUrl+'/'+apiLocationName+'?';
    url += 'longitude='+geocode.lon+'&';
    url += 'latitude='+geocode.lat+'&';
    url += 'locdate='+date+'&';
    url += 'dnYn=Y&_type=json&';
    url += 'ServiceKey='+config.keyString.normal;

    return url;
};

kasiRiseSet._makeAreaApiUrl = function (location, date) {
    var url = kasiUrl+'/'+apiAreaName+'?';
    url += 'location='+encodeURIComponent(location)+'&';
    url += 'locdate='+date+'&';
    url += '_type=json&';
    url += 'ServiceKey='+config.keyString.normal;

    return url;
};

kasiRiseSet._requestRiseSetFromApi = function (url, callback) {
    log.debug('request rise set from api url='+url);

    req(url, {json: true, timeout: 5000}, function(err, response, body) {
        if (err) {
            return callback(err);
        }
        if (response.statusCode >= 400) {
            err = new Error("url="+url+" statusCode="+response.statusCode);
            return callback(err);
        }
        callback(err, body);
    });
};

kasiRiseSet._checkDataValid = function (result) {
    var err;

    if (result.response == undefined ||
        result.response.header == undefined ||
        result.response.header.resultCode == undefined ||
        result.response.header.resultCode != '00')
    {
        if (result && result.response && result.response.header && result.response.header.resultMsg) {
            err = new Error(result.response.header.resultMsg);
        }
        else {
            log.error({func:'_checkDataValid', result: result});
            err = new Error("header is invalid");
            err.code = 100;
        }
        return err;
    }

    if (result.response.body == undefined ||
        result.response.body.items == undefined ||
        result.response.body.items.item == undefined)
    {
        err = new Error("body is invalid");
        return err;
    }

    return err;
};

/**
 *
 * @param area name of location
 * @param date
 * @param callback
 * @private
 */
kasiRiseSet._getAreaRiseSetFromApi = function (area, date, callback) {
    var self = this;
    var url = self._makeAreaApiUrl(area, date);

    async.retry({times:3, interval: 1000*5},
        function (retryCallback) {
            self._requestRiseSetFromApi(url, function (err, result) {
                if (err) {
                    //log.warn(url);
                    //log.warn(err);
                    return retryCallback(err);
                }
                err = self._checkDataValid(result);
                if (err) {
                    //log.warn(url);
                    //log.warn(err);
                    return retryCallback(err);
                }

                callback(null, result.response.body.items.item);
            });
        },
        function (err, result) {

            if(err) {
                return callback(err);
            }
            callback(null, result);
        });
};

/**
 *
 * @param geocode geo of location
 * @param dateList
 * @param callback
 * @returns {kasiRiseSet}
 * @private
 */
kasiRiseSet._getRiseSetListFromApi = function (geocode, dateList, callback) {
    var self = this;

    async.map(dateList,
        function (date, mapCallback) {
           async.retry({times:6, interval: 1000*2},
               function (retryCallback) {
                   self._requestRiseSetFromApi(self._makeLocationApiUrl(geocode, date), function (err, result) {
                       if(err) {
                           log.warn(err);
                           return retryCallback(err);
                       }

                       err = self._checkDataValid(result);
                       if (err) {
                           log.warn(err);
                           return retryCallback(err);
                       }

                       retryCallback(null, result.response.body.items.item);
                   });
               },
               function (err, result) {
                   if(err) {
                      return mapCallback(err);
                   }
                   mapCallback(null, result);
               });
        },
        function (err, results) {
            if(err) {
                return callback(err);
            }
            callback(null, results);
        });

    return this;
};

kasiRiseSet._apiRawList2modelKasiRiseSetList = function (rawDataList, callback) {
    var rsList = [];

    try {
        rawDataList.forEach(function (rawData) {
            var geo = [rawData.longitudeNum, rawData.latitudeNum];
            var riseSet = {geo: geo, location: rawData.location};
            riseSet.locdate = kmaTimeLib.convertStringToDate(''+rawData.locdate);

            var propertyList = KasiRiseSet.getDataPropertyList();
            propertyList.forEach(function (propertyName) {
                if (typeof rawData[propertyName] == 'number' || rawData[propertyName].indexOf('-') == -1) {
                    riseSet[propertyName] = kmaTimeLib.convertStringToDate(rawData.locdate + (''+rawData[propertyName]));
                }
            });

            rsList.push(riseSet);
        });
    }
    catch (err) {
        return callback(err);
    }

    callback(null, rsList);

    return this;
};

/**
 *
 * @param rsInfoList kasi rise set model list
 * @param callback
 * @returns {kasiRiseSet}
 * @private
 */
kasiRiseSet._updateKasiRiseSetList = function (rsInfoList, callback) {
    async.mapSeries(rsInfoList,
        function (rsInfo, cb) {
            KasiRiseSet.update({locdate: rsInfo.locdate, location: rsInfo.location}, rsInfo, {upsert:true},
                function (err) {
                    if(err) {
                        return cb(err);
                    }
                    cb();
                });
        },
        function (err) {
            if(err) {
                return callback(err);
            }
            callback();
        });

    return this;
};

/**
 * rawdata가 글자 숫자 썩여서 들어오고, moonXXX의 경우 그날 없으면 '------'으로 전달됨
 * 결과 "2017.07.03 05:28"
 * @param rawDataList
 * @param callback
 * @returns {kasiRiseSet}
 * @private
 */
kasiRiseSet._apiRaw2riseSetList = function (rawDataList, callback) {
    var rsList = [];
    try {
        rawDataList.forEach(function (rawdata) {
            var geo = [rawdata.longitudeNum, rawdata.latitudeNum];
            var riseSet = {date: ''+rawdata.locdate, locationName: rawdata.location, geo: geo};

            var propertyList = KasiRiseSet.getDataPropertyList();
            propertyList.forEach(function (propertyName) {
                if (typeof rawdata[propertyName] == 'number' || rawdata[propertyName].indexOf('-') == -1) {
                    riseSet[propertyName] = kmaTimeLib.convertYYYYMMDDHHMMtoYYYYoMMoDD_HHoMM(rawdata.locdate + (''+rawdata[propertyName]));
                }
                else {
                    riseSet[propertyName] = '';
                }
            });

            rsList.push(riseSet);
        });
    }
    catch(err) {
        return callback(err);
    }

    callback(null, rsList);

    return this;
};

/**
 * convert raw data to model kasi rise set
 * update database
 * @param rawDataList
 * @param callback
 * @private
 */
kasiRiseSet._saveRawDataList = function (rawDataList, callback) {
    var self = this;

    async.waterfall([
            function (cb) {
                self._apiRawList2modelKasiRiseSetList(rawDataList, function (err, rsInfoList) {
                    if (err) {
                        return cb(err);
                    }
                    cb(null, rsInfoList);
                });
            },
            function (rsInfoList, cb) {
                self._updateKasiRiseSetList(rsInfoList, function (err) {
                   if(err)  {
                       return cb(err);
                   }
                   cb() ;
                })
            }
        ],
        function (err, result) {
            if(err) {
                return callback(err);
            }
            callback();
        });
};

kasiRiseSet.getRiseSetListFromApi = function (geocode, dateList, syncSave, callback) {
    var self = this;

    async.waterfall([
            function (cb) {
                self._getRiseSetListFromApi(geocode, dateList, function (err, rsList) {
                    if (err)   {
                        return cb(err);
                    }

                    cb(null, rsList);
                });
            },
            function (rawDataList, cb) {
                self._saveRawDataList(rawDataList, function (err) {
                    if(err) {
                        log.error(err);
                    }
                    if(syncSave) {
                        log.info('geocode='+JSON.stringify(geocode)+' saved');
                        cb(null, rawDataList);
                    }
                });

                if(syncSave == false) {
                    cb(null, rawDataList);
                }
            },
            function (rawDataList, cb) {
                //convert format to model
                //"2017.07.03 05:28"
                self._apiRaw2riseSetList(rawDataList, function (err, rsList) {
                    if(err) {
                        return cb(err);
                    }

                    return cb(null, rsList);
                });
            }
        ],
        function (err, rsList) {
            if(err) {
                return callback(err);
            }
            callback (null, rsList) ;
        });

    return this;
};

/**
 *
 * @param location
 * @param dateList
 * @param callback
 * @private
 */
kasiRiseSet._findKasiRiseSetList = function (location, dateList, callback) {
    var query;
    var array = [];

    dateList.forEach(function (strDate) {
        var date = kmaTimeLib.convertStringToDate(strDate);
        var q = {location: location, locdate: date};
        array.push(q);
    });

    query = {$or: array};

    KasiRiseSet.find(query, {_id: 0}).sort({date: -1}).lean().exec(function (err, kasiRiseSetList) {
        if (err) {
            return callback(err);
        }
        if (kasiRiseSetList.length <= 0) {
            err = new Error("Fail to find kasi rise set location="+location);
            return callback(err);
        }
        callback(null, kasiRiseSetList);
    });

    return this;
};

kasiRiseSet._model2RiseSet = function (modelRsList, callback) {
    var rsList = [];

    try {
        modelRsList.forEach(function (modelRiseSet) {
            var riseSet = {locationName: modelRiseSet.location, locationGeo: modelRiseSet.geo};
            riseSet.date = kmaTimeLib.convertDateToYYYYMMDD(modelRiseSet.locdate);
            var propertyList = KasiRiseSet.getDataPropertyList();
            propertyList.forEach(function (propertyName) {
                if (modelRiseSet.hasOwnProperty(propertyName)) {
                    riseSet[propertyName] = kmaTimeLib.convertDateToYYYYoMMoDD_HHoMM(modelRiseSet[propertyName]);
                }
            });
            rsList.push(riseSet);
        });
    }
    catch(err) {
        return callback(err);
    }

    callback(null, rsList);

    return this;
};

kasiRiseSet._findRiseSetByGeo = function (geocode, callback) {
    var geo = [geocode.lon, geocode.lat];
    KasiRiseSet.find({geo: {"$near": geo}}, {_id: 0}).limit(1).lean().exec(function (err, modelList) {
        if (err) {
            return callback(err);
        }
        if (modelList.length == 0) {
            err = new Error("Fail to find geo="+JSON.stringify(geo));
            return callback(err);
        }
        callback(null, modelList[0]);
    });

    return this;
};

/**
 * find location near geo
 * find list of location
 * convert model to rise set
 * @param geocode
 * @param dateList
 * @param callback
 * @returns {kasiRiseSet}
 */
kasiRiseSet.getRiseSetListFromDatabase = function (geocode, dateList, callback) {
    var self = this;

    async.waterfall([
            function (cb) {
                self._findRiseSetByGeo(geocode, function (err, modelRs) {
                    if (err)  {
                        return cb(err);
                    }
                    cb(null, modelRs);
                })
            },
            function (modelRs, cb) {
                self._findKasiRiseSetList(modelRs.location, dateList, function (err, modelRsList) {
                    if(err) {
                        return cb(err);
                    }
                    cb(null, modelRsList);
                });
            },
            function (modelRsList, cb) {
                self._model2RiseSet(modelRsList, function (err, rsList) {
                    if (err) {
                        return cb(err);
                    }
                    cb(null, rsList);
                });
            }
        ],
        function (err, rsList) {
            if(err) {
                return callback(err);
            }
            callback(null, rsList);
        });

    return this;
};

/**
 * call from control town
 * db에 데이터가 1개라도 있으면, 디비 데이터 사용 for 성능
 * @param geocode
 * @param dateList
 * @param callback
 */
kasiRiseSet.getRiseSetList = function (geocode, dateList, callback) {
    var self = this;

    async.waterfall([
        function (cb) {
            self.getRiseSetListFromDatabase(geocode, dateList, function(err, rsList) {
                if (err) {
                    log.error(err);
                    return cb(null, []);
                }
                cb(null, rsList);
            });
        },
        function (rsListFromDB, cb) {
            //todo filter data from database for reuse
            //if(rsListFromDB.length == dateList.length) {
            //   return cb(null, rsListFromDB);
            //}

            if (rsListFromDB.length >= 0) {
                return cb(null, rsListFromDB);
            }

            self.getRiseSetListFromApi(geocode, dateList, false, function (err, rsList) {
                if (err)   {
                    return cb(err);
                }

                cb(null, rsList);
            });
        }
        //merge database and api
    ], function (err, rsList) {
        if (err) {
            return callback(err);
        }
        callback(null, rsList);
    });
};


kasiRiseSet._apiRaw2modelKasiRiseSet = function (rawData, callback) {

    try {
        var geo = [rawData.longitudeNum, rawData.latitudeNum];
        var riseSet = {geo: geo, location: rawData.location};
        riseSet.locdate = kmaTimeLib.convertStringToDate(''+rawData.locdate);

        var propertyList = KasiRiseSet.getDataPropertyList();
        propertyList.forEach(function (propertyName) {
            if (typeof rawData[propertyName] == 'number' || rawData[propertyName].indexOf('-') == -1) {
                riseSet[propertyName] = kmaTimeLib.convertStringToDate(rawData.locdate + (''+rawData[propertyName]));
            }
        });
    }
    catch (err) {
        callback(err);
        return this;
    }

    callback(null, riseSet);
    return this;
};

kasiRiseSet._updateKasiRiseSet = function(modelRiseSet, callback) {
    KasiRiseSet.update({locdate: modelRiseSet.locdate, location: modelRiseSet.location}, modelRiseSet, {upsert:true},
        function (err) {
            if(err) {
                return callback(err);
            }
            callback(null, 'ok');
        });

    return this;
};

kasiRiseSet._findKasiRiseSet = function(area, date, callback) {
    KasiRiseSet.find({location:area, locdate: date}, {_id:-1}).limit(1).lean().exec(function (err, modelList) {
        if (err) {
            return callback(err);
        }

        callback(null, modelList);
    });
};

/**
 * check date of data -> get from api -> raw 2 model -> update db
 * @param area name of location
 * @param strYYYYMMDD
 * @param callback
 */
kasiRiseSet.updateAreaRiseSetFromApi = function (area, strYYYYMMDD, callback) {
    var self = this;

    async.waterfall([
            function (cb) {
                var date = kmaTimeLib.convertStringToDate(strYYYYMMDD);
                self._findKasiRiseSet(area, date, function (err, modelRiseSetList) {
                    if (err) {
                        return cb(err);
                    }
                    if (modelRiseSetList.length == 0) {
                        return cb();
                    }
                    else {
                        err = new Error("already saved");
                        err.state = 'skip';
                        return cb(err, {area:area, date:strYYYYMMDD, result:'skip'});
                    }
                });
            },
            function (cb) {
                self._getAreaRiseSetFromApi(area, strYYYYMMDD, function (err, rawData) {
                    if (err) {
                        return cb(err);
                    }
                    return cb(null, rawData);
                });
            },
            function (rawData, cb) {
                self._apiRaw2modelKasiRiseSet(rawData, function (err, modelRiseSet) {
                    if(err) {
                        return cb(err);
                    }
                    return cb(null, modelRiseSet);
                });
            },
            function (modelRiseSet, cb) {
                self._updateKasiRiseSet(modelRiseSet, function (err, result) {
                    if(err) {
                        return cb(err);
                    }
                    cb(null, result);
                });
            }
        ],
        function (err, result) {
            if (err) {
                if (err.state != 'skip') {
                    return callback(err);
                }
            }
            callback(null, {area:area, date:strYYYYMMDD, result:result});
        });

    return this;
};


/**
 *
 * @param area
 * @param dateList
 * @param callback
 * @returns {kasiRiseSet}
 */
kasiRiseSet.updateAreaRiseSetListFromApi = function (area, dateList, callback) {
    var self = this;

    async.mapSeries(dateList,
        function (date, cb) {
            var strYYYYMMDD = kmaTimeLib.convertDateToYYYYMMDD(date);
            self.updateAreaRiseSetFromApi(area, strYYYYMMDD, function (err, result) {
                if(err) {
                    return cb(err);
                }

                cb(null, result);
            });
        },
        function (err, result) {
            if(err) {
                return callback(err);
            }

            callback(null, result);
        }
    );

    return this;
};

/**
 * gather kasi rise set of today, tomorrow
 * raw to model
 * save
 * @param callback
 */
kasiRiseSet.gatherAreaRiseSetFromApi = function (callback) {
    var self = this;
    var areaList =  KasiRiseSet.getAreaList();

    log.info('kasi rise set - gather area rise set');

    async.mapSeries(areaList,
        function (area, cb) {
            var dateList = [];
            for (var i=-8; i<10; i++) {
                var date = new Date();
                date.setDate(date.getDate()+i);
                dateList.push(date);
            }

            self.updateAreaRiseSetListFromApi(area, dateList, function (err, results) {
               if (err) {
                   return cb(err);
               }
                cb(null, results);
            });
        },
        function (err, results) {
            if(err) {
                return callback(err);
            }
            callback(null, results);
        });

    return this;
};

module.exports = kasiRiseSet;

