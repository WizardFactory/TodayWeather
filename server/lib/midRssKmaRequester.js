/**
 * Created by aleckim on 2015. 12. 26..
 */

var xml2json  = require('xml2js').parseString;
var async = require('async');
var req = require('request');

var MidRssModel = require('../models/modelMidRss');

var collectTown = require('../lib/collectTownForecast');

/**
 *
 * @constructor
 */
function MidRssKmaRequester() {
    this._nextGetTime = new Date();
    this._url = 'http://www.kma.go.kr/weather/forecast/mid-term-rss3.jsp';
    this._updateTimeTable =  [5, 20];   //kr 06, 18
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

MidRssKmaRequester.prototype.getMidRss = function(callback) {
    req(this._url, function(err, response, body) {
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
            if (data.date === efStr) {
                return true;
            }
            return false;
        });

        var midData;
        if (!filteredList.length) {
            midData = {date:efStr, tmn: data.tmn[0], tmx: data.tmx[0], wfAm: '', wfPm: '',
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

MidRssKmaRequester.prototype.saveMidRss = function (midKmaList, callback) {
    MidRssModel.find({}, function (err, midRssModelList) {
        if (err) {
            return callback(err);
        }
        midKmaList.forEach(function (mid) {
            var midRssModel;
            for (var i=0; i<midRssModelList.length; i++) {
               if (midRssModelList[i].regId === mid.regId) {
                   midRssModel = midRssModelList[i];
                   break;
               }
            }
            if (!midRssModel) {
                midRssModel = new MidRssModel(mid);
                log.info(midRssModel.toString());
            }
            else {
                midRssModel.pubDate = mid.pubDate;
                midRssModel.midData = mid.midData;
            }
            midRssModel.save(function (err) {
                callback(err, midRssModel.pubDate);
            });
        });
    });
    return this;
};

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
                self.getMidRss(function (err, body) {
                    callback(err, body);
                });
            },
            function(xmlData, callback) {
                self.parseMidRss(xmlData, function(err, parsedData) {
                    callback(err, parsedData);
                });
            },
            function(parsedData, callback) {
                self.integrateMidRss(parsedData, function (err, integratedData) {
                    callback(err, integratedData);
                });
            },
            function(integratedData, callback) {
                self.saveMidRss(integratedData, function (err, result) {
                    callback(err, result);
                });
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

MidRssKmaRequester.prototype.cbMainProcess = function(self, err) {
    var nextCheckTime = 10*1000; //10secs;
    if (err) {
        log.error(err);
    }
    else {
        nextCheckTime *= 6; //1min
    }
    setTimeout(self.mainProcess, nextCheckTime, self, self.cbMainProcess);
};

MidRssKmaRequester.prototype.start = function () {
    log.info('start MID RSS KMA REQUEST');

    this.setNextGetTime(new Date());
    setTimeout(this.mainProcess, 10*1000, this, this.cbMainProcess); //10secs
};

module.exports = MidRssKmaRequester;

