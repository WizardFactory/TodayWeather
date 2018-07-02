/**
 * Created by Peter on 2018. 5. 9..
 */

"use strict";

const async = require('async');
const config = require('../../config/config');
const dsfModel = require('../../models/worldWeather/dsf.model');
const dsfRequester = require('../../lib/DSF/dsfRequester');
const controllerKeys = require('./controllerKeys');
const kmaTimeLib = require('../../lib/kmaTimeLib');
const timezoneController = require('../timezone.controller');


class DsfController {
    constructor(){
        this.Keys = new controllerKeys();
        this._interval = 1 * 24 * 60 * 60 * 1000; // 1 day
    }

    _has(obj, key){
        return key.split(".").every((x)=>{
            if (typeof obj != "object" || obj === null || !x in obj)
                return false;
            if (obj.constructor === Array)
                obj = obj[0];
            obj = obj[x];
            return true;
        });
    };

    _getDiffDate(utcTime, localTime) {
        if (utcTime.getUTCFullYear() < localTime.getUTCFullYear()) {
            return 1;
        }
        else if (utcTime.getUTCFullYear() > localTime.getUTCFullYear()) {
            return -1;
        }
        else if (utcTime.getUTCFullYear() == localTime.getUTCFullYear()) {
            if (utcTime.getUTCMonth() < localTime.getUTCMonth()) {
                return 1;
            }
            else if (utcTime.getUTCMonth() > localTime.getUTCMonth()) {
                return -1;
            }
            else if (utcTime.getUTCMonth() == localTime.getUTCMonth()) {
                if (utcTime.getUTCDate() < localTime.getUTCDate()) {
                    return 1;
                }
                else if (utcTime.getUTCDate() > localTime.getUTCDate()) {
                    return -1;
                }
                else if (utcTime.getUTCDate() == localTime.getUTCDate()) {
                    return 0;
                }
            }
        }
        log.error("controllerCollector : Invalid time");
        return 0;
    };

    _getLocalLast0H(timeOffset_MIN) {
        var utcTime = new Date();
        var localTime = new Date();
        localTime.setUTCMinutes(localTime.getUTCMinutes()+timeOffset_MIN);

        var diffDate = this._getDiffDate(utcTime, localTime);
        if (diffDate == 0) {
            log.info('cDSF > _getLocalLast0H : same day');
        }
        else if (diffDate == 1) {
            log.info('cDSF > _getLocalLast0H : next day');
            utcTime.setUTCDate(utcTime.getUTCDate()+1);
        }
        else if (diffDate == -1) {
            log.info('cDSF > _getLocalLast0H : previous day');
            utcTime.setUTCDate(utcTime.getUTCDate()-1);
        }
        utcTime.setUTCHours(0);
        utcTime.setUTCMinutes(0);
        utcTime.setUTCSeconds(0);
        utcTime.setUTCMilliseconds(0);
        utcTime.setUTCMinutes(-timeOffset_MIN);

        return utcTime;
    }
    /**
     *
     * @param cDate : current DAte
     * @param timeOffset
     * @param day : specific date
     * @returns {global.Date|Date}
     * @private
     */
    _getSpecificDate(cDate, timeOffset, day){
        let timeOffset_MS = timeOffset * 60 * 1000;
        let target = new Date(cDate.getTime() + timeOffset_MS);

        if(day === 'yesterday'){
            target.setUTCDate(target.getUTCDate() - 1);
        }

        target.setUTCHours(0);
        target.setUTCMinutes(0);
        target.setUTCSeconds(0);
        target.setUTCMilliseconds(0);

        return target;
    };
    /**
     *
     * @param cDate
     * @param tDate
     * @param timeOffset
     * @param range
     * @returns {boolean}
     * @private
     */
    _checkDate(cDate, tDate, timeOffset_MIN, range){
        let timeOffset_MS = timeOffset_MIN * 60 * 1000;
        let startTime = new Date(cDate.getTime() + timeOffset_MS);
        let endTime = new Date(startTime.getTime());
        let targetDate = new Date(tDate.getTime() + timeOffset_MS);

        if(range === 'yesterday' || range === 'today'){
            startTime.setTime(this._getSpecificDate(cDate, timeOffset_MIN, range).getTime());
            endTime.setTime(startTime.getTime());
            endTime.setUTCHours(1);
        }else{
            startTime.setTime(startTime.getTime() - range * 60 * 1000);

            // return false if dates are different.
            if(endTime.getUTCDate() != targetDate.getUTCDate()){
                return false;
            }
        }

        log.debug('_checkDate S : ', startTime.toString(),'T : ', targetDate.toString(), 'E : ', endTime.toString());
        // check vaild range
        if(targetDate.getTime() >= startTime.getTime() && targetDate.getTime() <= endTime.getTime()){
            return true;
        }

        return false;
    }

