/**
 * Created by aleckim on 2016. 5. 2..
 */

"use strict";

var apn = require('apn');
var gcm = require('node-gcm');
var config = require('../config/config');
var PushInfo = require('../models/modelPush');
var async = require('async');
var req = require('request');
var ControllerTown24h = require('./controllerTown24h');
var cTown = new ControllerTown24h();
var UnitConverter = require('../lib/unitConverter');
var unitConverter = new UnitConverter();

var KecoController = require('../controllers/kecoController');
var LifeIndexKmaController = require('./lifeIndexKmaController');

var dnscache = require('dnscache')({
    "enable" : true,
    "ttl" : 300,
    "cachesize" : 1000
});

var apnGateway;

var production = false;
if (process.env.NODE_ENV === 'production') {
    apnGateway = "gateway.push.apple.com";
    production = true;
}
else {
    apnGateway = "gateway.sandbox.push.apple.com";
}

var apnOptions = {
    gateway : apnGateway,
    cert: './config/aps_cert.pem',
    key: './config/aps_key.pem',
    production: production,
    batchFeedback: true,
    interval: 300 //seconds
};

var server_access_key = config.push.gcmAccessKey;

var apnConnection = new apn.Connection(apnOptions);
var sender = new gcm.Sender(server_access_key);

var i18n = require('i18n');

function ControllerPush() {
    this.timeInterval = 60*1000; //1min

    this.domain = config.push.serviceServer.replace('http://', '').replace('https://', '');
    this.url = config.push.serviceServer;

    [apnGateway, this.domain].forEach(function (value) {
        var domain = value;
        dnscache.lookup(domain, function(err, result) {
            if (err) {
                console.error(err);
            }
            else {
                console.info('pushctrl cached domain:', domain, ', result:', result);
            }
        });
    });
}

ControllerPush.prototype.updateRegistrationId = function (newId, oldId, callback) {
    PushInfo.find({registrationId: oldId}, function (err, pushList) {
        if (err) {
            return callback(err);
        }
        if (pushList.length == 0) {
            log.info("no registrationId="+oldId);
            return callback(undefined, 'not found oldRegId='+oldId);
        }

        pushList.forEach(function (push) {
            push.registrationId = newId;
            push.save(function (err) {
                if (err) {
                    log.error(err);
                }
            });
        });
        return callback(undefined, 'We will change itmes='+pushList.length+' regid to '+newId);
    });

    return this;
};

/**
 * save push info
 */
ControllerPush.prototype.updatePushInfo = function (pushInfo, callback) {
    PushInfo.update(
        {registrationId: pushInfo.registrationId, cityIndex: pushInfo.cityIndex},
        pushInfo,
        {upsert : true},
        function (err, result) {
            if (err) {
                return callback(err);
            }
            return callback(undefined, result);
        });

    return this;
};

ControllerPush.prototype.removePushInfo = function (pushInfo, callback) {
    PushInfo.remove({
            registrationId: pushInfo.registrationId,
            type:pushInfo.type,
            cityIndex: pushInfo.cityIndex},
        function (err, result) {
            if (err) {
                return callback(err);
            }
            if (!result) {
                return callback(new Error('Fail to get result'));
            }
            log.info(result.toString());
            callback(undefined, result.toString());
        });

    return this;
};

ControllerPush.prototype.getPushByTime = function (time, callback) {
    PushInfo.find({pushTime: time}).lean().exec(function (err, pushList) {
        if (err) {
            return callback(err);
        }
        if (pushList.length == 0) {
            return callback('No push info time='+time);
        }
        callback(undefined, pushList);
    });

    return this;
};

/**
 * node-gcm에 나와야 있는 data, notification분리 방법으로 보내면 안됨. phonegap-plugin-push에 나와야 있는 예제를 따라해야 함.
 * @param pushInfo
 * @param notification
 * @param callback
 * @returns {ControllerPush}
 */
