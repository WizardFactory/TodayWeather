/**
 * Created by aleckim on 2018. 2. 7..
 */

"use strict";

const async = require('async');
const request = require('request');
const i18n = require('i18n');
const sprintf = require('sprintf');

const config = require('../config/config');

const AlertPush = require('../models/alert.push.model');
const kmaTimeLib = require('../lib/kmaTimeLib');
const ControllerPush = require('./controllerPush');
const AqiConverter = require('../lib/aqi.converter');
const UnitConverter = require('../lib/unitConverter');

class AlertPushController {

    constructor() {
        this.timeInterval = 60000; //1min
        this.time = undefined;
    }

    _getMinsOfCurrent() {
        return (this.time/60)%60;
    }

    _request(url, pushInfo, callback) {
        let options = {
            url : url,
            headers: {
                'Accept-Language': pushInfo.lang
            },
            timeout: 1000*10,
            json:true
        };

        request(options, function(err, response, body) {
            log.info('Finished '+ url +' '+new Date());
            if (err) {
                return callback(err);
            }

            if ( response.statusCode >= 400) {
                err = new Error("response.statusCode="+response.statusCode);
                return callback(err)
            }

            callback(undefined, body);
        });
    }

    _makeRequestUrl(pushInfo) {
        if (pushInfo.lang == undefined) {
            pushInfo.lang = 'ko';
        }

        if (pushInfo.units == undefined) {
            let obj = {};
            obj.temperatureUnit = "C";
            obj.windSpeedUnit = "m/s";
            obj.pressureUnit = "hPa";
            obj.distanceUnit = "km";
            obj.precipitationUnit = "mm";
            obj.airUnit = "airkorea";
            pushInfo.units = obj;
        }

        let apiVersion = 'v000902';
        let url = config.serviceServer.url;
        let town = pushInfo.town;
        let source = pushInfo.source.toLowerCase();

        if (pushInfo.geo) {
            url += '/'+apiVersion+'/'+source+'/coord';
            url += '/'+pushInfo.geo[1]+","+pushInfo.geo[0];
        }
        else if (pushInfo.town) {
            url += "/"+apiVersion+"/kma/addr";
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
            log.error(new Error("Fail to find geo or town info"));
        }

        let count = 0;
        let querys = pushInfo.units;
        for (let key in querys) {
            url += count === 0? '?':'&';
            url += key+'='+querys[key];
            count ++;
        }

        log.info('request url='+url);
        return url;
    }

    _getWeatherData(pushInfo, callback) {
        let url = this._makeRequestUrl(pushInfo);
        async.retry(2,
            (callback)=> {
                this._request(url, pushInfo, callback);
            },
            (err, result)=> {
                callback(err, result);
            });
    }

