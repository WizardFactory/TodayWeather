/**
 * Created by aleckim on 2015. 12. 26..
 */

"use strict";

var xml2json  = require('xml2js').parseString;
var async = require('async');
var req = require('request');
var config = require('../config/config');

var MidRssModel = require('../models/modelMidRss');
var kmaTownMidRss = require('../models/kma/kma.town.mid.rss.model');

var KmaForecastZoneController = require('../controllers/kma/kma.forecast.zone.controller');

var collectTown = require('../lib/collectTownForecast');
var kmaTimelib = require('./kmaTimeLib');

var dnscache = require('dnscache')({
    "enable" : true,
    "ttl" : 300,
    "cachesize" : 1000
});

var WWW_KMA_GO_DOMAIN = 'www.kma.go.kr';

/**
 *
 * @constructor
 */
function MidRssKmaRequester() {
    this._nextGetTime = new Date();
    this._url = 'http://'+WWW_KMA_GO_DOMAIN+'/weather/forecast/mid-term-rss3.jsp';
    this._updateTimeTable =  [9, 21];   //kr 18, 06
}

MidRssKmaRequester.prototype.checkGetTime = function(time) {
    log.silly("midRssKma next get time"+this._nextGetTime);
    return time >= this._nextGetTime;
};

MidRssKmaRequester.prototype.setNextGetTime = function(time) {
    if (time) {
        this._nextGetTime = time;
        log.info("MidRssKma next get time "+this._nextGetTime);
        return this;
    }

    var i;
    for (i=0; i< this._updateTimeTable.length; i++) {
        if (this._nextGetTime.getUTCHours() < this._updateTimeTable[i]) {
            this._nextGetTime.setUTCHours(this._updateTimeTable[i]);
            break;
        }
    }
    if (i === this._updateTimeTable.length) {
        this._nextGetTime.setUTCDate(this._nextGetTime.getUTCDate()+1);
        this._nextGetTime.setUTCHours(this._updateTimeTable[0]);
    }
    this._nextGetTime.setUTCMinutes(0);
    this._nextGetTime.setUTCSeconds(30);

    log.info("MidRssKma next get time "+this._nextGetTime);
    return this;
};

MidRssKmaRequester.prototype.getMidRss = function(url, callback) {
    var url = url || this._url;
    log.info(`kma mid rss url=${url}`);
    req(url, function(err, response, body) {
        if (err) {
            return callback(err);
        }
        if ( response.statusCode >= 400) {
            return callback(new Error(body));
        }

        log.silly(body);
        callback(err, body);
    });
    return this;
};

MidRssKmaRequester.prototype.parsetmEf = function(tmEf) {
    var efStr; //YYYYMMDD
    efStr = tmEf.substr(0,4)+tmEf.substr(5,2)+tmEf.substr(8,2);
    log.silly(efStr);
    return efStr;
};

MidRssKmaRequester.prototype.parseMidRssData = function(midDataList, dataList) {
    var self = this;

    dataList.forEach(function (data) {
        var tmEf = data.tmEf[0];

        var efStr = self.parsetmEf(tmEf);
        var filteredList = midDataList.filter(function(data) {
            return data.date === efStr;
        });

        var midData;
        if (!filteredList.length) {
            midData = {date:efStr, taMin: data.tmn[0], taMax: data.tmx[0], wfAm: '', wfPm: '',
                reliability: data.reliability[0]};
        }
        else {
            midData = filteredList[0];
        }

        if(tmEf.substr(11,2) === '00') {
            midData.wfAm = data.wf[0];
            if (data.mode[0] === 'A01') {
                midData.wfPm = data.wf[0];
            }
        }
        else if(tmEf.substr(11,2) === '12') {
            midData.wfPm = data.wf[0];
        }

        if (!filteredList.length) {
            midDataList.push(midData);
            if (data.mode[0] === 'A01') {
                log.debug(midData);
            }
        }
        else {
            log.debug(midData);
        }
    });

    return this;
};