    _findFromDB(geo, cDate, callback){
        if(geo.length != 2){
            log.error('cDsf > _findFromDB -> invalid geo :', JSON.stringify(geo));
            return callback('Invalid geo', {});
        }

        let query = {
            geo: geo
        };

        // Not sure which one is better whether to query once for three data or to query three times for each time data.
        dsfModel.find(query).lean().exec((err, list)=>{
            if(err){
                log.error('cDsf > fail to get DSF data from DB : ', err);
                return callback(err, {});
            }

            if(list.length < 3){
                log.info('cDsf > There are few datas : ', list.length);
            }

            let ret = {};
            list.forEach((item)=>{
                //log.info(JSON.stringify(item));
                //log.info('---> ', item.dateObj, item.timeOffset);

                /**
                 * Try to find yesterday's data which are array from yesterday 00:00 to 24:00
                 */
                if(this._checkDate(cDate, item.dateObj, item.timeOffset, 'yesterday')){
                    let yDate = new Date(cDate.getTime() + (item.timeOffset * 60 * 1000));
                    yDate.setUTCDate(yDate.getUTCDate() - 1);

                    /**
                     * To find if yesterday's data has Thistime's yesterday data.
                     * If there is no Thistime's yesterday data, it would be ignored
                     */
                    let yesterdayData = item.data.hourly.data.filter((v)=>{
                        return (yDate.getUTCFullYear() === v.dateObj.getUTCFullYear() &&
                            yDate.getUTCMonth() === v.dateObj.getUTCMonth() &&
                            yDate.getUTCDate() === v.dateObj.getUTCDate() &&
                            yDate.getUTCHours() === v.dateObj.getUTCHours());
                    });


                    if(yesterdayData.length > 0){
                        ret['yesterday'] = item;
                    }else {
                        log.info('cDsf> Finding yesterday : ', yDate.toString(), yDate.toUTCString());
                        log.info('cDsf> Data : ', JSON.stringify(item));
                    }
                }else if(this._checkDate(cDate, item.dateObj, item.timeOffset, 'today')){
                    ret['today'] = item;
                }else if(this._checkDate(cDate, item.dateObj, item.timeOffset, 15)){
                    ret['current'] = item;
                }
            });

            log.debug('_findFromDB', JSON.stringify(ret));

            return callback(null, ret);
        });
    }

    _saveData(geo, newData, callback){
        if(geo.length != 2){
            log.error('cDsf > _saveDagta -> invalid geo :', JSON.stringify(geo));
            return callback('Invalid geo');
        }

        let query = {
            geo: geo,
            dateObj: newData.dateObj
        };

        dsfModel.update(query, newData,{upsert:true}, (err)=>{
            return callback(err);
        });
    }