    /**
     * this.time이 40분 이상인 경우 예보확인
     * @param resData
     * @private
     */
    _parseWeatherAirData(alertPush, resData) {
        let current;
        let infoObj = {};

        let mins = this._getMinsOfCurrent();

        if (resData == undefined) {
            throw new Error("weather air data is undefined");
        }

        if (resData.source === 'KMA') {
            current = resData.current;
        }
        else if (resData.source === 'DSF') {
            if (resData.thisTime.length === 2) {
                current = resData.thisTime[1];
            }
        }
        else {
            throw new Error("Unknown source "+JSON.stringify({resData:resData}));
        }

        if (current == undefined) {
            throw new Error("data current is undefined "+JSON.stringify({resData:resData}));
        }

        let weather = infoObj.weather = {};

        weather.pty = current.pty || 0;
        weather.desc = current.weather;

        if (current.hasOwnProperty('ptyStationName')) {
            weather.stationName = current.ptyStationName;
        }
        else if (current.hasOwnProperty('stationName')) {
            weather.stationName = current.stationName;
        }

        if (current.hasOwnProperty('dateObj')) {
            weather.dateObj = current.dateObj;
        }

        let currentTime = new Date(weather.dateObj);
        let forecastTime = new Date(weather.dateObj);
        forecastTime.setHours(forecastTime.getHours()+1);
        let strForecastTime = kmaTimeLib.convertDateToYYYYoMMoDD_HHoZZ(forecastTime);

        log.debug({mins: mins});

        if (current.pty === 0) { //맑음
            if (mins > 40) {
               if (resData.hasOwnProperty('shortest'))  {
                   let shortest = resData.shortest.find(function (obj) {
                      return obj.dateObj === strForecastTime;
                   });
                   if (shortest) {
                       weather.forecast = shortest;
                       weather.forecast.pubDate = resData.shortestPubDate;
                   }
                   else {
                       log.warn("Fail to find shortest date="+strForecastTime);
                   }
               }
               //didn't find forecast from short
               if (!weather.hasOwnProperty('forecast')) {

                   let forecastShortTime = new Date(forecastTime);
                   forecastShortTime.setHours(forecastShortTime.getHours()+3);
                   let strForecastShortTime = kmaTimeLib.convertDateToYYYYoMMoDD_HHoZZ(forecastShortTime);

                   //for kma
                   if (resData.hasOwnProperty('short')) {
                       //short는 3시간 간격이고, 현재시간이 5시라면 9시에 6시부터 날씨 정보가 있으므로 3시간 시간에 데이터를 찾아야 함
                       let short = resData.short.find(function (obj) {
                           return obj.dateObj === strForecastShortTime;
                       });
                       if (short) {
                           weather.forecast = short;
                           weather.forecast.pubDate = resData.shortPubDate;
                       }
                       else {
                           log.warn("Fail to find short date="+strForecastTime);
                       }
                   }
                   //for dsf
                   if (resData.hasOwnProperty('hourly')) {
                       let short = resData.hourly.find(function (obj) {
                           return obj.dateObj === strForecastShortTime;
                       });

                       if (short) {
                           weather.forecast = short;
                       }
                       else {
                           log.warn("Fail to find hourly date="+strForecastTime);
                       }
                   }
               }
            }
        }

        let air = infoObj.air = {};

        if (!resData.hasOwnProperty('airInfo')) {
            log.warn("Fail to get air info date="+currentTime);
            return infoObj;
        }

        let airInfo = resData.airInfo.last;
        if (airInfo == undefined) {
            log.warn("Fail to get last air info date="+currentTime);
            return infoObj;
        }

        let airList = [{name:'pm10', grade:airInfo.pm10Grade},
            {name:'pm25', grade:airInfo.pm25Grade},
            {name:'aqi', grade:airInfo.aqiGrade}];
        airList = AqiConverter.sortByGrade(airList);
        if (airList[0].grade) {
            air.name = airList[0].name;
            air.grade = airList[0].grade;
            air.str = airInfo[air.name+'Str'];
        }
        air.dataTime = airInfo.dataTime;

        forecastTime.setMinutes(0);
        let strCurrentTime = kmaTimeLib.convertDateToYYYY_MM_DD_HHoMM(currentTime);
        let strAirForecastTime = kmaTimeLib.convertDateToYYYY_MM_DD_HHoMM(forecastTime);

        if (!air.hasOwnProperty('grade') || air.grade < alertPush.airAlertsBreakPoint ) {
           if (mins >= 40 && resData.hasOwnProperty('airInfo') &&
               resData.airInfo.hasOwnProperty('pollutants'))
           {
               let pollutants = resData.airInfo.pollutants;
               let forecastPollutants = [];
               for (let propertyName in pollutants) {
                  if (pollutants[propertyName].hasOwnProperty('hourly')) {
                      //filter past data
                      let hourly = pollutants[propertyName].hourly.filter(function (obj) {
                         return obj.date > strCurrentTime;
                      });
                      if (hourly.length === 0) {
                          continue;
                      }

                      let hourlyObj = hourly.find(function (obj) {
                          return obj.date === strAirForecastTime;
                      });
                      if (hourlyObj) {
                          hourlyObj.name = propertyName;
                          forecastPollutants.push(hourlyObj);
                      }
                      else {
                          log.warn("Fail to find "+propertyName+" forecast date="+strAirForecastTime);
                      }
                  }
               }

               forecastPollutants = AqiConverter.sortByGrade(forecastPollutants);
               if (forecastPollutants[0]) {
                   air.forecast = forecastPollutants[0];
                   air.forecast.pubDate = airInfo.forecastPubDate;
                   air.forecast.source = airInfo.forecastSource;
               }
           }
        }

        return infoObj;
    }