MidRssKmaRequester.prototype.parseMidRss = function(xmlData, callback) {
    var self = this;

    xml2json(xmlData, function (err, result) {
        if (err) {
            return callback(err);
        }
        try {
            var item = result.rss.channel[0].item[0];
            var koreaWf = item.description[0].header[0].wf[0];
            log.silly(koreaWf);
            var pubDate = item.description[0].header[0].tm[0];
            log.silly(pubDate);
            var locationList = item.description[0].body[0].location;
            var midKmaList = [];
            locationList.forEach(function (location) {
                var midKma = {province: location.province[0], city: location.city[0], pubDate: pubDate, midData: []};
                log.debug(midKma.province+' '+midKma.city);
                self.parseMidRssData(midKma.midData, location.data);
                midKmaList.push(midKma);
            });

            callback(err, midKmaList);
        }
        catch(e) {
            callback(e);
        }
    });

    return this;
};

MidRssKmaRequester.prototype.integrateMidRss2 = function (parsedData, callback) {
    async.map(parsedData,
        function(midRssKma, callback) {
            var city = midRssKma.city;
            var kmaForecastZoneController = new KmaForecastZoneController();
            kmaForecastZoneController.findForecastZoneCode({regName:city})
                .exec(function(err, result) {
                    if (err) {
                        log.error(err);
                    }
                    if (result.length === 0) {
                        err = new Error(`Fail to find regName:${city}`);
                        log.error(err);
                    }
                    else if (result.length > 1) {
                        log.warn('get multi regId', result);
                    }
                    if (result.length) {
                        midRssKma.regId = result[0].regId;
                    }
                    callback(null, midRssKma);
                });
        },
        function (err, result) {
            if (err) {
                log.error(err);
            }
            callback(null, result);
        });
};

/**
 * 폐지 예정
 * @param parsedData
 * @param callback
 * @returns {MidRssKmaRequester}
 */
MidRssKmaRequester.prototype.integrateMidRss = function (parsedData, callback) {
    var collectShortInfo = new collectTown();
    parsedData.forEach(function (midRssKma) {
        var pointNumberName = midRssKma.province.replace(/ㆍ/g, ',');
        if (pointNumberName.indexOf('강원도') !== -1) {
            pointNumberName = '강원도';
        }
        //log.info(pointNumberName);
        var pointNumber = collectShortInfo.listPointNumber.filter(function (pointNumber) {
           if (pointNumber.name === pointNumberName)  {
               return true;
           }
        })[0];
        if (pointNumber) {
            midRssKma.stnId = pointNumber.code;
        }

        var cityName = midRssKma.city;
        var city = collectShortInfo.listCityCode.filter(function(city) {
           if (city.name === cityName)  {
               return true;
           }
        })[0];
        if (city) {
            midRssKma.regId = city.code;
        }

        log.debug(midRssKma.stnId + ' ' + midRssKma.regId);
    });

    callback(undefined, parsedData);

    return this;
};

MidRssKmaRequester.prototype.saveMidRssNewForm = function (midKmaList, callback) {
    async.map(midKmaList,
        function(mid, cb){
            mid['pubDate'] = kmaTimelib.getKoreaDateObj(mid.pubDate);

            log.info('save mid rss : ', JSON.stringify(mid));
            kmaTownMidRss.update({regId:mid.regId}, mid, {upsert:true}, function(err){
                if(err){
                    log.error('midRssNewForm > failed to update db item', mid.regId);
                }
                cb(null, mid.pubDate);
            });
        },
        function (err, results) {
            if (err) {
                return callback(err);
            }
            callback(err, results[0]);
        }
    );

    return this;
};

MidRssKmaRequester.prototype.saveMidRss = function (midKmaList, callback) {
    MidRssModel.find({}, function (err, midRssModelList) {
        if (err) {
            return callback(err);
        }
        async.map(midKmaList, function (mid, cBack) {
                var midRssModel;
                for (var i=0; i<midRssModelList.length; i++) {
                    if (midRssModelList[i].regId === mid.regId) {
                        midRssModel = midRssModelList[i];
                        break;
                    }
                }
                if (!midRssModel) {
                    midRssModel = new MidRssModel(mid);
                    log.debug(midRssModel.toString());
                }
                else {
                    if (midRssModel.pubDate === mid.pubDate) {
                        log.debug('regId ', mid.regId, ' already saved pubDate=', mid.pubDate);
                        return cBack(undefined, mid.pubDate);
                    }
                    midRssModel.pubDate = mid.pubDate;
                    midRssModel.midData = mid.midData;
                }
                midRssModel.save(function (err) {
                    cBack(err, midRssModel.pubDate);
                });
            },
            function (err, results) {
                if (err) {
                    return callback(err);
                }
                callback(err, results[0]);
            });
    });
    return this;
};