    _removePastData(limit, callback){
        let twoDaysAgo = new Date();
        let days = (limit === undefined)? 2:limit;
        twoDaysAgo.setDate(twoDaysAgo.getDate()- days);

        log.info('cDSF > Remove DB Data which is received more than 2 days : ', twoDaysAgo.toString());
        // remove data which was received more than two day ago.
        dsfModel.remove({dateObj: {$lt: twoDaysAgo}}).exec((err)=>{
            if(err){
                log.error('cDsf > Faile to remove :', err);
            }
            if(callback) callback(err);
        });
    }

    _getKey(){
        return this.Keys.getDsfKey();
    }

    _getFloatItem(item){
        return item? parseFloat(item):-100;
    }

    _makeDate(time){
        let date = new Date();
        date.setTime(time);
        return date;
    }

    _parseData(src){
        let result = {
            current: {},
            hourly: {
                summary:'',
                data:[]
            },
            daily: {
                summary:'',
                data:[]
            }
        };

        // get timezone
        if(src.timezone){
            result['timezone'] = src.timezone;
            log.info('cDSF >  parse timezone :', result.timezone);
        }

        // get timeoffset
        if(src.offset){
            result['timeOffset'] = parseInt(src.offset) * 60; // min
        }

        // Currently data
        if(src.currently){
            result.current.dateObj = this._makeDate(src.currently.time + '000');
            result.current.date = parseInt(kmaTimeLib.convertDatetoString(src.currently.time + '000'));
            result.current.summary = src.currently.summary;
            result.current.pre_int = this._getFloatItem(src.currently.precipIntensity);
            result.current.pre_pro = this._getFloatItem(src.currently.precipProbability);
            if(src.currently.precipType){
                result.current.pre_type = src.currently.precipType;
            }
            result.current.temp = this._getFloatItem(src.currently.temperature);
            result.current.ftemp = this._getFloatItem(src.currently.apparentTemperature);
            result.current.humid = this._getFloatItem(src.currently.humidity);
            result.current.windspd = this._getFloatItem(src.currently.windSpeed);
            result.current.winddir = this._getFloatItem(src.currently.windBearing);
            result.current.vis = this._getFloatItem(src.currently.visibility);
            result.current.cloud = this._getFloatItem(src.currently.cloudCover);
            result.current.pres = this._getFloatItem(src.currently.pressure);
            result.current.oz = this._getFloatItem(src.currently.ozone);
            result.current.icon = src.currently.icon;
        }

        // hourly data
        if(src.hourly){
            result.hourly.summary = src.hourly.summary;
            src.hourly.data.forEach((item)=>{
                let hourlyData = {};

                hourlyData.dateObj = this._makeDate(item.time + '000');
                hourlyData.date = parseInt(kmaTimeLib.convertDatetoString(item.time + '000'));
                if(item.summary){
                    hourlyData.summary = item.summary;
                }
                hourlyData.pre_int = this._getFloatItem(item.precipIntensity);
                hourlyData.pre_pro = this._getFloatItem(item.precipProbability);
                if(item.precipType){
                    hourlyData.pre_type = item.precipType;
                }
                hourlyData.temp = this._getFloatItem(item.temperature);
                hourlyData.ftemp = this._getFloatItem(item.apparentTemperature);
                hourlyData.humid = this._getFloatItem(item.humidity);
                hourlyData.windspd = this._getFloatItem(item.windSpeed);
                hourlyData.winddir = this._getFloatItem(item.windBearing);
                hourlyData.vis = this._getFloatItem(item.visibility);
                hourlyData.cloud = this._getFloatItem(item.cloudCover);
                hourlyData.pres = this._getFloatItem(item.pressure);
                hourlyData.oz = this._getFloatItem(item.ozone);
                hourlyData.icon = item.icon;

                result.hourly.data.push(hourlyData);
            });
        }

        if(src.daily){
            result.daily.summary = src.daily.summary;
            src.daily.data.forEach((item, index)=>{
                let dailyData = {};

                dailyData.dateObj = this._makeDate(item.time + '000');
                dailyData.date = parseInt(kmaTimeLib.convertDatetoString(item.time + '000'));
                dailyData.summary = item.summary;
                dailyData.sunrise = this._makeDate(item.sunriseTime + '000');
                dailyData.sunset = this._makeDate(item.sunsetTime + '000');
                dailyData.moonphase = this._getFloatItem(item.moonPhase);
                dailyData.pre_int = this._getFloatItem(item.precipIntensity);
                dailyData.pre_intmax = this._getFloatItem(item.precipIntensityMax);
                dailyData.pre_intmaxt = this._makeDate(item.precipIntensityMaxTime + '000');
                dailyData.pre_pro = this._getFloatItem(item.precipProbability);
                if(item.precipType){
                    dailyData.pre_type = item.precipType;
                }
                dailyData.temp_min = this._getFloatItem(item.temperatureMin);
                dailyData.temp_mint = this._makeDate(item.temperatureMinTime + '000');
                dailyData.temp_max = this._getFloatItem(item.temperatureMax);
                dailyData.temp_maxt = this._makeDate(item.temperatureMaxTime + '000');
                dailyData.ftemp_min = this._getFloatItem(item.apparentTemperatureMin);
                dailyData.ftemp_mint = this._makeDate(item.apparentTemperatureMinTime + '000');
                dailyData.ftemp_max = this._getFloatItem(item.apparentTemperatureMax);
                dailyData.ftemp_maxt = this._makeDate(item.apparentTemperatureMaxTime + '000');
                dailyData.humid = this._getFloatItem(item.humidity);
                dailyData.windspd = this._getFloatItem(item.windSpeed);
                dailyData.winddir = this._getFloatItem(item.windBearing);
                dailyData.vis = this._getFloatItem(item.visibility);
                dailyData.cloud = this._getFloatItem(item.cloudCover);
                dailyData.pres = this._getFloatItem(item.pressure);
                dailyData.oz = this._getFloatItem(item.ozone);
                dailyData.icon = item.icon;

                result.daily.data.push(dailyData);
            });
        }

        return result;
    }