    /**
     * push 중에 updatedAt 이 갱신되는 경우가 있을 수 있는데, 이때는 무시한다.
     * @param alertPush
     * @param callback
     * @private
     */
    _updateDb(alertPush, callback) {
        log.info(JSON.stringify({alertPush: alertPush}));
        AlertPush.update(
            {type: alertPush.type, registrationId: alertPush.registrationId,
                cityIndex: alertPush.cityIndex, id: alertPush.id},
            alertPush,
            {upsert : true},
            function (err, result) {
                if (err) {
                    return callback(err);
                }
                return callback(undefined, result);
            });
    }

    /**
     *
     * @param alertPush
     * @param weatherInfo
     * @param send weather|air|all
     * @private
     */
    _updateAlertPush(alertPush, infoObj, send) {

        if (infoObj == undefined) {
            throw new Error("info obj is undefined on update alert push");
        }

        let time = new Date();

        if (infoObj.hasOwnProperty('weather')) {
            let weather = infoObj.weather;

            if (!alertPush.hasOwnProperty('precipAlerts')) {
                alertPush.precipAlerts = {};
            }

            if (weather.hasOwnProperty('forecast') &&
                weather.forecast.pty > 0)
            {
                alertPush.precipAlerts.lastState = weather.forecast.pty;
            }

            //forecast보다 current를 우선하기 때문에 current가 상태가 0이상이면 적용한다.
            if (weather.hasOwnProperty('pty')) {
                if (!alertPush.precipAlerts.hasOwnProperty('lastState') ||
                    alertPush.precipAlerts.lastState === 0) {
                    alertPush.precipAlerts.lastState = infoObj.weather.pty;
                }
            }
            else {
                log.warn("Fail to find pty in weather");
            }
        }
        else {
            log.error("weather is undefined on updateAlertPush");
        }

        if (infoObj.hasOwnProperty('air')) {
            let air = infoObj.air;
            if (!alertPush.hasOwnProperty('airAlerts')) {
                alertPush.airAlerts = {};
            }

            if (air.hasOwnProperty('forecast') &&
                air.forecast.grade >= alertPush.airAlertsBreakPoint)
            {
                alertPush.airAlerts.lastGrade = air.forecast.grade;
                alertPush.airAlerts.lastCode = air.forecast.name;
            }

            if (air.hasOwnProperty('grade')) {
                if (!alertPush.airAlerts.hasOwnProperty('lastGrade') ||
                    alertPush.airAlerts.lastGrade < alertPush.airAlertsBreakPoint)
                {
                    alertPush.airAlerts.lastGrade = air.grade;
                    alertPush.airAlerts.lastCode = air.name;
                }
            }
            else {
                log.warn("Fail to find grade in air");
            }
        }
        else {
            log.error("air is undefined on updateAlertPush");
        }

        if (send === 'weather' || send === 'all') {
            alertPush.precipAlerts.pushTime = time;
        }
        if (send === 'air' || send === 'all') {
            alertPush.airAlerts.pushTime = time;
        }

        log.debug(JSON.stringify({alertPush: alertPush}));
    }

