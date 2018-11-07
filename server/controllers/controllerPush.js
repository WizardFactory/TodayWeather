/**
 * Created by aleckim on 2016. 5. 2..
 */

"use strict";

var admin = require("firebase-admin");
var apn = require('apn');
var gcm = require('node-gcm');
var config = require('../config/config');
var PushInfo = require('../models/modelPush');
var async = require('async');
var req = require('request');
var ControllerTown24h = require('./controllerTown24h');
var cTown = new ControllerTown24h();
var UnitConverter = require('../lib/unitConverter');
var AqiConverter = require('../lib/aqi.converter');

var kmaTimeLib = require('../lib/kmaTimeLib');

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

var twFirebaseAdmin;
var taFirebaseAdmin;

function ControllerPush() {
    this.timeInterval = 60*1000; //1min
    this.url = config.serviceServer.url;

    try {
        if (twFirebaseAdmin == undefined) {
            var twServiceAccount = require("../config/admob-app-id-6159460161-firebase-adminsdk-r2shn-9e77fbe119.json");
            twFirebaseAdmin = admin.initializeApp({
                credential: admin.credential.cert(twServiceAccount),
            }, 'todayWeather');
        }
        if (taFirebaseAdmin == undefined) {
            var taServiceAccount = require("../config/todayair-74958-firebase-adminsdk-2n8hn-68ad361049.json");
            taFirebaseAdmin = admin.initializeApp({
                credential: admin.credential.cert(taServiceAccount),
            }, 'todayAir');
        }
    }
    catch (err) {
       log.error(err);
    }
}

/**
 * disable alarm push
 * @param fcmToken
 * @param callback
 */
ControllerPush.prototype.disableByFcm = function (fcmToken, callback) {
    PushInfo.update({fcmToken: fcmToken},
        {$set : {enable: false, updatedAt: this._getCurrentTime(), updatedBy: 'push'}},
        function (err, result) {
            callback(err, result);
        });
};

ControllerPush.prototype.updateRegistrationId = function (newId, oldId, callback) {
    PushInfo.update({registrationId: oldId},
        {$set: {registrationId: newId}},
        function (err, result) {
            return callback(err, result);
        });

    return this;
};

/**
 * todo 
 * @param {string} newId 
 * @param {string} oldId 
 * @param {string} callback 
 */
ControllerPush.prototype.updateFcmToken = function (newId, oldId, callback) {
    PushInfo.update({fcmToken: oldId},
        {$set : {fcmToken: newId}},
        function (err, result) {
            callback(err, result);
        });
};

ControllerPush.prototype._getCurrentTime = function () {
   return new Date();
};

/**
 * save push info
 */
