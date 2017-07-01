/**
 * Created by aleckim on 2016. 5. 2..
 */

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

/**
 *
 * @param pushInfo
 * @param dailyInfo
 * @returns {string}
 * @private
 */
ControllerPush.prototype._makeKmaPushMessage = function (pushInfo, dailyInfo) {
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
        if (dailyInfo.townName) {
            location = dailyInfo.townName + ' ';
        }
        else if (dailyInfo.cityName) {
            location = dailyInfo.cityName + ' ';
        }
        else if (dailyInfo.regionName) {
            location = dailyInfo.regionName + ' ';
        }
    }

    var dailyArray = [];
    var dailySummary = "";
    var current = dailyInfo.dailySummary.current;

    var time = parseInt(current.time.substr(0, 2));
    var theDay;
    if (time < 18) {
        theDay = dailyInfo.dailySummary.today;
        dailySummary += trans.__("LOC_TODAY")+": ";
    }
    else {
        theDay = dailyInfo.dailySummary.tomorrow;
        dailySummary += trans.__("LOC_TOMORROW")+": ";
    }

    if (theDay.skyIconAm && theDay.skyIconPm) {
        dailyArray.push(cTown._getWeatherEmoji(theDay.skyIconAm)+cTown._getEmoji("RightwardsArrow")+cTown._getWeatherEmoji(theDay.skyIconPm));
    }
    else if (theDay.skyIcon) {
        dailyArray.push(cTown._getWeatherEmoji(theDay.skyIcon));
    }

    if (theDay.taMin != undefined && theDay.taMax != undefined) {
        theDay.taMin = unitConverter.convertUnits(dailyInfo.units.temperatureUnit, pushInfo.units.temperatureUnit, theDay.taMin);
        theDay.taMax = unitConverter.convertUnits(dailyInfo.units.temperatureUnit, pushInfo.units.temperatureUnit, theDay.taMax);
        if (pushInfo.units.temperatureUnit == "F") {
            theDay.taMin = Math.round(theDay.taMin);
            theDay.taMax = Math.round(theDay.taMax);
        }

        dailyArray.push(theDay.taMin+"˚/"+theDay.taMax+"˚");
    }
    if (theDay.pty && theDay.pty > 0) {
        if (theDay.pop && current.pty <= 0) {
            if(theDay.date == dailyInfo.dailySummary.today.date && current.pty <= 0) {
               //It's raining or snowing so we didn't show pop
            }
            else {
                dailyArray.push(trans.__("LOC_PROBABILITY_OF_PRECIPITATION")+" "+theDay.pop+"%");
            }
        }
    }

    if (theDay.pmGrade) {
        //미세먼지예보는 grade 값이 다름.
        dailyArray.push(trans.__("LOC_PM10") + " " + KecoController.grade2str(theDay.pmGrade+1, 'PM', trans));
    }
    if (theDay.ultrvGrade) {
        dailyArray.push(trans.__("LOC_UV") + " "+ LifeIndexKmaController.ultrvStr(theDay.ultrvGrade, trans));
    }
    //if (theDay.dustForecast && theDay.dustForecast.O3Grade && theDay.dustForecast.O3Grade >= 2) {
    if (theDay.dustForecast && theDay.dustForecast.O3Grade) {
        dailyArray.push(trans.__("LOC_O3") + " "+ KecoController.grade2str(theDay.dustForecast.O3Grade+1, 'O3', trans));
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
        current.t1h = unitConverter.convertUnits(dailyInfo.units.temperatureUnit, pushInfo.units.temperatureUnit, current.t1h);
        if (pushInfo.units.temperatureUnit == "F") {
            current.t1h = Math.round(current.t1h);
        }
        var str = current.t1h+"˚";
        hourlyArray.push(str);
    }

    if (current.arpltn && current.arpltn.khaiGrade) {
        hourlyArray.push(trans.__("LOC_AQI")+" "+ KecoController.grade2str(current.arpltn.khaiGrade, "khai", trans));
    }
    if (current.pty && current.pty > 0 && current.rn1 != undefined) {
        current.ptyStr = cTown._convertKmaPtyToStr(current.pty, trans);
        current.rn1 = unitConverter.convertUnits(dailyInfo.units.precipitationUnit, pushInfo.units.precipitationUnit, current.rn1);
        hourlyArray.push(current.ptyStr+" "+ current.rn1 + pushInfo.units.precipitationUnit);
    }
    hourlySummary += hourlyArray.toString();
    //불쾌지수

    pushMsg = {title: location+hourlySummary, text: dailySummary};
    return pushMsg;
};