    /**
     *
     * @param alertPush
     * @param infoObj
     * @returns {string} weather|air|all|none
     * @private
     */
    _compareWithLastInfo(alertPush, infoObj) {
        let limitPushTime = new Date();
        let send = 'none';

        if (alertPush.startTime === this.time ||
            alertPush.precipAlerts == undefined ||
            alertPush.precipAlerts.lastState == undefined) {
            return send;
        }

        if (infoObj == undefined) {
            throw new Error('info obj is undefined on compare with last info');
        }

        limitPushTime.setHours(limitPushTime.getHours()-6);
        if (!alertPush.precipAlerts.hasOwnProperty('pushTime') ||
            alertPush.precipAlerts.pushTime < limitPushTime) {
           //check weather
            if (infoObj.hasOwnProperty('weather')) {
                let weather = infoObj.weather;
                if (weather.pty > 0)  {
                    send = 'weather';
                }
                else if (weather.hasOwnProperty('forecast')) {
                    if (weather.forecast.pty > 0) {
                        send = 'weather';
                    }
                }
            }
        }

        if (alertPush.airAlerts) {
            if (!alertPush.airAlerts.hasOwnProperty('pushTime') ||
                alertPush.airAlerts.pushTime < limitPushTime )
            {
                if (infoObj.hasOwnProperty('air')) {
                    let air = infoObj.air;
                    if (air.grade >= alertPush.airAlertsBreakPoint) {
                        send = send === 'weather'?'all':'air';
                    }
                    else if (air.hasOwnProperty('forecast')) {
                        if (air.forecast.grade >= alertPush.airAlertsBreakPoint) {
                            send = send === 'weather'?'all':'air';
                        }
                    }
                }
            }
        }

        return send;
    }

    /**
     *
     * @param pushInfo
     * @param infoObj
     * @returns {{title: string, text: string}}
     * @private
     */
    _convertToNotification(pushInfo, infoObj) {
        let trans = {};

        if (infoObj == undefined) {
            throw new Error("info obj is undefined");
        }

        i18n.configure({
            // setup some locales - other locales default to en silently
            locales: ['en', 'ko', 'ja', 'zh-CN', 'de', 'zh-TW'],
            // where to store json files - defaults to './locales'
            directory: __dirname + '/../locales',
            register: trans
        });
        trans.setLocale(pushInfo.lang);

        //잠실본동 12:35
        //비,눈, 진눈깨비가 내리고 있습니다.
        //잠실본동 날씨예보
        //1시부터 비,눈,진눈깨비가 내릴 예정입니다.
        //잠실본동 대기정보
        //12시 미세먼지/초미세먼지/오존/이산화질소/일산화탄소/아황산가스/통합대기가 나쁨입니다. 외부활동에 주의하세요.
        //잠실본동 대기예보
        //13시부터 미세먼지/초미세먼지/오존/통합대기가 ‘보통’ 수준을 나타낼 것으로 예상됩니다. 외부활동에 주의하세요.

        let title = pushInfo.name;
        let text ="";
        let hasWeather = false;
        if (infoObj.hasOwnProperty('weather')) {
            let weather = infoObj.weather;
            if (weather.pty > 0) {
                title += " " + weather.dateObj.substr(11,5);
                if (weather.pty === 1) {
                    text = trans.__("LOC_IT_IS_RAINING");
                }
                else if (weather.pty === 2) {
                    text = trans.__("LOC_IT_IS_SLEETING");
                }
                else if (weather.pty === 3) {
                    text = trans.__("LOC_IT_IS_SNOWING");
                }
                hasWeather = true;
            }
            else if (weather.forecast && weather.forecast.pty > 0) {
                let forecast = weather.forecast;
                let forecastTime = (new Date(forecast.dateObj)).getHours();
                title += " " + trans.__("LOC_FORECAST");

                let str;
                if (forecast.pty === 1) {
                    str = trans.__("LOC_IT_WILL_BE_RAINY_FROM_H");
                }
                else if (forecast.pty === 2) {
                    str = trans.__("LOC_IT_WILL_BE_SLEETING_FROM_H");
                }
                else if (forecast.pty === 3) {
                    str = trans.__("LOC_IT_WILL_BE_SNOWY_FROM_H");
                }
                text += sprintf(str, forecastTime);
                hasWeather = true;
            }
        }
        if (infoObj.hasOwnProperty('air')) {
            let air = infoObj.air;
            if (air.grade >= pushInfo.airAlertsBreakPoint) {
                if (hasWeather) {
                    text += " "+trans.__('LOC_AIR_INFORMATION');
                }
                else {
                    title += " "+trans.__('LOC_AIR_INFORMATION');
                }

                let str = trans.__('LOC_H_POLLUTANT_IS_GRADE');
                let dataTime = (new Date(air.dataTime)).getHours();
                let name = trans.__(AqiConverter.name2string(air.name));
                if (hasWeather) {
                    text += " ";
                }
                text += sprintf(str, dataTime,  name, air.str);
            }
            else if (air.hasOwnProperty('forecast') && air.forecast.grade >= pushInfo.airAlertsBreakPoint) {
                if (hasWeather)  {
                    text += " "+trans.__('LOC_HOURLY_AQI_FORECAST');
                }
                else {
                    title += " "+trans.__('LOC_HOURLY_AQI_FORECAST');
                }

                let forecast = air.forecast;

                let str = trans.__('LOC_POLLUTANT_IS_EXPECTED_TO_BE_AT_GRADE_FROM_H');
                let dataTime = (new Date(forecast.date)).getHours();
                if (hasWeather) {
                    text += " ";
                }
                let name = trans.__(AqiConverter.name2string(forecast.name));
                text += sprintf(str, dataTime, name, forecast.str);
            }
        }

        return {title: title, text: text};
    }