ControllerPush.prototype.updatePushInfo = function (pushInfo, callback) {
    pushInfo.updatedAt = this._getCurrentTime();
    pushInfo.updatedBy = 'user';

    if (pushInfo.hasOwnProperty('geo')) {
       if (typeof pushInfo.geo[0] !== 'number' || typeof pushInfo.geo[1] !== 'number')  {
           return callback(new Error('invalid geo info pushInfo:'+JSON.stringify(pushInfo)));
       }
    }
    else if (pushInfo.hasOwnProperty('town')) {
        if (!pushInfo.town.hasOwnProperty('first') || pushInfo.town.first.length < 1) {
            return callback(new Error('invalid town info pushInfo:'+JSON.stringify(pushInfo)));
        }
    }
    else {
        return callback(new Error('invalid info pushInfo:'+JSON.stringify(pushInfo)));
    }

    if (pushInfo.id == undefined) {
        pushInfo.id = pushInfo.cityIndex;
    }

    var query = {
        type: pushInfo.type, 
        cityIndex: pushInfo.cityIndex, 
        id: pushInfo.id
    };

    if (pushInfo.registrationId) {
        query.registrationId = pushInfo.registrationId;
    }
    else if (pushInfo.fcmToken) {
        query.fcmToken = pushInfo.fcmToken;
    }

    PushInfo.update(
        query,
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
    var query = {};

    if (pushInfo.fcmToken) {
        query.fcmToken = pushInfo.fcmToken;
    }
    else if (pushInfo.registrationId) {
        query.registrationId = pushInfo.registrationId;
    }
    else {
        return callback(new Error(`unknown fcm token or registrationId pushInfo:${JSON.stringify(pushInfo)}`));
    }

    if (pushInfo.cityIndex) {
        query.cityIndex = pushInfo.cityIndex;

        if (pushInfo.id) {
            query.id = pushInfo.id;
        }
    }

    log.info(`remove alarm push ${JSON.stringify(query)}`);

    PushInfo.remove(query,
        function (err, result) {
            if (err) {
                return callback(err);
            }
            if (!result) {
                return callback(new Error(`Fail to get alarm result query:${JSON.stringify(query)}`));
            }
            log.debug(`remove alarm result ${JSON.stringify(result)}`);
            callback(undefined, result);
        });

    return this;
};

ControllerPush.prototype.getPushByTime = function (time, callback) {

    function enable() {
        //enable이 없거나, true이면 true
        return this.enable !== false;
    }

    PushInfo.find({pushTime: time}, {__v: 0}).$where(enable).lean().exec(function (err, pushList) {
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
ControllerPush.prototype.sendGcmAndroidNotification = function (pushInfo, notification, callback) {
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

ControllerPush.prototype.sendFcmNotification = function(pushInfo, notification, callback) {
    var message = {
        notification: {
            title: notification.title,
            body: notification.text
        },
        data: {
            cityIndex: ""+pushInfo.cityIndex
        },
        token: pushInfo.fcmToken
    };

    var admin;
    if (pushInfo.package === 'todayAir') {
        admin = taFirebaseAdmin;
    }
    else {
        admin = twFirebaseAdmin;
    }

    log.info('fcm admin name:', admin.name);

    admin.messaging().send(message)
        .then(function (response) {
            log.info('Successfully sent message:', response);
            callback(null, response);
        })
        .catch(function (err) {
            callback(err);
        });
};

ControllerPush.prototype.sendAndroidNotification = function (pushInfo, notification, callback) {
    log.info('send android notification pushInfo='+JSON.stringify(pushInfo)+
                ' notification='+JSON.stringify(notification));
    if (pushInfo.registrationId) {
        this.sendGcmAndroidNotification(pushInfo, notification, callback);
    }
    else {
        var err = new Error('GCM registration id is invalid pushInfo:'+JSON.stringify(pushInfo));
        callback(err);
    }
};

/**
 * @param pushInfo
 * @param notification title, text
 * @param callback
 */
ControllerPush.prototype.sendIOSNotification = function (pushInfo, notification, callback) {
    log.info('send ios notification pushInfo='+JSON.stringify(pushInfo)+ ' notification='+JSON.stringify(notification));

    if (pushInfo.registrationId) {
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
    }
    else {
        var err = new Error('APN registration id is invalid pushInfo:'+JSON.stringify(pushInfo));
        callback(err);
    }
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

    if (priorityArray[0] === 'pm25' && arpltn.pm25Str) {
        str = trans.__("LOC_PM25")+" "+ arpltn.pm25Str;
    }
    else if (priorityArray[0] === 'pm10' && arpltn.pm10Str) {
        str = trans.__("LOC_PM10")+" "+ arpltn.pm10Str;
    }
    else if (priorityArray[0] === 'o3' && arpltn.o3Str) {
        str = trans.__("LOC_O3")+" "+ arpltn.o3Str;
    }
    else if (priorityArray[0] === 'khai' && arpltn.khaiStr) {
        str = trans.__("LOC_AQI")+" "+ arpltn.khaiStr;
    }

    return str;
};

ControllerPush.prototype._makeStrTmnTmx = function (theDay, preDay, trans) {
    var str = "";
    var diff;
    str += trans.__('LOC_LOWEST');
    str +=  parseInt(theDay.tmn)+"˚";
    if (preDay && preDay.tmn) {
        diff = Math.round(theDay.tmn - preDay.tmn);
        if (diff !== 0) {
            str +=  "(";
            if (diff > 0) {
                str += "+"+diff;
            }
            else {
                str += diff;
            }
            str += ")";
        }
    }
    str += " ";
    str += trans.__('LOC_HIGHEST');
    str +=  parseInt(theDay.tmx)+"˚";
    if (preDay && preDay.tmx) {
        diff = Math.round(theDay.tmx - preDay.tmx);
        if (diff !== 0) {
            str +=  "(";
            if (diff > 0) {
                str += "+"+diff;
            }
            else {
                str += diff;
            }
            str += ")";
        }
    }

    return str;
};

/**
 *
 * @param pushInfo
 * @param weatherInfo
 * @private
 */
ControllerPush.prototype._makePushAirMessage = function (pushInfo, weatherInfo, ts) {
    var current = weatherInfo.current || weatherInfo.thisTime[1];
    var time;

    if (weatherInfo.airInfo == undefined) {
        throw new Error('airInfo is invalid');
        return null;
    }

    if (current.dateObj) {
        time =  new Date(current.dateObj).getHours();
    }
    else if (current.time) {
        time = current.time;
    }

    var fromToday = time < 18 ? 0 : 1;
    var currentSummary;
    if (current.summaryAir) {
        currentSummary = ts.__('LOC_CURRENT')+": "+current.summaryAir;
    }

    var airUnit = weatherInfo.units.airUnit;
    var pollutants = weatherInfo.airInfo.pollutants;
    if (pollutants == undefined) {
        log.warn('daily forecast is invalid');
        return {title:'', text: currentSummary};
    }

    var dayInfo = {};

    for (var name in pollutants) {
        if (pollutants[name] && pollutants[name].daily) {
            var dayObj = pollutants[name].daily.find(function (obj) {
                return obj.fromToday === fromToday;
            });
            if (dayObj && name !== 'aqi') {
                dayInfo[name] = dayObj;
                dayInfo[name].index = AqiConverter.value2index(airUnit, name, dayObj.val);
            }
        }
    }

    var maxGrade = 0;
    var maxIndex = 0;
    var maxIndexPollutant;
    for (var name in dayInfo) {
       if (dayInfo[name].grade > maxGrade)  {
           maxGrade = dayInfo[name].grade;
       }
       if (dayInfo[name].index > maxIndex) {
          maxIndex = dayInfo[name].index;
          maxIndexPollutant = name;
       }
    }

    if (maxGrade === 0) {
        log.warn('daily forecast is invalid');
        return {title:'', text: currentSummary};
    }

    var daySummary = '';

    if (maxGrade <= 1) {
        daySummary = ts.__('LOC_AIR_QUALITY_IS_GOOD');
    }
    else if (maxGrade == 2) {
        //moderate
        if (dayInfo.pm25 && dayInfo.pm25.grade >= 2) {
            //pm2.5 평균 30 보통
            daySummary += ts.__('LOC_PM25') + ' ' + ts.__('LOC_AVERAGE') + dayInfo.pm25.val + ' ' + dayInfo.pm25.str;
        }
        if (dayInfo.pm10 && dayInfo.pm10.grade >= 2) {
            //pm10 평균 30 보통
            if (daySummary.length > 0) {
                daySummary += ', ';
            }
            daySummary += ts.__('LOC_PM10') + ' ' + ts.__('LOC_AVERAGE') + dayInfo.pm10.val + ' ' + dayInfo.pm10.str;
        }
        if (daySummary.length === 0) {
            daySummary = ts.__('LOC_AIR_QUALITY_IS_MODERATE');
        }
    }
    else {
        if (dayInfo.pm25 && dayInfo.pm25.grade >= 3) {
            daySummary += ts.__('LOC_PM25') + ' ' + ts.__('LOC_AVERAGE') + dayInfo.pm25.val + ' ' + dayInfo.pm25.str;
        }
        if (dayInfo.pm10 && dayInfo.pm10.grade >= 3) {
            if (daySummary.length > 0) {
                daySummary += ', ';
            }
            daySummary += ts.__('LOC_PM10') + ' ' + ts.__('LOC_AVERAGE') + dayInfo.pm10.val + ' ' + dayInfo.pm10.str;
        }
        if (daySummary.length === 0) {
            daySummary += ts.__(AqiConverter.name2string(maxIndexPollutant));
            daySummary += ' ' + ts.__('LOC_AVERAGE') + dayInfo[maxIndexPollutant].val;
            daySummary += ' ' + dayInfo[maxIndexPollutant].str;
        }
    }

    if (fromToday === 0) {
        daySummary = ts.__("LOC_TODAY")+": " + daySummary;
    }
    else {
        daySummary = ts.__("LOC_TOMORROW")+": " + daySummary;
    }

    var text;
    if (currentSummary) {
        text = currentSummary + '\n' + daySummary;
    }

    return {title:'', text: text};
};

ControllerPush.prototype._makeKmaPushWeatherMessage = function (pushInfo, weatherInfo, trans) {
    var dailyArray = [];
    var dailySummary = "";
    var current = weatherInfo.current;

    var time;
    var theDay;
    var today;
    var preDay;
    var fromToday = 0;
    if (current.dateObj) {
        time =  new Date(current.dateObj).getHours();
    }
    else if (current.time) {
        time = current.time;
    }

    today = weatherInfo.midData.dailyData.find(function (dayInfo) {
        if (dayInfo.fromToday === 0) {
            return dayInfo;
        }
    });

    if (time < 18) {
        fromToday = 0;
        theDay = today;
        dailySummary += trans.__("LOC_TODAY")+": ";
        preDay = weatherInfo.midData.dailyData.find(function (dayInfo) {
            if (dayInfo.fromToday === -1) {
                return dayInfo;
            }
        });
    }
    else {
        fromToday = 1;
        theDay = weatherInfo.midData.dailyData.find(function (dayInfo) {
            if (dayInfo.fromToday === 1) {
                return dayInfo;
            }
        });
        dailySummary += trans.__("LOC_TOMORROW")+": ";
        preDay = today;
    }

    var str;
    if (theDay.skyAm && theDay.skyPm) {
        var wfAm = theDay.wfAm.replace('흐리고 ', '').replace('구름적고 ', '').replace('구름많고 ', '');
        var wfPm = theDay.wfPm.replace('흐리고 ', '').replace('구름적고 ', '').replace('구름많고 ', '');
        str = "";
        str += wfAm+cTown._getWeatherEmoji(theDay.skyAm);
        str += cTown._getEmoji("RightwardsArrow");
        str += wfPm+cTown._getWeatherEmoji(theDay.skyPm);
        dailyArray.push(str);
    }
    else if (theDay.skyIcon) {
        dailyArray.push(cTown._getWeatherEmoji(theDay.skyIcon));
    }

    if (theDay.hasOwnProperty('tmn') && theDay.hasOwnProperty('tmx')) {
        str = this._makeStrTmnTmx(theDay, preDay, trans);
        dailyArray.push(str);
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
    else if (weatherInfo.airInfo && weatherInfo.airInfo.pollutants) {
        var dayAirInfo;
        var pollutants = weatherInfo.airInfo.pollutants;
        ['aqi', 'pm25', 'pm10', 'o3'].forEach(function (name) {
            if (dayAirInfo == undefined && pollutants[name] && pollutants[name].daily) {
                dayAirInfo = pollutants[name].daily.find(function(obj) {
                    return obj.fromToday === fromToday;
                });
                if (dayAirInfo) {
                    dayAirInfo.pollutant = name;
                }
            }
        });
        if (dayAirInfo) {
            if (dayAirInfo.pollutant === 'aqi')  {
                dailyArray.push(trans.__("LOC_AIR_STATUS") + " "+ dayAirInfo.str);
            }
            else if (dayAirInfo.pollutant === 'pm25')  {
                dailyArray.push(trans.__("LOC_PM25") + " "+ dayAirInfo.str);
            }
            else if (dayAirInfo.pollutant === 'pm10')  {
                dailyArray.push(trans.__("LOC_PM10") + " "+ dayAirInfo.str);
            }
            else if (dayAirInfo.pollutant === 'o3')  {
                dailyArray.push(trans.__("LOC_O3") + " "+ dayAirInfo.str);
            }
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

    hourlySummary = trans.__('LOC_CURRENT') + ': ' + hourlySummary;

    return {title: hourlySummary, text: dailySummary};
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

    if (pushInfo.package === 'todayWeather') {
        var weatherSummary = this._makeKmaPushWeatherMessage(pushInfo, weatherInfo, trans);
        pushMsg = {title: location+weatherSummary.title, text: weatherSummary.text};
    }
    else if (pushInfo.package === 'todayAir') {
        var airSummary = this._makePushAirMessage(pushInfo, weatherInfo, trans);
        pushMsg = {title: location+airSummary.title, text: airSummary.text};
    }

    return pushMsg;
};

/**
 * town은 old version of client용으로 마지막 보류임
 * @param pushInfo
 * @param callback
 * @returns {ControllerPush}
 * @private
 */
ControllerPush.prototype._requestKmaDailySummary = function (pushInfo, callback) {
    var self = this;
    var apiVersion = 'v000902';
    var url;
    var town = pushInfo.town;

    if (pushInfo.geo) {
        url = self.url+'/'+apiVersion+'/kma/coord';
        url += '/'+pushInfo.geo[1]+","+pushInfo.geo[0];
    }
    else if (pushInfo.town &&  pushInfo.town.first && pushInfo.town.first != '') {
        url = self.url+'/'+apiVersion+'/kma/addr';
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

    var options = {
        url : url,
        headers: {
            'Accept-Language': pushInfo.lang
        },
        json:true
    };

    log.info(JSON.stringify({requestOptions:options}));

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

ControllerPush.prototype._makeDsfPushWeatherMessage = function(pushInfo, worldWeatherData, trans) {
    var self = this;
    var dailyArray = [];
    var dailySummary = "";
    var current = worldWeatherData.thisTime[1];

    var currentDate = new Date(current.dateObj);
    var time = currentDate.getHours();

    var theDay;
    var today;
    var targetDate;
    var preDay;

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
            preDay = dailyList[i-1];
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
        var str = this._makeStrTmnTmx(theDay, preDay, trans);
        dailyArray.push(str);
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
    hourlySummary = trans.__('LOC_CURRENT') + ': ' + hourlySummary;

    return {title: hourlySummary, text: dailySummary};
};

ControllerPush.prototype._makeDsfPushMessage = function(pushInfo, worldWeatherData) {
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

    if (pushInfo.package === 'todayWeather') {
        var weatherSummary = this._makeDsfPushWeatherMessage(pushInfo, worldWeatherData, trans);
        pushMsg = {title: location+weatherSummary.title, text: weatherSummary.text};
    }
    else if (pushInfo.package === 'todayAir') {
        var airSummary = this._makePushAirMessage(pushInfo, worldWeatherData, trans);
        pushMsg = {title: location+airSummary.title, text: airSummary.text};
    }

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
    var url = self.url+"/v000902/dsf/coord/";
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

ControllerPush.prototype._requestGeoInfo = function (pushInfo, callback) {
    var url;
    url = config.apiServer.url + '/geocode/coord/';
    url += pushInfo.geo[1]+","+pushInfo.geo[0];

    log.info('request url:'+url);
    var options = {
        url : url,
        json:true
    };

    req(options, function(err, response, body) {
        log.info('Finished ' + url + ' ' + new Date());
        if (err) {
            return callback(err);
        }

        if (response.statusCode >= 400) {
            err = new Error("response.statusCode=" + response.statusCode);
            return callback(err)
        }
        callback(undefined, body);
    });
};

ControllerPush.prototype._geoInfo2pushInfo = function (pushInfo, geoInfo) {
    var success = false;
    try {
        if (geoInfo.kmaAddress &&
            geoInfo.kmaAddress.name1 &&
            geoInfo.kmaAddress.name1.length > 1) {
            pushInfo.town = {first: geoInfo.kmaAddress.name1};
            if (geoInfo.kmaAddress.name2) {
                pushInfo.town.second = geoInfo.kmaAddress.name2;
            }
            if (geoInfo.kmaAddress.name3) {
                pushInfo.town.third = geoInfo.kmaAddress.name3;
            }
            success = true;
        }
        if (geoInfo.location && geoInfo.location.hasOwnProperty('lat')) {
            pushInfo.geo = [geoInfo.location.long, geoInfo.location.lat];
            success = true;
        }
    }
    catch (err) {
        log.error(err);
        success = false;
    }

    return success;
};

ControllerPush.prototype._requestDailySummaryByGeo = function(pushInfo, callback) {
    var self = this;
    async.waterfall(
        [
            function (callback) {
                self._requestGeoInfo(pushInfo, callback);
            },
            function (geoInfo, callback) {
                if (geoInfo.country === 'KR') {
                    //copy geoInfo to push info
                    if (self._geoInfo2pushInfo(pushInfo, geoInfo) === false) {
                        return callback(new Error('INVALID GEOINFO '+JSON.stringify(geoInfo)));
                    }
                    self._requestKmaDailySummary(pushInfo, callback);
                }
                else {
                    self._requestDsfDailySummary(pushInfo, callback);
                }
            }
        ],
        callback);
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

    pushInfo.units = UnitConverter.initUnits(pushInfo.units);
    pushInfo.package = pushInfo.package || 'todayWeather';

    if (pushInfo.cityIndex === 0 && pushInfo.geo) {
        //source 지정방식으로 변경되면 삭제되어야 함
        log.warn('cityIndex is 0, so request daily summary by geo'+JSON.stringify(pushInfo));
        self._requestDailySummaryByGeo(pushInfo, callback);
    }
    else if (pushInfo.source == 'DSF') {
        self._requestDsfDailySummary(pushInfo, callback);
    }
    else if (pushInfo.source == 'KMA') {
        self._requestKmaDailySummary(pushInfo, callback);
    }
    else if (pushInfo.geo) {
        log.error('unknown source pushInfo:'+JSON.stringify(pushInfo));
        self._requestDailySummaryByGeo(pushInfo, callback);
    }
    else if (pushInfo.town && pushInfo.town.first && pushInfo.town.first.length > 0)
    {
        //for old client version
        self._requestKmaDailySummary(pushInfo, callback);
    }
    else {
       return callback(new Error('INVALID PUSHINFO '+JSON.stringify(pushInfo)));
    }

    return this;
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

        if (pushInfo.fcmToken) {
            self.sendFcmNotification(pushInfo, notification, function (err, result) {
                if (err) {
                    if (err.errorInfo &&
                        err.errorInfo.code === 'messaging/registration-token-not-registered') {
                        log.warn('disable this fcm token ', pushInfo.fcmToken);
                        self.disableByFcm(pushInfo.fcmToken, function(err) {
                            if (err) {
                                log.error(err)
                            }
                        });
                        return callback(null);
                    }
                    return callback(err);
                }
                callback(undefined, result);
            });
        }
        else if (pushInfo.type == 'ios') {
            self.sendIOSNotification(pushInfo, notification, callback);
        }
        else if (pushInfo.type == 'android') {
            self.sendAndroidNotification(pushInfo, notification, callback);
        }
        else {
            err = new Error('Unknown type='+pushInfo.type);
            callback(err);
        }
    });
};

/**
 * 갱신한지 60이 지난 경우 삭제, updatedAt이 없는 경우 정보추가
 * @param pushList
 * @param callback
 * @private
 */
ControllerPush.prototype._removeOldList = function (pushList, callback) {
    var self = this;
    var updatedCount=0;

    async.map(pushList,
        function (pushInfo, mCallback) {
            if (pushInfo.updatedAt) {
                var current = new Date();
                current.setDate(current.getDate()-60);
                if (pushInfo.updatedAt.getTime() < current.getTime()) {
                    updatedCount++;
                    //remove
                    log.info('remove pushInfo:'+JSON.stringify(pushInfo));
                    self.removePushInfo(pushInfo, function (err, result) {
                        if (err) {
                            log.error(err);
                        }
                        mCallback(undefined, result) ;
                    });
                }
                else {
                    mCallback(undefined, {result:'ok'});
                }
            }
            else {
                updatedCount++;
                log.info('add updatedAt pushInfo:'+JSON.stringify(pushInfo));
                //updatedAt이 없는 경우 지정해줌.
                self.updatePushInfo(pushInfo, function (err, result) {
                    if (err) {
                        log.error(err);
                    }
                    mCallback(undefined, result) ;
                });
            }
        },
        function (err) {
            if (err) {
                log.error(err);
            }
            callback(undefined, 'pushlist send length:'+pushList.length+' updated count='+updatedCount);
        });

    return this;
};

/**
 *
 * @param pushList
 * @param current server time (utc)
 * @private
 */
ControllerPush.prototype._filterByDayOfWeek = function (pushList, current) {
    return pushList.filter(function (pushInfo) {
        if (pushInfo.dayOfWeek && pushInfo.dayOfWeek.length > 0) {
            if (!pushInfo.hasOwnProperty('timezoneOffset')) {
                log.error("timezone offset is undefined pushInfo:"+JSON.stringify(pushInfo));
                return false;
            }
            //convert clientLocalTime
            var localCurrent = kmaTimeLib.toLocalTime(pushInfo.timezoneOffset, current);
            var day = localCurrent.getDay();

            var send = pushInfo.dayOfWeek[day];
            if (send === false) {
               log.info('skip day:', day, ', pushInfo:', pushInfo);
            }
            return send;
        }
        else {
            log.info('there is not dayOfWeek');
            return true;
        }
    });
};

/**
 * (fcmToken or registration id) + cityIndex + id가 중복된 경우 updatedAt이 오래된 데이터 삭제
 * db.pushes.aggregate([{$group: {_id: {registrationId: "$registrationId", cityIndex:"$cityIndex", id:"$id"}, updatedAts:{$addToSet: "$updatedAt"}, count:{$sum:1}}}, {$match:{count:{"$gt":1}}}]);
 * @param callback
 * @private
 */
ControllerPush.prototype._removeDuplicates = function(callback) {
    var query = [
        {
            $group: {
                _id: {registrationId: "$registrationId", cityIndex:"$cityIndex", id:"$id"},
                updatedAts:{"$addToSet": {updatedAt: "$updatedAt"}},
                count:{"$sum": 1}
            }
        },
        {
            $match:{count:{"$gt":1}}
        }];
    PushInfo.aggregate(query).exec(function(err, results) {
        if (err) {
            log.error(err);
            return callback(null);
        }
        results = results.filter(function (obj) {
            return obj._id.registrationId != undefined;
        });

        log.info(`pushDuplicates:${results.length}`);
        if (results.length <=0 ) {
            return callback(null);
        }
        log.info('duplicates:',JSON.stringify(results));

        async.mapSeries(results,
            function (obj, callback) {
                if (obj._id.registrationId == undefined) {
                    log.info('skip ', obj);
                    return callback(null);
                }
                var updatedAt = obj.updatedAts[0].updatedAt < obj.updatedAts[1].updatedAt ? obj.updatedAts[0].updatedAt : obj.updatedAts[1].updatedAt;
                var removeQuery = {
                    registrationId: obj._id.registrationId,
                    cityIndex: obj._id.cityIndex,
                    id: obj._id.id,
                    updatedAt: updatedAt
                };
                PushInfo.remove(removeQuery).exec(callback);
            },
            function (err, result) {
                if (err) {
                    log.error(err);
                }
                callback(null);
            });
    });
};

ControllerPush.prototype.sendPush = function (time, callback) {
    var self = this;

    log.info('send push time='+time);
    async.waterfall([
            function (callback) {
                self._removeDuplicates(callback);
            },
            function (callback) {
                self.getPushByTime(time, function (err, pushList) {
                    if (err) {
                        return callback(err);
                    }
                    log.info('get push by time : push list='+JSON.stringify(pushList));
                    callback(undefined, pushList);
                });
            },
            function (pushList, callback) {
                //filter day of week
                var filteredList;
                try {
                    var current = new Date();
                    filteredList = self._filterByDayOfWeek(pushList, current);
                }
                catch (err) {
                    log.error(err);
                    return callback(err);
                }
                callback(undefined, filteredList);
            },
            function(pushList, callback) {
                async.mapLimit(pushList, 6, function (pushInfo, mCallback) {
                    self.sendNotification(pushInfo, function (err, result) {
                        if (err) {
                            err.message += ' ' + JSON.stringify(pushInfo);
                            log.error(err);
                            //return mCallback(err);
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
                    callback(undefined, pushList);
                });
            },
            function (pushList, callback) {
                self._removeOldList(pushList, callback);
            }
        ],
        function(err, result) {
            if (err) {
                log.warn(err);
            }
            log.info(result);
            if (callback) {
                callback(err, result);
            }
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

/**
 * This is not used.
 * @param language
 * @param pushList
 * @param callback
 * @returns {*}
 */
ControllerPush.prototype.updatePushInfoList = function (language, pushList, callback) {
    var self = this;

    if (!Array.isArray(pushList)) {
        var err = new Error('Invalid push info list');
        err.statusCode = 403;
        return callback(err);
    }

    async.map(pushList,
        function (pushInfo, callback) {
            try {
                pushInfo.lang = language;
                if (pushInfo.location && pushInfo.location.hasOwnProperty('lat')) {
                    pushInfo.geo = [pushInfo.location.long, pushInfo.location.lat];
                }

                log.info('pushInfo : '+ JSON.stringify(pushInfo));
            }
            catch (err) {
                return callback (err);
            }

            self.updatePushInfo(pushInfo, function (err, result) {
                if (err) {
                    log.error(err);
                }
                callback(undefined, result);
            });
        },
        function (err, results) {
            if (err) {
                err.statusCode = 500;
                return callback(err);
            }
            callback(null, results);
        });
};

module.exports = ControllerPush;