    _makeDbFormat(geo, cDate, timeOffset, newData){
        return {
            geo: geo,
            address: {
                country: newData.timezone
            },
            pubDate: cDate,
            dateObj: newData.current.dateObj,
            timeOffset: (timeOffset!= 1440)? timeOffset:newData.timeOffset,
            data:{
                current: newData.current,
                hourly: newData.hourly,
                daily: newData.daily
            }
        }
    }


    _makeOutputFormat(input, output){
        var res = {
            type : 'DSF',
            geocode: {},
            address: {},
            date: 0,
            dateObj: new Date(0),
            timeOffset: 0,
            data: []
        };

        if(!output.hasOwnProperty('result')){
            output.result = {};
        }

        ['yesterday', 'today', 'current'].forEach((name)=>{
            let item = input[name];
            if(item){
                // update TimeOffset
                if(this._has(item, 'address.country')){
                    if(!output.result.hasOwnProperty('timezone')){
                        output.result.timezone = {};
                    }
                    output.result.timezone.timezoneId = item.address.country;
                }

                if(item.hasOwnProperty('timeOffset')){
                    if(!output.result.hasOwnProperty('timezone')){
                        output.result.timezone = {};
                    }
                    output.result.timezone.min = item.timeOffset;
                    output.result.timezone.ms = output.result.timezone.min * 60 *1000;
                }
                // update data
                //log.info(JSON.stringify(item));
                res.geocode = {lat: item.geo[1], lon: item.geo[0]};
                res.address = item.address;
                res.dateObj = item.dateObj;
                res.date = item.date || item.data.current.date;
                res.timeOffset = item.timeOffset;
                item.data.current.timeOffset = item.timeOffset;
                res.data.push(item.data);
            }
        });

        res.data.sort(function(a, b){
            if(a.current.date > b.current.date){
                return 1;
            }
            if(a.current.date < b.current.date){
                return -1;
            }
            return 0;
        });

        log.debug('_makeOutputFormat', JSON.stringify(res));
        output.DSF = res;

        return res;
    }