    _sendNotification(pushInfo, notification, callback) {
        let ctrlPush = new ControllerPush();

        if (pushInfo.type == 'ios') {
            ctrlPush.sendIOSNotification(pushInfo, notification, function (err, result) {
                if (err) {
                    return callback(err);
                }
                callback(undefined, result);
            });
        }
        else if (pushInfo.type == 'android') {
            ctrlPush.sendAndroidNotification(pushInfo, notification, function (err, result) {
                if (err) {
                    return callback(err);
                }
                callback(undefined, result);
            });
        }
        else {
            let err = new Error('Unknown type='+pushInfo.type);
            callback(err);
        }
    }

    _sendAlertPush (alertPush, callback) {
        async.waterfall([
                (callback) => {
                    //get weather data
                    this._getWeatherData(alertPush, callback);
                },
                (weatherData, callback) => {
                    let infoObj;
                    try {
                        infoObj = this._parseWeatherAirData(alertPush, weatherData) ;
                        log.info(JSON.stringify({infoObj: infoObj}));
                    }
                    catch (err) {
                        return callback(err);
                    }
                    callback(null, infoObj);
                },
                (infoObj, callback) => {
                    let send;
                    try {
                        send = this._compareWithLastInfo(alertPush, infoObj);
                        this._updateAlertPush(alertPush, infoObj, send);
                    }
                    catch (err) {
                        return callback(err);
                    }

                    this._updateDb(alertPush, (err, result)=> {
                        if (err) {
                            log.error(err);
                        }
                        log.verbose(result);
                    });

                    log.info({send:send, registrationId: alertPush.registrationId});
                    callback(null, {send:send, data: infoObj});
                },
                (pushWithWeather, callback) => {
                    //if need to send
                    if (pushWithWeather.send === 'none') {
                        return callback();
                    }
                    let notification;
                    try {
                        notification = this._convertToNotification(alertPush, pushWithWeather.data);
                    }
                    catch(err) {
                        return callback(err);
                    }
                    this._sendNotification(alertPush, notification, callback);
                }
            ],
            (err, result) => {
                if (err) {
                    log.error(err);
                }
                log.debug(result);
                callback();
            });

        return this;
    }

    _streamAlertPush (list, callback) {
        async.mapLimit(list, 100,
            (alertPush, callback) => {
                this._sendAlertPush(alertPush, (err, result) =>{
                    if (err) {
                        log.error(err);
                    }
                    callback(null, result);
                });
            },
            (err, results) => {
                if (err) {
                    log.debug(err);
                }
                log.debug(results);
                callback();
            });
    }