ControllerPush.prototype.sendAndroidNotification = function (pushInfo, notification, callback) {
    log.info('send android notification pushInfo='+JSON.stringify(pushInfo)+
                ' notification='+JSON.stringify(notification));

    var data = {
        title: notification.title,
        body: notification.text,
        //"image": "www/img/weatherIcon/Sun.png", //it working but small icon has some problems
        cityIndex: pushInfo.cityIndex,
        "notId": pushInfo.cityIndex,
        'content-available': '1'
    };

    var message = new gcm.Message({
        priority     : 'high',
        timeToLive   : 86400,
        sound        : 'default',
        data         : data
    });

    /**
     * Params: message-literal, registrationIds-array, No. of retries, callback-function
     **/
    sender.send(message, [pushInfo.registrationId], 5, function (err, result) {
        if (err) {
            return callback(err);
        }
        return callback(undefined, result);
    });

    return this;
};

/**
 * @param pushInfo
 * @param notification title, text
 * @param callback
 */
ControllerPush.prototype.sendIOSNotification = function (pushInfo, notification, callback) {
    log.info('send ios notification pushInfo='+JSON.stringify(pushInfo)+ ' notification='+JSON.stringify(notification));
    var myDevice = new apn.Device(pushInfo.registrationId);

    var note = new apn.Notification();
    //note.expiry = Math.floor(Date.now() / 1000) + 3600; // Expires 1 hour from now.
    //note.badge = 1;
    note.sound = "ping.aiff";
    note.alert = notification.title+'\n'+notification.text;
    //note.contentAvailable = true;
    note.payload = {cityIndex: pushInfo.cityIndex};
    apnConnection.pushNotification(note, myDevice);
    callback(undefined, 'sent');
    return this;
};

ControllerPush.prototype._getAqiStr = function (arpltn, trans) {
    var str;
    var priorityArray = ['pm25', 'pm10', 'o3', 'khai'].sort(function (a, b) {
        if (!arpltn.hasOwnProperty(a+'Grade')) {
            return 1;
        }
        if (!arpltn.hasOwnProperty(a+'Grade')) {
            return -1;
        }

        if(arpltn[a+'Grade'] < arpltn[b+'Grade']) {
            return 1;
        }
        else if(arpltn[a+'Grade'] > arpltn[b+'Grade']) {
            return -1;
        }
        return 0;
    });

    if (priorityArray[0] === 'pm25') {
        str = trans.__("LOC_PM25")+" "+ arpltn.pm25Str;
    }
    else if (priorityArray[0] === 'pm10') {
        str = trans.__("LOC_PM10")+" "+ arpltn.pm10Str;
    }
    else if (priorityArray[0] === 'o3') {
        str = trans.__("LOC_O3")+" "+ arpltn.o3Str;
    }
    else if (priorityArray[0] === 'khai') {
        str = trans.__("LOC_AQI")+" "+ arpltn.khaiStr;
    }

    return str;
};

/**
 *
 * @param pushInfo
 * @param weatherInfo
 * @returns {string}
 * @private
 */