    _reqData(geo, date, callback){
        let dsfKey = this._getKey();
        let requester = new dsfRequester;
        let reqForm = {
            lat: geo[1],
            lon: geo[0]
        };

        requester.getForecast(reqForm, date, dsfKey.key, (err,result)=>{
            if(err){
                log.warn('cDsf > Failed to get dsf data :', geo, date);
                return callback(err);
            }

            if(result.code && result.code === 400){
                log.error('cDsf > Get Failed', geo, result.err);
                return callback(result.err);
            }

            return callback(null, result);
        });
    }

    _getTimeOffset(timezone, callback){
        let tz = new timezoneController(timezone);
        return tz.requestTimezoneOffset(undefined, 'get', callback);
    }

    _requestDatas(geo, output, cDate, timeOffset, callback){
        let curRenewal = false;
        async.waterfall([
                (cb)=>{
                    // 1. get current data
                    if(timeOffset === 1440 || output.current === undefined){
                        this._reqData(geo, undefined, (err, result)=>{
                            if(err){
                                log.error('cDsf > Failed to get current data :', geo);
                                return cb(err);
                            }

                            let curData = {};
                            try{
                                curData = this._makeDbFormat(geo, cDate, timeOffset, this._parseData(result));
                                log.debug('_requestDatas', JSON.stringify(curData));
                                if(timeOffset != 1440 && curData.timeOffset != timeOffset){
                                    // For notifying
                                    log.warn('cDSF > !!! 1. Timeoffset is different , ', curData.timeOffset, ' | ', timeOffset, 'geo:', geo);
                                }

                                output.current = curData;
                                log.info('cDSF > 1. system cur Date : ', cDate.toString());
                                log.info('cDSF > 2. data cur Date : ', curData.data.current.dateObj);
                                curRenewal = true;
                            }catch(e){
                                log.error('cDsf > wrong data : ', e, JSON.stringify(result));
                                return cb('1. FAIL TO GET DSF!');
                            }
                            return cb(null, output.current);
                        });
                    }else{
                        return cb(null, output.current);
                    }
                },
                (curData, cb)=>{
                    // 2. check timezone

                    /*
                    Try to find timeoffset from DB data even though curData has it because it can be updated by DayLightSaving
                    if(timeOffset != 1440){
                        log.info('No need to receive timezone');
                        return cb(null, curData);
                    }
                    */

                    if(curData.address.country === undefined){
                        log.warn('cDSF > There is no timezone string');
                        if(timeOffset === 1440 && curData.timeOffset === undefined){
                            return cb('2. No TIMEZONE INFO');
                        }

                        curData.timeOffset = (timeOffset != 1440)? timeOffset:curData.timeOffset;
                        return cb(null, curData);
                    }

                    this._getTimeOffset(curData.address.country, (err, timeOffset_MIN)=>{
                        if(err && curData.timeOffset === undefined){
                            log.warn('cDSF > Fail to get timeOffset : ', err);
                            timeOffset = 0;
                            return cb('3. FAIL TO GET TIMEOFFSET');
                        }

                        if(timeOffset_MIN != undefined){
                            if(curData.timeOffset != timeOffset_MIN){
                                // For notifying
                                log.warn('cDSF > !!! 2. Timeoffset is different , ', curData.timeOffset, ' | ', timeOffset_MIN, ' | ', timeOffset, 'geo:', geo);
                            }

                            timeOffset = curData.timeOffset = timeOffset_MIN;
                        }else{
                            timeOffset = curData.timeOffset || 0;
                        }
                        return cb(null, curData);
                    });
                },
                (curData, cb)=>{
                    // 3. store current data
                    if(curRenewal){
                        this._saveData(geo, curData, (err)=>{
                            if(err){
                                log.warn('cDSF > Fail to save current Data to DB, ', err);
                            }

                            return cb(null);
                        });
                    }else{
                        return cb(null);
                    }
                },
                (cb)=>{
                    if(output.yesterday === undefined){
                        // 4. try to get&save yesterday data
                        let time = this._getLocalLast0H(timeOffset);
                        time.setUTCDate(time.getUTCDate() - 1);
                        let reqTime = parseInt(time.getTime() / 1000);

                        this._reqData(geo, reqTime, (err, result)=>{
                            if(err){
                                log.error('cDSF > Fail to get Yesterday data : ', err);
                                return cb(null);
                            }
                            let yesterdayData = {};
                            try{
                                yesterdayData = this._makeDbFormat(geo, cDate, timeOffset, this._parseData(result));
                                output.yesterday = yesterdayData;
                            }catch(e){
                                log.error('cDsf > wrong yesterday data : ', e, JSON.stringify(result));
                                return cb(null);
                            }

                            this._saveData(geo, yesterdayData, (err)=>{
                                if(err){
                                    log.warn('cDSF > Fail to save yesterday Data to DB, ', err);
                                }

                                return cb(null);
                            });
                        });
                    }else{
                        return cb(null);
                    }
                },
                (cb)=>{
                    if(output.today === undefined){
                        // 5. try to get&save today data
                        let time = this._getLocalLast0H(timeOffset);
                        let reqTime = parseInt(time.getTime() / 1000);

                        this._reqData(geo, reqTime, (err, result)=>{
                            if(err){
                                log.error('cDSF > Fail to get today data : ', err);
                                return cb(null);
                            }
                            let todayData = {};
                            try{
                                todayData = this._makeDbFormat(geo, cDate, timeOffset, this._parseData(result));
                                output.today = todayData;
                            }catch(e){
                                log.error('cDsf > wrong today data : ', e, JSON.stringify(result));
                                return cb(null);
                            }

                            this._saveData(geo, todayData, (err)=>{
                                if(err){
                                    log.warn('cDSF > Fail to save today Data to DB, ', err);
                                }

                                return cb(null);
                            });
                        });
                    }else{
                        return cb(null);
                    }
                }
            ],
            (err)=>{
                return callback(err, output);
            }
        );
    }