    /**
     * offset 9, 7~22인경우 22~13임, 10~22인 경우 1~13이됨
     * @param time
     * @param callback
     * @returns {AlertPushController}
     * @private
     */
    _getAlertPushByTime(time, callback) {

        /**
         * 둘다 push한 시간이 6시간 이내여만 추가로 검토하지 않음.
         * 아래 function이 mongodb 내부에서 도는지 es6를 지원하지 않는 경우도 있음.
         * @returns {boolean}
         */
        function checkUpdateInterval() {
            var limitPushTime = new Date();
            limitPushTime.setHours(limitPushTime.getHours()-6);
            var needToCheck = true;
            if (this.precipAlerts) {
                   if (this.precipAlerts.pushTime >= limitPushTime) {
                       needToCheck = false;
                   }
            }

            if (this.airAlerts) {
                if (this.airAlerts.pushTime >= limitPushTime) {
                    needToCheck = false;
                }
            }

            return needToCheck;
        }

        /**
         * 기준시(time)보다 시작시간이 작아야 하고, 기준시보다 종료가 커야 함.
         * |--------|-----------|-------------|-------|
         * 0시  startTime     {time}       endtime   24시
         * @type {{reverseTime: boolean, startTime: {$lte: *}, endTime: {$gte: *}}}
         */
        let queryN = {enable: true, reverseTime: false, startTime: {$lte:time}, endTime: {$gte:time}};
        let queryR = {enable: true, reverseTime: true, $or: [{startTime: {$lte:time}}, {endTime: {$gte:time}}]};
        let queryList = [];
        queryList.push(queryN);
        queryList.push(queryR);
        let query = {$or: queryList};
        AlertPush.find(query).$where(checkUpdateInterval).lean().exec( (err, list) => {
            if (err) {
                return callback(err);
            }
            callback(undefined, list);
        });
    }

    sendAlertPushList(time, callback) {
        log.info('try to send alert push list time:'+time);
        this.time = time;

        async.waterfall([
                (callback) => {
                    this._getAlertPushByTime(time, (err, list) => {
                        if (err) {
                            log.error(err);
                        }
                        else if (list.length === 0) {
                            err = new Error('No push info time='+time);
                            log.info(err.message);
                        }
                        callback(err, list);
                    });
                },
                (list, callback) => {
                    this._streamAlertPush(list, function (err, result) {
                        if (err) {
                            log.error(err);
                        }
                       callback(err, result);
                    })
                }
            ],
            (err, result) => {
               if (err)  {
                   log.debug(err);
               }
               else {
                   log.debug(result);
               }
               if (callback) {
                   callback();
               }
            });
    }

    _removeOldList() {
        let current = new Date();
        current.setDate(current.getDate()-180);

        AlertPush.remove({"updateAt": {$lt:current} }, function (err) {
            if (err) {
                log.error(err);
            }
            log.info('removed alert push from date : ' + current.toString());
        });
    }

    start() {
        setInterval( () => {
            let date = new Date();
            let min = date.getUTCMinutes();
            if (min === 0 || min === 15 || min === 30 || min === 45) {
                let timeUTC = date.getUTCHours() * 3600 + date.getUTCMinutes() * 60;
                this.sendAlertPushList(timeUTC);
                this._removeOldList();
            }
        }, this.timeInterval );
    }

    //update from client
    updateAlertPush(alertPush, callback) {
        alertPush.updatedAt = new Date();
        alertPush.reverseTime = alertPush.startTime > alertPush.endTime;
        AlertPush.find({
            type: alertPush.type, registrationId: alertPush.registrationId,
            cityIndex: alertPush.cityIndex, id: alertPush.id})
            .exec((err, list) => {
                if (err) {
                    return callback(err);
                }
                if (list.length === 0) {
                    (new AlertPush(alertPush)).save(callback);
                }
                else {
                    if (list.length > 1) {
                        log.error('alert push was duplicated list:'+JSON.stringify(list));
                    }

                    let dbAlertPush = list[0];
                    for (let key in alertPush) {
                        dbAlertPush[key] = alertPush[key];
                    }
                    dbAlertPush.save(callback);
                }
            });
    }

    removeAlertPush(pushInfo, callback) {
        AlertPush.remove({
                type:pushInfo.type,
                registrationId: pushInfo.registrationId,
                cityIndex: pushInfo.cityIndex,
                id: pushInfo.id},
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
    }
}

module.exports = AlertPushController;