ControllerPush.prototype._makeKmaPushMessage = function (pushInfo, weatherInfo) {
    var pushMsg;

    var trans = {};
    i18n.configure({
        // setup some locales - other locales default to en silently
        locales: ['en', 'ko', 'ja', 'zh-CN', 'de', 'zh-TW'],
        // where to store json files - defaults to './locales'
        directory: __dirname + '/../locales',
        register: trans
    });

    trans.setLocale(pushInfo.lang);

    var location = "";
    if (pushInfo.name) {
        location = pushInfo.name + " ";
    }
    else {
        if (weatherInfo.townName) {
            location = weatherInfo.townName + ' ';
        }
        else if (weatherInfo.cityName) {
            location = weatherInfo.cityName + ' ';
        }
        else if (weatherInfo.regionName) {
            location = weatherInfo.regionName + ' ';
        }
    }

    var dailyArray = [];
    var dailySummary = "";
    var current = weatherInfo.current;

    var time = current.time;
    var theDay;
    var today;

    today = weatherInfo.midData.dailyData.find(function (dayInfo) {
        if (dayInfo.fromToday === 0) {
            return dayInfo;
        }
    });

    if (time < 18) {
        theDay = today;
        dailySummary += trans.__("LOC_TODAY")+": ";
    }
    else {
        theDay = weatherInfo.midData.dailyData.find(function (dayInfo) {
            if (dayInfo.fromToday === 1) {
                return dayInfo;
            }
        });
        dailySummary += trans.__("LOC_TOMORROW")+": ";
    }

    if (theDay.skyAm && theDay.skyPm) {
        dailyArray.push(cTown._getWeatherEmoji(theDay.skyAm)+cTown._getEmoji("RightwardsArrow")+cTown._getWeatherEmoji(theDay.skyPm));
    }
    else if (theDay.skyIcon) {
        dailyArray.push(cTown._getWeatherEmoji(theDay.skyIcon));
    }

    if (theDay.hasOwnProperty('tmn') && theDay.hasOwnProperty('tmx')) {
        dailyArray.push(parseInt(theDay.tmn)+"˚/"+parseInt(theDay.tmx)+"˚");
    }
    if (theDay.pty && theDay.pty > 0) {
        if (theDay.pop && current.pty <= 0) {
            if(theDay.date === today.date && current.pty <= 0) {
               //It's raining or snowing so we didn't show pop
            }
            else {
                dailyArray.push(trans.__("LOC_PROBABILITY_OF_PRECIPITATION")+" "+theDay.pop+"%");
            }
        }
    }

    if (theDay.dustForecast) {
        var df = theDay.dustForecast;
        if (df.pm25Grade > df.pm10Grade) {
            dailyArray.push(trans.__("LOC_PM25") + " " + df.pm25Str);
        }
        else {
            dailyArray.push(trans.__("LOC_PM10") + " " + df.pm10Str);
        }

        if (df.o3Str) {
            dailyArray.push(trans.__("LOC_O3") + " "+ df.o3Str);
        }
    }

    //불쾌지수

    dailySummary += dailyArray.toString();

    var hourlyArray = [];
    var hourlySummary = "";

    if (current.skyIcon) {
        var weather = cTown._getWeatherEmoji(current.skyIcon);
        hourlyArray.push(weather);
    }
    if (current.t1h) {
        var str = current.t1h+"˚";
        hourlyArray.push(str);
    }

    if (current.arpltn) {
        var aqiStr = this._getAqiStr(current.arpltn, trans);
        if (aqiStr) {
            hourlyArray.push(aqiStr);
        }
    }

    if (current.pty && current.pty > 0 && current.rn1 != undefined) {
        current.ptyStr = cTown._convertKmaPtyToStr(current.pty, trans);
        hourlyArray.push(current.ptyStr+" "+ current.rn1 + pushInfo.units.precipitationUnit);
    }
    hourlySummary += hourlyArray.toString();
    //불쾌지수

    pushMsg = {title: location+hourlySummary, text: dailySummary};
    return pushMsg;
};

ControllerPush.prototype._requestKmaDailySummary = function (pushInfo, callback) {
    var self = this;
    var apiVersion = "v000901";
    var url;
    var town = pushInfo.town;

    if (pushInfo.geo) {
        url = self.url+'/weather/coord';
        url += '/'+pushInfo.geo[1]+","+pushInfo.geo[0];
    }
    else if (pushInfo.town) {
        url = self.url+"/"+apiVersion+"/kma/addr";
        if (town.first) {
            url += '/'+ encodeURIComponent(town.first);
        }
        if (town.second) {
            url += '/' + encodeURIComponent(town.second);
        }
        if (town.third) {
            url += '/' + encodeURIComponent(town.third);
        }
    }
    else {
        callback(new Error("Fail to find geo or town info"));
        return this;
    }

    var count = 0;
    var querys = pushInfo.units;
    for (var key in querys) {
        url += count === 0? '?':'&';
        url += key+'='+querys[key];
        count ++;
    }

    log.info('request url='+url);
    var options = {
        url : url,
        headers: {
            'Accept-Language': pushInfo.lang
        },
        json:true
    };

    req(options, function(err, response, body) {
        log.info('Finished '+ url +' '+new Date());
        if (err) {
            return callback(err);
        }

        if ( response.statusCode >= 400) {
            err = new Error("response.statusCode="+response.statusCode);
            return callback(err)
        }

        if (body.units == undefined) {
            var obj = {};
            obj.temperatureUnit = "C";
            obj.windSpeedUnit = "m/s";
            obj.pressureUnit = "hPa";
            obj.distanceUnit = "km";
            obj.precipitationUnit = "mm";
            obj.airUnit = "airkorea";
            body.units = obj;
        }

        var pushMsg = "";
        try {
           pushMsg =  self._makeKmaPushMessage(pushInfo, body);
        }
        catch(e) {
           return callback(e);
        }
        callback(undefined, pushMsg);
    });

    return this;
};