    /**
     * @param {Object} req
     * @param {Date} cDate - system time
     * @param {Function} callback
     */
    getDsfData(req, cDate, callback){
        let meta = {
            method : 'getDsfData',
            sID : req.sessionID
        };
        let geo = [req.geocode.lon, req.geocode.lat];
        async.waterfall([
                (cb)=>{
                    // Try to get Data from DB
                    this._findFromDB(geo, cDate, (err, result)=>{
                        return cb(null, result);
                    });
                },
                (res, cb)=>{
                    // Try to get Data from Provider
                    let timeOffset = 1440;  // 24hours
                    ['yesterday', 'today', 'current'].forEach((str)=>{
                        if(res[str]){
                            timeOffset = res[str].timeOffset;
                        }
                    });

                    log.info('dsf timeoffset :', timeOffset);
                    this._requestDatas(geo, res, cDate, timeOffset, (err, result)=>{
                        if(err){
                            log.error('cDsf > something wrong to get DSF data ', err);
                            return cb(err);
                        }

                        //log.info(JSON.stringify(result));
                        return cb(null, result);
                    });
                }
            ],
            (err, result)=>{
                if(err){
                    log.error('cDSF > Fail to collect DFS data');
                }
                return callback(err, this._makeOutputFormat(result, req));
            }
        );
    }

    maintainDB(callback){
        log.info('cDSF > Start DB maintain');
        setInterval(()=>{
            this._removePastData(2, ()=>{
                //log.info('cDsf > remove past data : ', new Date().toString());
                if(callback) callback();
            });
        }, this._interval);
    }

}

module.exports = DsfController;