MidRssKmaRequester.prototype.processGetMidRss = function (stnId, callback) {
    var self = this;

    async.waterfall([
            function(callback) {
                var url = 'http://'+WWW_KMA_GO_DOMAIN+'/weather/forecast/mid-term-rss3.jsp?stnId='+stnId;
                self.getMidRss(url, function (err, body) {
                    callback(err, body);
                });
            },
            function(xmlData, callback) {
                self.parseMidRss(xmlData, function(err, parsedData) {
                    callback(err, parsedData);
                });
            },
            function(parsedData, callback) {
                self.integrateMidRss2(parsedData, function (err, integratedData) {
                    callback(err, integratedData);
                });
            },
            function(integratedData, callback) {
                if(config.db.version == '1.0'){
                    self.saveMidRss(integratedData, function (err, result) {
                        callback(err, result);
                    });
                }
                else if(config.db.version == '2.0'){
                    self.saveMidRssNewForm(integratedData, function (err, result) {
                        callback(err, result);
                    });
                }
            }],
        function (err, result) { //pubDate = lastUpdateTime
            if (err) {
                log.debug(err);
            }
            else {
                log.info("succeed getting MID RSS KMA "+result);
                self.setNextGetTime();
            }
            callback(err);
        });

    return this;
};

MidRssKmaRequester.prototype.mainProcessM = function(self, callback) {
    var self = this;
    var stnList = new collectTown().listPointNumber;
    async.map(stnList,
        function (stnObj, callback) {
            self.processGetMidRss(stnObj.code, callback);
        },
        function (err, result) {
            callback(err, result);
        });
};

/**
 * 폐지 예정
 * @param self
 * @param callback
 * @returns {MidRssKmaRequester}
 */
MidRssKmaRequester.prototype.mainProcess = function(self, callback) {
    log.input('mainProcess');

    if (self.checkGetTime(new Date()) !== true) {
        log.silly("Update time isn't yet");
        if (callback) {
            callback(self);
        }
        return this;
    }

    async.waterfall([
            function(callback) {
                self.getMidRss(null, function (err, body) {
                    callback(err, body);
                });
            },
            function(xmlData, callback) {
                self.parseMidRss(xmlData, function(err, parsedData) {
                    callback(err, parsedData);
                });
            },
            function(parsedData, callback) {
                self.integrateMidRss2(parsedData, function (err, integratedData) {
                    callback(err, integratedData);
                });
            },
            function(integratedData, callback) {
                if(config.db.version == '1.0'){
                    self.saveMidRss(integratedData, function (err, result) {
                        callback(err, result);
                    });
                }
                else if(config.db.version == '2.0'){
                    self.saveMidRssNewForm(integratedData, function (err, result) {
                        callback(err, result);
                    });
                }
            }],
        function (err, result) { //pubDate = lastUpdateTime
            if (err) {
                log.debug(err);
            }
            else {
                log.info("succeed getting MID RSS KMA "+result);
                self.setNextGetTime();
            }
            callback(self, err);
        });

    return this;
};

MidRssKmaRequester.prototype.cbMidRssProcess = function(self, err) {
    var nextCheckTime = 10*1000; //10secs;
    if (err) {
        log.error(err);
    }
    else {
        nextCheckTime *= 6; //1min
    }
    setTimeout(self.mainProcess, nextCheckTime, self, self.cbMidRssProcess);
};

MidRssKmaRequester.prototype.start = function () {
    log.info('start MID RSS KMA REQUEST');

    this.setNextGetTime(new Date());
    setTimeout(this.mainProcess, 10*1000, this, this.cbMidRssProcess); //10secs
};

module.exports = MidRssKmaRequester;