ControllerPush.prototype._pty2str = function (pty, translate) {
    if (pty === 1) {
        return translate.__("LOC_PRECIPITATION");
    }
    else if (pty === 2) {
        return translate.__("LOC_SNOWFALL");
    }
    else if (pty === 3) {
        //return "강수/적설량"
        return translate.__("LOC_PRECIPITATION");
    }
    else if (pty === 4) {
        return translate.__("LOC_HAIL");
    }

    return "";
};

ControllerPush.prototype._parseWorldSkyState = function(precType, cloud, isNight) {
    var skyIconName = "";

    if (isNight) {
        skyIconName = "Moon";
    }
    else {
        skyIconName = "Sun";
    }

    if (!(cloud == undefined)) {
        if (cloud <= 20) {
            skyIconName += "";
        }
        else if (cloud <= 50) {
            skyIconName += "SmallCloud";
        }
        else if (cloud <= 80) {
            skyIconName += "BigCloud";
        }
        else {
            skyIconName = "Cloud";
        }
    }
    else {
        if (precType > 0)  {
            skyIconName = "Cloud";
        }
    }

    switch (precType) {
        case 0:
            skyIconName += "";
            break;
        case 1:
            skyIconName += "Rain";
            break;
        case 2:
            skyIconName += "Snow";
            break;
        case 3:
            skyIconName += "RainSnow";
            break;
        case 4: //우박
            skyIconName += "RainSnow";
            break;
        default:
            console.log('Fail to parse precType='+precType);
            break;
    }

    //if (lgt === 1) {
    //    skyIconName += "Lightning";
    //}

    return skyIconName;
};