ControllerPush.prototype._requestKmaDailySummary = function (pushInfo, callback) {
    var self = this;
    var apiVersion = "v000803";
    var url = config.push.serviceServer+"/"+apiVersion+"/daily/town";
    var town = pushInfo.town;
    if (town.first) {
        url += '/'+ encodeURIComponent(town.first);
    }
    if (town.second) {
        url += '/' + encodeURIComponent(town.second);
    }
    if (town.third) {
        url += '/' + encodeURIComponent(town.third);
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
            body.units = obj;
        }

        callback(undefined, self._makeKmaPushMessage(pushInfo, body));
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

    var currentDate = new Date(current.date);
    var time = currentDate.getHours();

    var isNight = false;
    var theDay;
    var today; //for sunrise, sunset
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
        var dailyDate = (new Date(dailyList[i].date)).getDate();

        if (dailyDate == currentDate.getDate()) {
            today = dailyList[i];
        }
        if (dailyDate == targetDate) {
            theDay = dailyList[i];
            break;
        }
    }

    if (today) {
        var sunrise = new Date(today.sunrise);
        var sunset = new Date(today.sunset);
        if (sunrise.getTime() <= currentDate.getTime() && sunset.getTime() < currentDate.getTime()) {
            isNight = false;
        }
        else {
            isNight = true;
        }
    }

    //make skyIcon
    theDay.skyIcon = self._parseWorldSkyState(theDay.precType, theDay.cloud, false);

    if (theDay.skyIconAm && theDay.skyIconPm) {
        dailyArray.push(cTown._getWeatherEmoji(theDay.skyIconAm)+cTown._getEmoji("RightwardsArrow")+cTown._getWeatherEmoji(theDay.skyIconPm));
    }
    else if (theDay.skyIcon) {
        dailyArray.push(cTown._getWeatherEmoji(theDay.skyIcon));
    }

    if (pushInfo.units.temperatureUnit == 'C') {
        theDay.taMin = theDay.tempMin_c;
        theDay.taMax = theDay.tempMax_c;
    }
    else {
        theDay.taMin = Math.round(theDay.tempMin_f);
        theDay.taMax = Math.round(theDay.tempMax_f);
    }

    if (!(theDay.taMin == undefined) && !(theDay.taMax == undefined)) {
        dailyArray.push(theDay.taMin+"˚/"+theDay.taMax+"˚");
    }

    if (theDay.precType && theDay.precType > 0) {
        if (theDay.precProb) {
            if (theDay.date == today.date && current.precType <= 0) {
               //current is raining or snowing so we didn't pop
            }
            else {
                dailyArray.push(trans.__("LOC_PROBABILITY_OF_PRECIPITATION")+" "+theDay.precProb+"%");
            }
        }
    }

    //if (theDay.pmGrade && theDay.pmGrade > 1) {
    //    if (theDay.pmStr) {
    //        dailyArray.push(trans.__("LOC_PM10") + " " + theDay.pmStr);
    //    }
    //}

    //if (theDay.ultrvGrade && theDay.ultrvGrade >= 2) {
    //    dailyArray.push(trans.__("LOC_UV")+" "+ LifeIndexKmaController.ultrvStr(theDay.ultrvGrade, trans));
    //}

    //if (theDay.dustForecast && theDay.dustForecast.O3Grade && theDay.dustForecast.O3Grade >= 2) {
    //    dailyArray.push(trans.__("LOC_O3")+" "+theDay.dustForecast.O3Str);
    //}

    //불쾌지수

    dailySummary += dailyArray.toString();

    var hourlyArray = [];
    var hourlySummary = "";

    current.skyIcon = self._parseWorldSkyState(current.precType, current.cloud, isNight);

    if (current.skyIcon) {
        var weather = cTown._getWeatherEmoji(current.skyIcon);
        hourlyArray.push(weather);
    }

    var str;
    if ( !(current.temp_c == undefined) && !(current.temp_f == undefined) ) {
        if (pushInfo.units.temperatureUnit == 'C') {
            str = current.temp_c+"˚";
        }
        else {
            str = Math.round(current.temp_f)+"˚";
        }
        hourlyArray.push(str);
    }

    //if (current.arpltn && current.arpltn.khaiGrade) {
    //    hourlyArray.push(trans.__("LOC_AQI")+" "+ current.arpltn.khaiStr);
    //}

    if (current.precType && current.precType > 0 && current.precip != undefined) {
        current.precStr = self._pty2str(current.precType, trans);
        current.precip = unitConverter.convertUnits(worldWeatherData.units.precipitationUnit, pushInfo.units.precipitationUnit, current.precip);
        hourlyArray.push(current.precStr+" "+ current.precip + pushInfo.units.precipitationUnit);
    }

    hourlySummary += hourlyArray.toString();

    pushMsg = {title: location+hourlySummary, text: dailySummary};

    return pushMsg;
};

/**
 * https://tw-wzdfac.rhcloud.com/ww/010000/current/2?gcode=35.69,139.69
 * @param geo
 * @param callback
 * @private
 */
ControllerPush.prototype._requestDsfDailySummary = function (pushInfo, callback) {
    var self = this;
    var url = config.push.serviceServer+"/ww/010000/current/2";
    url += "?gcode="+pushInfo.geo[1]+","+pushInfo.geo[0];

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
            body.units = obj;
        }

        callback(undefined, self._makeDsfPushMessage(pushInfo, body));
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
        pushInfo.units = obj;
    }

    //check source
    if (pushInfo.source == undefined || pushInfo.source == 'KMA') {
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
