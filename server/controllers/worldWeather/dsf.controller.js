/**
 * Created by Peter on 2018. 5. 9..
 * Overseas weather from Visual Crossing since #2585 (Dark Sky was retired in 2023).
 * Records keep the Dark Sky format of DsfForecast; see lib/VC/vcConverter.js.
 */

"use strict";

const async = require('async');
const config = require('../../config/config');
const dsfModel = require('../../models/worldWeather/dsf.model');
const vcFetchLock = require('../../models/worldWeather/vc.fetch.lock.model');
const VcRequester = require('../../lib/VC/vcRequester');
const vcConverter = require('../../lib/VC/vcConverter');
const kmaTimeLib = require('../../lib/kmaTimeLib');


class DsfController {
    constructor(){
        this._interval = 1 * 24 * 60 * 60 * 1000; // 1 day
        // One Visual Crossing fetch per location across workers; others wait for its records.
        this.lockTtlMs = 10 * 1000;
        this.failureBackoffMs = 2 * 1000;   // expires before the gateway's next attempt (3 s timeout)
        this.waitMs = 2500;     // within the gateway Lambda's 3 s per-attempt budget
        this.pollMs = 250;
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

    /**
     * Description : To compare Date without Hour,Minutes,Second
     * @param src
     * @param dst
     * @param timeOffset
     * @returns {number|*}
     * @private
     */
    _getDiffDate2(src, dst, timeOffset) {
        let utcTime = new Date(src.getTime() + timeOffset);
        let localTime = new Date(dst.getTime() + timeOffset);
        return this._getDiffDate(utcTime, localTime);
    }

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
            if(endTime.getUTCDate() !== targetDate.getUTCDate()){
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

    /**
     * Description : Try to check whteher yesterday's data has thistime's yesterday data or not.
     * @param cDate
     * @param yData
     * @returns {*}
     * @private
     */
    _hasYesterdayData(cDate, yData, timeOffset){
        timeOffset = timeOffset * 60 * 1000;
        let yDate = new Date(cDate.getTime() + timeOffset);
        yDate.setUTCDate(yDate.getUTCDate() - 1);

        // log.info(`cDsf > YesterdayData tatget Date[${yDate.toUTCString()}]`);
        /**
         * To find if yesterday's data has Thistime's yesterday data.
         * If there is no Thistime's yesterday data, it would be ignored
         */
        let yesterdayData = yData.data.hourly.data.filter((v)=>{
            let tDate = new Date(v.dateObj.getTime() + timeOffset);
            return (yDate.getUTCFullYear() === tDate.getUTCFullYear() &&
                yDate.getUTCMonth() === tDate.getUTCMonth() &&
                yDate.getUTCDate() === tDate.getUTCDate() &&
                yDate.getUTCHours() === tDate.getUTCHours());
        });


        if(yesterdayData.length > 0){
            // log.info(`cDsf > Found yesterday data : date[${yData.dateObj.toString()}], timeOffset[${timeOffset}]`);
            return yData;
        }

        log.info(`cDsf > Fail to find yesterday for this time yDate[${yDate.toUTCString()}] cDate[${cDate.toUTCString()}]`);
        log.info('cDsf> Fail to Find yesterday ', yDate.toString(), yDate.toUTCString());
        log.info('cDsf> Data : ', JSON.stringify(yData));

        return undefined;
    }

    /**
     * Description : Try to search whether there is missed hour data from Hourly data array
     *              If there are missed hour data, the hour and date value shall be put into a new array and return it.
     * @param yData
     * @param timeOffset
     * @returns {Array}
     * @private
     */
    _checkMissedHourData(yData, timeOffset){
        if(yData === undefined){
            return [];
        }

        timeOffset = (timeOffset * 60 * 1000);

        let res = [];
        let hourlyData = yData.data.hourly.data;
        let yesterday = new Date(yData.dateObj.getTime() + timeOffset);

         //log.info(`cDsf > Org Date[${yData.dateObj.toUTCString()}]`);
         //log.info(`cDsf > target date[${yesterday.toUTCString()}]`);

        let debug = [];
        for(let i=0 ; i<24 ; i++){
            let isValid = hourlyData.filter(item =>{
                let date = new Date(item.dateObj.getTime() + timeOffset);
                debug.push({d: date.getUTCDate(), h:date.getUTCHours()});
                return (yesterday.getUTCDate() === date.getUTCDate() && i === date.getUTCHours());
            });

            if(isValid.length === 0){
                log.info(`cDsf > missed date list : ${JSON.stringify(debug)}`);
                res.push({d: yesterday.getUTCDate(), h:i});
            }
        }

        return res;
    }

    /**
     * Descryption : Try to search whether cData has missed hourly data. If so, it shall be put into yesterday's hourly data.
     * @param hours
     * @param yData
     * @param cData
     * @returns {*}
     * @private
     */
    _fulfillMissedHourData(hours, yData, cData, timeOffset){
        if(hours.length < 1 || cData === undefined){
            return yData;
        }
        if(yData === undefined){
            return undefined;
        }

        let hourlyData = cData.data.hourly.data;
        timeOffset = (timeOffset * 60 * 1000);

        let debug = []; // For debug, later on, it'll be removed if there is no problem.
        hours.forEach(d=>{
            log.info('cDsf > to be found date', JSON.stringify(d));

            let found = hourlyData.filter(item=>{
                let date = new Date(item.dateObj.getTime() + timeOffset);
                debug.push({d:date.getUTCDate(), h: date.getUTCHours()});
                return (d.d === date.getUTCDate() && d.h === date.getUTCHours());
            });

            if(found.length > 0){
                yData.data.hourly.data.push(found[0]);
                yData.data.hourly.data.sort((a,b)=>{return a.dateObj.getTime() - b.dateObj.getTime()});
            }else{
                log.info(`cDsf > Failed to find = ${JSON.stringify(debug)}`);
            }
        });


        return yData;
    }

    /**
     * Description : wrapping function. It allows Mocha test to override it.
     * @param query
     * @param sort
     * @param callback
     * @returns {Promise}
     * @private
     */
    _findDB(query, sort, callback){
        return dsfModel.find(query).lean().sort(sort).exec(callback);
    }

    /**
     *
     * @param geo
     * @param cDate
     * @param callback
     * @returns {*}
     * @private
     */
    _findDataFromDB(geo, cDate, callback){
        if(geo.length != 2){
            let err = new Error('cDsf > _findFromDB -> invalid geo :', JSON.stringify(geo));
            log.error(err);
            return callback(err, {});
        }

        let query = {
            geo: geo
        };

        // Not sure which one is better whether to query once for three data or to query three times for each time data.
        this._findDB(query, {dateObj:1}, (err, list)=>{
            if(err){
                err.message += 'cDsf > fail to get DSF data from DB';
                log.error(err);
                return callback(err, {});
            }

            if(list.length < 3){
                log.info('cDsf > There are few datas : ', list.length);
            }

            let ret = {};
            try{
                list.forEach((item)=>{
                    // Visual Crossing yesterday records hold the whole local day (#2585). An hour missing
                    // on a daylight-saving change is left to the merge step instead of forcing a refetch.
                    if(ret['yesterday'] === undefined && this._checkDate(cDate, item.dateObj, item.timeOffset, 'yesterday')){
                        if(this._fetchedAfterDayEnd(item, cDate)){
                            ret['yesterday'] = item;
                        }
                    }else if(ret['today'] === undefined && this._checkDate(cDate, item.dateObj, item.timeOffset, 'today')){
                        ret['today'] = item;
                    }else if(ret['current'] === undefined && this._checkDate(cDate, item.dateObj, item.timeOffset, 15)){
                        ret['current'] = item;
                    }
                });
            }catch(e){
                log.error(e);
                return callback(e);
            }

            log.debug('_findFromDB', JSON.stringify(ret));
            // Outside the try: an exception in the caller must not call back twice.
            return callback(null, ret);
        });
    }

    /**
     * A yesterday record holds observations only when it was fetched after that local day ended;
     * the day's last "today" refresh still has forecasts for its later hours (#2585).
     * @private
     */
    _fetchedAfterDayEnd(item, cDate){
        if(!item.pubDate){
            return false;
        }
        let todayStart = this._getSpecificDate(cDate, item.timeOffset, 'today');
        return new Date(item.pubDate).getTime() + item.timeOffset * 60 * 1000 >= todayStart.getTime();
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

    _getVcKey(){
        return config.keyString.vc_key;
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

    _lockKey(geo){
        // Numeric form: "35.680" and "35.68" address the same stored records.
        return Number(geo[0]) + ',' + Number(geo[1]);
    }

    /**
     * @param {string} key location key
     * @param {function(Error, Date=)} callback owner token (the lock's expireAt) when this worker holds the lock
     * @private
     */
    _acquireLock(key, callback){
        let now = Date.now();
        let expireAt = new Date(now + this.lockTtlMs);
        vcFetchLock.create({_id: key, expireAt: expireAt}, (err)=>{
            if(!err){
                return callback(null, expireAt);
            }
            if(err.code !== 11000){
                return callback(err);
            }
            // Take over a lock whose holder did not release it before expireAt.
            vcFetchLock.findOneAndUpdate({_id: key, expireAt: {$lt: new Date(now)}}, {$set: {expireAt: expireAt}}, {new: true}, (err, doc)=>{
                if(err){
                    return callback(err);
                }
                if(doc){
                    log.warn('cDsf > took over an expired VC fetch lock', key);
                }
                return callback(null, doc ? expireAt : undefined);
            });
        });
    }

    _releaseLock(key, token){
        // Delete only our own lock: a holder that outlived expireAt may have been taken over.
        vcFetchLock.deleteOne({_id: key, expireAt: token}, (err)=>{
            if(err){
                log.warn('cDsf > Fail to release VC fetch lock', key, err.message);
            }
        });
    }

    /**
     * After a failed fetch keep the lock only briefly: waiters cannot see the failure, and the
     * gateway retries after 3 s, which should be able to fetch again.
     * @private
     */
    _backOff(key, token){
        vcFetchLock.updateOne({_id: key, expireAt: token}, {$set: {expireAt: new Date(Date.now() + this.failureBackoffMs)}}, (err)=>{
            if(err){
                log.warn('cDsf > Fail to shorten VC fetch lock', key, err.message);
            }
        });
    }

    _hasAll(output){
        return !!(output.yesterday && output.today && output.current);
    }

    _merge(output, found){
        ['yesterday', 'today', 'current'].forEach((name)=>{
            if(found && found[name]){
                output[name] = found[name];
            }
        });
        return output;
    }

    /**
     * Another worker is fetching this location: re-read the stored records until current and today exist.
     * @private
     */
    _waitForRecords(geo, cDate, output, callback){
        let polls = Math.max(1, Math.ceil(this.waitMs / this.pollMs));
        let check = ()=>{
            this._findDataFromDB(geo, cDate, (err, found)=>{
                if(!err && found && found.current && found.today){
                    return callback(null, this._merge(output, found));
                }
                if(--polls > 0){
                    return setTimeout(check, this.pollMs);
                }
                if(output.current && output.today){
                    return callback(null, output);
                }
                return callback(new Error('cDsf > VC fetch in progress; no stored record yet'));
            });
        };
        setTimeout(check, this.pollMs);
    }

    /**
     * Fetch one Visual Crossing range, convert it to DsfForecast records and store them.
     * @param {string} range 'combined' (yesterday..+7 days, 25 records) or 'forecast' (today..+7 days, 1 record)
     * @private
     */
    _fetchVc(geo, cDate, range, output, callback){
        new VcRequester().getTimeline({lat: geo[1], lon: geo[0], range: range}, this._getVcKey(), (err, body)=>{
            if(err){
                return callback(err);
            }

            let records = {};
            try{
                let docs = vcConverter.toDarkSkyDocs(body, cDate);
                ['yesterday', 'today', 'current'].forEach((name)=>{
                    if(docs[name]){
                        records[name] = this._makeDbFormat(geo, cDate, docs.offsetMin, this._parseData(docs[name]));
                    }
                });
            }catch(e){
                log.error('cDsf > wrong VC data : ', e);
                return callback(e);
            }

            // Current last: waiting workers treat a stored current as the end of this fetch.
            async.eachSeries(['yesterday', 'today', 'current'].filter((name)=>records[name]), (name, cb)=>{
                output[name] = records[name];
                this._saveData(geo, records[name], (err)=>{
                    if(err){
                        log.warn('cDSF > Fail to save ' + name + ' Data to DB, ', err);
                    }
                    return cb();
                });
            }, ()=>callback(null));
        });
    }

    _requestDatas(geo, output, cDate, timeOffset, callback){
        if(this._hasAll(output)){
            return callback(null, output);
        }

        let key = this._lockKey(geo);
        this._acquireLock(key, (err, token)=>{
            let release = ()=>{
                if(token){
                    this._releaseLock(key, token);
                }
            };
            if(err){
                // Lock store unavailable: fetch without the lock rather than fail the request.
                log.warn('cDsf > VC fetch lock unavailable', key, err.message);
            }
            else if(!token){
                log.info('cDsf > VC fetch in progress elsewhere, waiting for', key);
                return this._waitForRecords(geo, cDate, output, callback);
            }

            // Another worker may have stored the records between the first read and the lock.
            this._findDataFromDB(geo, cDate, (findErr, found)=>{
                if(!findErr){
                    this._merge(output, found);
                }
                if(this._hasAll(output)){
                    release();
                    return callback(null, output);
                }

                let range = output.yesterday ? 'forecast' : 'combined';
                this._fetchVc(geo, cDate, range, output, (err)=>{
                    if(err){
                        // Keep the lock for failureBackoffMs: at most one provider attempt per location per backoff while failing.
                        if(token){
                            this._backOff(key, token);
                        }
                        if(output.current && output.today){
                            log.warn('cDsf > VC fetch failed, using stored records; backing off', key, err.message);
                            return callback(null, output);
                        }
                        log.warn('cDsf > VC fetch failed; backing off', key, err.message);
                        return callback(err);
                    }
                    release();
                    return callback(null, output);
                });
            });
        });
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
                    this._findDataFromDB(geo, cDate, (err, result)=>{
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
                            log.error('cDsf > something wrong to get DSF data ', err, JSON.stringify(meta));
                            return cb(err);
                        }

                        //log.info(JSON.stringify(result));
                        return cb(null, result);
                    });
                }
            ],
            (err, result)=>{
                if(err){
                    err.message += ' ' + JSON.stringify(meta);
                    return callback(err);
                }
                let ret;
                try {
                    //current date of weather data
                    req.cWeatherDate = new Date(result.current.data.current.dateObj);
                    ret = this._makeOutputFormat(result, req);
                }
                catch (e) {
                    err = e;
                }
                // TW-367 : for debugging 5xx issue. It'll be removed after fixing it.
                log.info(`cDsf > Finish to get DSF data : ${JSON.stringify(meta)}`);
                return callback(err, ret);
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