ControllerPush.prototype._makeDsfPushMessage = function(pushInfo, worldWeatherData) {
    var self = this;
    var pushMsg;
    var trans = {};
    i18n.configure({
        // setup some locales - other locales default to en silently
        locales: ['en', 'ko', 'ja', 'zh-CN', 'de', 'zh-TW'],
        // where to store json files - defaults to './locales'
        directory: __dirname + '/../locales',
        register: trans
    });
    trans.setLocale(pushInfo.lang);

    var location = "";
    if (pushInfo.name) {
        location = pushInfo.name + " ";
    }

    var dailyArray = [];
    var dailySummary = "";
    var current = worldWeatherData.thisTime[1];

    var currentDate = new Date(current.dateObj);
    var time = currentDate.getHours();

    var theDay;
    var today;
    var targetDate;

    if (time < 18) {
        targetDate = currentDate.getDate();
        dailySummary += trans.__("LOC_TODAY")+": ";
    }
    else {
        currentDate.setDate(currentDate.getDate()+1);
        targetDate = currentDate.getDate();
        dailySummary += trans.__("LOC_TOMORROW")+": ";
    }

    var dailyList = worldWeatherData.daily;
    for (var i=0; i<dailyList.length-1; i++) {
        var dailyDate = (new Date(dailyList[i].dateObj)).getDate();

        if (dailyDate == currentDate.getDate()) {
            today = dailyList[i];
        }
        if (dailyDate == targetDate) {
            theDay = dailyList[i];
            break;
        }
    }

    if (theDay.skyAm && theDay.skyPm) {
        dailyArray.push(cTown._getWeatherEmoji(theDay.skyAm)+cTown._getEmoji("RightwardsArrow")+cTown._getWeatherEmoji(theDay.skyPm));
    }
    else if (theDay.skyIcon) {
        dailyArray.push(cTown._getWeatherEmoji(theDay.skyIcon));
    }

    if (theDay.hasOwnProperty('tmn') && theDay.hasOwnProperty('tmx')) {
        dailyArray.push(parseInt(theDay.tmn)+"˚/"+parseInt(theDay.tmx)+"˚");
    }

    if (theDay.pty && theDay.pty > 0) {
        if (theDay.pop) {
            if (theDay.date === today.date && current.pty <= 0) {
               //current is raining or snowing so we didn't pop
            }
            else {
                dailyArray.push(trans.__("LOC_PROBABILITY_OF_PRECIPITATION")+" "+theDay.pop+"%");
            }
        }
    }

    dailySummary += dailyArray.toString();

    var hourlyArray = [];
    var hourlySummary = "";

    if (current.skyIcon) {
        var weather = cTown._getWeatherEmoji(current.skyIcon);
        hourlyArray.push(weather);
    }

    var str;
    if (current.hasOwnProperty('t1h')) {
        str = current.t1h+"˚";
        hourlyArray.push(str);
    }

    if (current.arpltn) {
        var aqiStr = this._getAqiStr(current.arpltn, trans);
        if (aqiStr) {
            hourlyArray.push(aqiStr);
        }
    }

    if (current.pty && current.pty > 0 && current.hasOwnProperty('rn1')) {
        current.precStr = self._pty2str(current.pty, trans);
        hourlyArray.push(current.precStr+" "+ current.rn1 + pushInfo.units.precipitationUnit);
    }

    hourlySummary += hourlyArray.toString();

    pushMsg = {title: location+hourlySummary, text: dailySummary};

    return pushMsg;
};

/**
 * https://tw-wzdfac.rhcloud.com/ww/010000/current/2?gcode=35.69,139.69
 * https://tw-wzdfac.rhcloud.com/v000901/dsf/coord/35.69,139.69
 * @param geo
 * @param callback
 * @private
 */
ControllerPush.prototype._requestDsfDailySummary = function (pushInfo, callback) {
    var self = this;
    //v000902로 업데이트 하는 경우 _getWeatherEmoji 수정해야 함.
    var url = self.url+"/v000901/dsf/coord/";
    url += pushInfo.geo[1]+","+pushInfo.geo[0];

    var count = 0;
    var querys = pushInfo.units;
    for (var key in querys) {
        url += count === 0? '?':'&';
        url += key+'='+querys[key];
        count ++;
    }

    log.info('request url='+url);
    var options = {
        url : url,
        headers: {
            'Accept-Language': pushInfo.lang
        },
        json:true
    };

    req(options, function(err, response, body) {
        log.info('Finished '+ url +' '+new Date());
        if (err) {
            return callback(err);
        }

        if ( response.statusCode >= 400) {
            err = new Error("response.statusCode="+response.statusCode);
            return callback(err)
        }

        if (body.units == undefined) {
            var obj = {};
            obj.temperatureUnit = "C";
            obj.windSpeedUnit = "m/s";
            obj.pressureUnit = "hPa";
            obj.distanceUnit = "km";
            obj.precipitationUnit = "mm";
            obj.airUnit = "airkorea";
            body.units = obj;
        }

        var pushMsg = "";
        try {
           pushMsg =  self._makeDsfPushMessage(pushInfo, body);
        }
        catch(e) {
           return callback(e);
        }
        callback(undefined, pushMsg);
    });
};

/**
 * convert rest api to function call
 * use default for old push db
 * @param town
 * @param callback
 */
ControllerPush.prototype.requestDailySummary = function (pushInfo, callback) {
    var self = this;

    if (pushInfo.lang == undefined) {
        pushInfo.lang = 'ko';
    }

    if (pushInfo.units == undefined) {
        var obj = {};
        obj.temperatureUnit = "C";
        obj.windSpeedUnit = "m/s";
        obj.pressureUnit = "hPa";
        obj.distanceUnit = "km";
        obj.precipitationUnit = "mm";
        obj.airUnit = "airkorea";
        pushInfo.units = obj;
    }

    //check source
    if (pushInfo.source == undefined || pushInfo.source === 'KMA') {
        self._requestKmaDailySummary(pushInfo, function (err, results) {
            if (err) {
                return callback(err);
            }
            return callback(undefined, results);
        });
    }
    else if (pushInfo.source == 'DSF') {
       self._requestDsfDailySummary(pushInfo, function (err, results) {
           if (err)  {
               return callback(err);
           }
           return callback(undefined, results);
       });
    }

    return this;
};

/**
 * push가 오랫동안 없을때, server가 내려가는 것을 방지하기 위한 것임.
 */
ControllerPush.prototype.requestKeepMessage = function () {

    var url = "http://"+config.ipAddress+":"+config.port+"/v000705/town";
    log.info('request url='+url);
    req(url, {json:true}, function(err) {
        if (err) {
            log.info(err);
        }
        else {
            log.info('Finished '+ url +' '+new Date());
        }
    });
};

ControllerPush.prototype.convertToNotification = function(dailySummary) {
    return {title: dailySummary.title, text: dailySummary.text, icon: dailySummary.icon}
};

ControllerPush.prototype.sendNotification = function (pushInfo, callback) {
    var self = this;

    //make title, message
    log.info('send notification push info='+JSON.stringify(pushInfo));

    self.requestDailySummary(pushInfo, function (err, dailySummary) {
        if (err) {
            return callback(err);
        }

        //convert lang and units
        //convert daily summary to notification
        log.info('get daily summary ='+JSON.stringify(dailySummary));

        var notification = self.convertToNotification(dailySummary);

        if (pushInfo.type == 'ios') {
            self.sendIOSNotification(pushInfo, notification, function (err, result) {
                if (err) {
                    return callback(err);
                }
                callback(undefined, result);
            });
        }
        else if (pushInfo.type == 'android') {
            self.sendAndroidNotification(pushInfo, notification, function (err, result) {
                if (err) {
                    return callback(err);
                }
                callback(undefined, result);
            });
        }
        else {
            err = new Error('Unknown type='+pushInfo.type);
            callback(err);
        }
    });
};

ControllerPush.prototype.sendPush = function (time) {
    var self = this;

    log.info('send push tim='+time);
    async.waterfall([
        function (callback) {
            self.getPushByTime(time, function (err, pushList) {
                if (err) {
                    //self.requestKeepMessage();
                    return callback(err);
                }
                log.info('get push by time : push list='+JSON.stringify(pushList));
                callback(undefined, pushList);
            });
        }, function(pushList, callback) {
            async.mapSeries(pushList, function (pushInfo, mCallback) {
                self.sendNotification(pushInfo, function (err, result) {
                    if (err) {
                        return mCallback(err);
                    }
                    mCallback(undefined, result);
                });
            }, function (err, results) {
                if (err) {
                    return callback(err);
                }
                if (pushList.length != results.length) {
                    //some push are failed
                    return callback(new Error('Fail push='+pushList.length+' success='+results.length));
                }
                callback(undefined, 'success push count='+pushList.length);
            });
        }
    ], function(err, result) {
        if (err) {
            return log.warn(err);
        }
        log.info(result);
    });
};

ControllerPush.prototype.start = function () {
    var self = this;

    setInterval(function () {
        var date = new Date();
        var timeUTC = date.getUTCHours() * 60 * 60 + date.getUTCMinutes() * 60;
        self.sendPush.call(self, timeUTC);
    }, self.timeInterval);
};

ControllerPush.prototype.apnFeedback = function () {
    //var options = {
    //    "batchFeedback": true,
    //    "interval": 300 //seconds
    //};

    var feedback = new apn.Feedback(apnOptions);
    feedback.on("feedback", function(devices) {
        devices.forEach(function(item) {
            log.info(item);
            // Do something with item.device and item.time;
        });
    });
};

module.exports = ControllerPush;
