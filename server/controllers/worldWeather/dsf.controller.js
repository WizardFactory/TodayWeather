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
const vcUsage = require('../../models/worldWeather/vc.usage.model');
const VcRequester = require('../../lib/VC/vcRequester');
const vcConverter = require('../../lib/VC/vcConverter');
const kmaTimeLib = require('../../lib/kmaTimeLib');

// Lock-collection document that marks the provider unavailable (daily limit, rejected key, budget).
const PROVIDER_KEY = '~provider';
// Lock-collection documents, per location, after a billed `combined` call returned no local yesterday.
const NO_YESTERDAY_PREFIX = '~noyesterday:';

if(!VcRequester.isValidKey(config.keyString && config.keyString.vc_key) && typeof log !== 'undefined'){
    log.error('cDsf > VC_SECRET_KEY is not configured; overseas weather requests will fail');
}

const zoneFormats = {};
/**
 * UTC offset in minutes of an IANA zone at `ms` (Intl; verified on the Node 10.15.3 service runtime).
 */
function zoneOffsetMinutes(zone, ms){
    let fmt = zoneFormats[zone];
    if(!fmt){
        fmt = zoneFormats[zone] = new Intl.DateTimeFormat('en-US', {timeZone: zone, hour12: false, year: 'numeric',
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'});
    }
    let p = {};
    fmt.formatToParts(new Date(ms)).forEach((x)=>{ p[x.type] = x.value; });
    let local = Date.UTC(+p.year, +p.month - 1, +p.day, p.hour === '24' ? 0 : +p.hour, +p.minute, +p.second);
    return Math.round((local - Math.floor(ms / 1000) * 1000) / 60000);
}

class DsfController {
    constructor(){
        this._interval = 1 * 24 * 60 * 60 * 1000; // 1 day
        // One Visual Crossing fetch per location across workers; others wait for its records.
        this.lockTtlMs = 10 * 1000;
        this.failureBackoffMs = 2 * 1000;
        this.badResponseBackoffMs = 15 * 60 * 1000;  // a billed (HTTP 200) body that cannot be used
        this.waitMs = 2500;         // within the gateway Lambda's 3 s per-attempt budget
        this.pollMs = 250;
        this.responseMs = 2500;     // answer the request within the gateway's attempt ...
        this.fetchTimeoutMs = 8000; // ... while the holder keeps fetching (under lockTtlMs) and stores the result
        this.staleMs = 3 * 60 * 60 * 1000;          // on provider failure serve a current record up to 3 h old
        this.providerDownMs = 10 * 60 * 1000;       // skip calls after a daily-limit 429 or a rejected key
        this.readWindowMs = 3 * 24 * 60 * 60 * 1000;
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

        // Records older than the read window cannot be yesterday, today, current or stale.
        let query = {
            geo: geo,
            dateObj: {$gte: new Date(cDate.getTime() - this.readWindowMs)}
        };

        this._findDB(query, {dateObj:1}, (err, list)=>{
            if(err){
                err.message += 'cDsf > fail to get DSF data from DB';
                log.error(err);
                return callback(err, {});
            }

            let ret = {};
            // Days are compared as local dates: a record's own day uses the offset it was stored
            // with, "today" uses the offset in effect now. Across a daylight-saving change the
            // stored midnights are an hour off the new offset's day boundaries (#2585).
            let today, yesterday, nowOffset;
            try{
                nowOffset = this._offsetAt(list[list.length - 1], cDate);
                today = this._localDay(cDate, nowOffset);
                yesterday = this._previousDay(today);
            }catch(e){
                list = [];   // no records, or the newest is malformed: fetch
            }
            list.forEach((item)=>{
                try{
                    let recordDay = this._localDay(item.dateObj, item.timeOffset);
                    let midnight = this._isLocalMidnight(item);
                    let age = cDate.getTime() - new Date(item.dateObj).getTime();
                    // After a daylight-saving fall-back, two midnight records share a local day (old and
                    // new offset): the most recently fetched one wins.
                    if(midnight && recordDay === yesterday){
                        // Visual Crossing yesterday records hold the whole local day. An hour missing on a
                        // daylight-saving change is left to the merge step instead of forcing a refetch.
                        if(this._fetchedAfterDayEnd(item, today, nowOffset) && this._newer(item, ret['yesterday'])){
                            ret['yesterday'] = item;
                        }
                    }else if(midnight && recordDay === today){
                        if(this._newer(item, ret['today'])){
                            ret['today'] = item;
                        }
                    }else if(age >= 0 && age <= 15 * 60 * 1000 && this._localDay(item.dateObj, nowOffset) === today){
                        ret['current'] = item;  // sorted by dateObj: the newest wins
                    }else if(age >= 0 && age <= this.staleMs){
                        ret['stale'] = item;    // sorted by dateObj: the newest wins
                    }
                }catch(e){
                    log.warn('cDsf > skip malformed record', e.message);
                }
            });

            log.debug('_findFromDB', JSON.stringify(ret));
            return callback(null, ret);
        });
    }

    /**
     * UTC offset (minutes) at cDate for the newest stored record. Visual Crossing's offset at fetch
     * time is authoritative; the runtime's zone data (Intl, from the IANA zone in address.country)
     * only moves it across a later daylight-saving change, and only when it reproduces the stored
     * offset. The service's Node 10.15.3 has 2018 zone data: stale or unknown zones use the stored
     * offset (#2585).
     * @private
     */
    _offsetAt(item, cDate){
        let zone = item.address && item.address.country;
        if(typeof item.timeOffset !== 'number'){
            throw new Error('invalid record offset');
        }
        if(zone){
            try{
                if(zoneOffsetMinutes(zone, new Date(item.dateObj).getTime()) === item.timeOffset){
                    return zoneOffsetMinutes(zone, cDate.getTime());
                }
            }catch(e){
                // Unknown zone name: use the stored offset.
            }
        }
        return item.timeOffset;
    }

    _newer(item, than){
        return !than || new Date(item.pubDate).getTime() >= new Date(than.pubDate).getTime() || !isFinite(new Date(than.pubDate).getTime());
    }

    // Local calendar date ("YYYY-MM-DD") of a time at a UTC offset in minutes.
    _localDay(date, offsetMin){
        let ms = new Date(date).getTime();
        if(!isFinite(ms) || typeof offsetMin !== 'number'){
            throw new Error('invalid record time');
        }
        return new Date(ms + offsetMin * 60 * 1000).toISOString().slice(0, 10);
    }

    _previousDay(day){
        return new Date(Date.parse(day + 'T00:00:00Z') - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }

    // Yesterday/today records are stored at local midnight (their own offset); current records at fetch time.
    _isLocalMidnight(item){
        let local = new Date(new Date(item.dateObj).getTime() + item.timeOffset * 60 * 1000);
        return local.getUTCHours() === 0 && local.getUTCMinutes() === 0 && local.getUTCSeconds() === 0;
    }

    /**
     * A yesterday record holds observations only when it was fetched after that local day ended;
     * the day's last "today" refresh still has forecasts for its later hours (#2585).
     * @private
     */
    _fetchedAfterDayEnd(item, today, nowOffset){
        if(!item.pubDate){
            return false;
        }
        let todayStart = Date.parse(today + 'T00:00:00Z') - nowOffset * 60 * 1000;
        return new Date(item.pubDate).getTime() >= todayStart;
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

    // null for a missing time (polar day, no hourly rows): no Invalid Date and no Mongo default.
    _makeDateOrNull(time){
        return (time === undefined || time === null) ? null : this._makeDate(time + '000');
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
                dailyData.sunrise = this._makeDateOrNull(item.sunriseTime);
                dailyData.sunset = this._makeDateOrNull(item.sunsetTime);
                dailyData.moonphase = this._getFloatItem(item.moonPhase);
                dailyData.pre_int = this._getFloatItem(item.precipIntensity);
                dailyData.pre_intmax = this._getFloatItem(item.precipIntensityMax);
                dailyData.pre_intmaxt = this._makeDateOrNull(item.precipIntensityMaxTime);
                dailyData.pre_pro = this._getFloatItem(item.precipProbability);
                if(item.precipType){
                    dailyData.pre_type = item.precipType;
                }
                dailyData.temp_min = this._getFloatItem(item.temperatureMin);
                dailyData.temp_mint = this._makeDateOrNull(item.temperatureMinTime);
                dailyData.temp_max = this._getFloatItem(item.temperatureMax);
                dailyData.temp_maxt = this._makeDateOrNull(item.temperatureMaxTime);
                dailyData.ftemp_min = this._getFloatItem(item.apparentTemperatureMin);
                dailyData.ftemp_mint = this._makeDateOrNull(item.apparentTemperatureMinTime);
                dailyData.ftemp_max = this._getFloatItem(item.apparentTemperatureMax);
                dailyData.ftemp_maxt = this._makeDateOrNull(item.apparentTemperatureMaxTime);
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

    // Location in log lines, rounded to 2 decimals (about 1 km): less location data in logs.
    _logKey(key){
        return String(key).split(',').map((v)=>Number(v).toFixed(2)).join(',');
    }

    // Request time for re-reads: records stored by another worker carry that worker's (later) time.
    _now(cDate){
        return new Date(Math.max(cDate.getTime(), Date.now()));
    }

    /**
     * @param {string} key location key
     * @param {function(Error, Date=)} callback owner token (the lock's expireAt) when this worker holds the lock
     * @private
     */
    _acquireLock(key, callback, retried){
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
            vcFetchLock.findOneAndUpdate({_id: key, expireAt: {$lt: new Date(now)}}, {$set: {expireAt: expireAt, failed: false}}, {new: true}, (err, doc)=>{
                if(err){
                    return callback(err);
                }
                if(doc){
                    log.warn('cDsf > took over an expired VC fetch lock', this._logKey(key));
                    return callback(null, expireAt);
                }
                if(!retried){
                    // The lock may have been released or removed by the TTL monitor since create().
                    return vcFetchLock.findById(key, (err, lock)=>{
                        return (!err && !lock) ? this._acquireLock(key, callback, true) : callback(null, undefined);
                    });
                }
                return callback(null, undefined);
            });
        });
    }

    _releaseLock(key, token){
        // Delete only our own lock: a holder that outlived expireAt may have been taken over.
        vcFetchLock.deleteOne({_id: key, expireAt: token}, (err)=>{
            if(err){
                log.warn('cDsf > Fail to release VC fetch lock', this._logKey(key), err.message);
            }
        });
    }

    /**
     * After a failed fetch keep the lock briefly and flag it: waiters stop waiting at once, and at
     * most one provider attempt per location runs per failureBackoffMs.
     * @private
     */
    _backOff(key, token, ms){
        vcFetchLock.updateOne({_id: key, expireAt: token}, {$set: {expireAt: new Date(Date.now() + ms), failed: true}}, (err)=>{
            if(err){
                log.warn('cDsf > Fail to shorten VC fetch lock', this._logKey(key), err.message);
            }
        });
    }

    _usageDay(){
        return new Date().toISOString().slice(0, 10);
    }

    /**
     * Provider calls are skipped while the provider is marked down or the daily record budget
     * (config.vc.dailyRecordLimit, 0 = none) would be exceeded.
     * @param {string} range 'combined' (25 records) or 'forecast' (1 record)
     * @param {function(Error=)} callback error when no call should be made
     * @private
     */
    _checkProvider(range, callback){
        vcFetchLock.findById(PROVIDER_KEY, (err, marker)=>{
            if(!err && marker && new Date(marker.expireAt).getTime() > Date.now()){
                return callback(new Error('cDsf > Visual Crossing marked unavailable until ' + new Date(marker.expireAt).toISOString()));
            }
            let limit = config.vc && config.vc.dailyRecordLimit;
            if(!limit){
                return callback();
            }
            vcUsage.findById(this._usageDay(), (err, usage)=>{
                let cost = range === 'combined' ? 25 : 1;
                if(!err && usage && usage.records + cost > limit){
                    return callback(new Error('cDsf > daily Visual Crossing record budget reached (' + usage.records + '/' + limit + ')'));
                }
                return callback();
            });
        });
    }

    _markProviderDown(err){
        let expireAt = new Date(Date.now() + this.providerDownMs);
        log.error('cDsf > Visual Crossing marked unavailable until ' + expireAt.toISOString() + ': ' + err.message);
        vcFetchLock.updateOne({_id: PROVIDER_KEY}, {$set: {expireAt: expireAt, failed: true}}, {upsert: true}, (err)=>{
            if(err){
                log.warn('cDsf > Fail to mark Visual Crossing unavailable', err.message);
            }
        });
    }

    /**
     * Daily usage counters (vc.usage), for cost control: production logs show only errors.
     * @private
     */
    _recordUsage(meta, err, retried){
        if(!meta){
            return;     // no network request (for example a missing key)
        }
        // Every 429 seen, including one the requester retried successfully.
        let inc = {calls: 1, records: meta.cost || 0, failures: err ? 1 : 0, http429: meta.http429 || 0,
            slow: meta.ms > this.responseMs ? 1 : 0};
        vcUsage.updateOne({_id: this._usageDay()}, {$inc: inc}, {upsert: true}, (upsertErr)=>{
            if(upsertErr && upsertErr.code === 11000 && !retried){
                // Two workers created the day's document at once; the loser's retry updates it.
                return this._recordUsage(meta, err, true);
            }
            if(upsertErr){
                log.warn('cDsf > Fail to record Visual Crossing usage', upsertErr.message);
            }
        });
    }

    _hasAll(output, noYesterday){
        return !!((output.yesterday || noYesterday) && output.today && output.current);
    }

    /**
     * Whether a billed `combined` call for this location already returned no local yesterday today:
     * then the location is served without yesterday and refreshed with `forecast` (#2585).
     * @private
     */
    _noYesterday(key, output, callback){
        if(output.yesterday){
            return callback(false);
        }
        vcFetchLock.findById(NO_YESTERDAY_PREFIX + key, (err, marker)=>{
            return callback(!err && !!marker && new Date(marker.expireAt).getTime() > Date.now());
        });
    }

    _markNoYesterday(key, records){
        // Until the next local midnight (today's record is stored at local midnight).
        let expireAt = new Date(records.today ? new Date(records.today.dateObj).getTime() + 24 * 60 * 60 * 1000
            : Date.now() + this.badResponseBackoffMs);
        log.error('cDsf > VC combined response without the local yesterday; serving without it until ' + expireAt.toISOString(), this._logKey(key));
        vcFetchLock.updateOne({_id: NO_YESTERDAY_PREFIX + key}, {$set: {expireAt: expireAt, failed: false}}, {upsert: true}, (err)=>{
            if(err){
                log.warn('cDsf > Fail to store the no-yesterday marker', this._logKey(key), err.message);
            }
        });
    }

    _merge(output, found){
        ['yesterday', 'today', 'current', 'stale'].forEach((name)=>{
            if(found && found[name]){
                output[name] = found[name];
            }
        });
        return output;
    }

    /**
     * No fresh data can be fetched: serve the stored records when a current record exists
     * (fresh, or up to staleMs old), else fail with `err`.
     * @private
     */
    _fallback(output, err, callback){
        if(!output.current && output.stale){
            output.current = output.stale;
        }
        if(output.current){
            log.error('cDsf > serving stored overseas records from ' + new Date(output.current.dateObj).toISOString() + ': ' + err.message);
            return callback(null, output);
        }
        return callback(err);
    }

    /**
     * Another worker is fetching this location: re-read the stored records until current and today
     * exist, and stop early when the holder flags the fetch as failed.
     * @private
     */
    _waitForRecords(geo, cDate, output, key, callback){
        // Until waitMs after the request began; the poll count bounds it as well.
        let deadline = cDate.getTime() + this.waitMs;
        let polls = Math.max(1, Math.ceil(this.waitMs / this.pollMs));
        let check = ()=>{
            this._findDataFromDB(geo, this._now(cDate), (err, found)=>{
                if(!err && found && found.current && found.today){
                    return callback(null, this._merge(output, found));
                }
                vcFetchLock.findById(key, (lockErr, lock)=>{
                    let failed = !lockErr && lock && lock.failed;
                    if(!failed && --polls > 0 && Date.now() + this.pollMs <= deadline){
                        return setTimeout(check, this.pollMs);
                    }
                    this._merge(output, found);
                    return this._fallback(output, new Error(failed ? 'cDsf > VC fetch failed in another worker'
                        : 'cDsf > VC fetch in progress; no stored record yet'), callback);
                });
            });
        };
        setTimeout(check, this.pollMs);
    }

    /**
     * Fetch one Visual Crossing range, convert it to DsfForecast records and store them.
     * @param {string} range 'combined' (yesterday..+7 days, 25 records) or 'forecast' (today..+7 days, 1 record)
     * @param {Object} target receives the stored records
     * @param {function(Error, Object=)} callback error and the requester's {status, cost, ms}
     * @private
     */
    _fetchVc(geo, cDate, range, target, callback){
        new VcRequester({timeoutMs: this.fetchTimeoutMs}).getTimeline({lat: geo[1], lon: geo[0], range: range}, this._getVcKey(), (err, body, meta)=>{
            if(err){
                return callback(err, meta);
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
                return callback(e, meta);
            }

            // Current last: waiting workers treat a stored current as the end of this fetch.
            async.eachSeries(['yesterday', 'today', 'current'].filter((name)=>records[name]), (name, cb)=>{
                target[name] = records[name];
                this._saveData(geo, records[name], (err)=>{
                    if(err){
                        log.warn('cDSF > Fail to save ' + name + ' Data to DB, ', err);
                    }
                    return cb();
                });
            }, ()=>callback(null, meta));
        });
    }

    _requestDatas(geo, output, cDate, callback){
        if(this._hasAll(output)){
            return callback(null, output);
        }

        let key = this._lockKey(geo);
        this._noYesterday(key, output, (noYesterday)=>{
        if(this._hasAll(output, noYesterday)){
            return callback(null, output);
        }
        let range = (output.yesterday || noYesterday) ? 'forecast' : 'combined';
        this._checkProvider(range, (unavailable)=>{
            if(unavailable){
                return this._fallback(output, unavailable, callback);
            }
            this._acquireLock(key, (err, token)=>{
                if(err){
                    // Lock store unavailable: fetch without the lock rather than fail the request.
                    log.warn('cDsf > VC fetch lock unavailable', this._logKey(key), err.message);
                }
                else if(!token){
                    log.info('cDsf > VC fetch in progress elsewhere, waiting for', this._logKey(key));
                    return this._waitForRecords(geo, cDate, output, key, callback);
                }

                // Another worker may have stored the records between the first read and the lock.
                this._findDataFromDB(geo, this._now(cDate), (findErr, found)=>{
                    if(!findErr){
                        this._merge(output, found);
                    }
                    if(this._hasAll(output, noYesterday)){
                        if(token){
                            this._releaseLock(key, token);
                        }
                        return callback(null, output);
                    }

                    // Answer within responseMs; the fetch itself may run to fetchTimeoutMs and still store
                    // its records for the gateway's next attempt.
                    let responded = false;
                    let respond = (err)=>{
                        if(responded){
                            return;
                        }
                        responded = true;
                        clearTimeout(timer);
                        return err ? this._fallback(output, err, callback) : callback(null, output);
                    };
                    // Measured from the request time: the reads before this point count as well.
                    let timer = setTimeout(()=>{
                        log.error('cDsf > VC fetch slower than the ' + this.responseMs + 'ms response budget; answering without it', this._logKey(key));
                        respond(new Error('cDsf > VC fetch still running'));
                    }, Math.max(0, cDate.getTime() + this.responseMs - Date.now()));

                    let records = {};
                    this._fetchVc(geo, cDate, range, records, (err, meta)=>{
                        this._recordUsage(meta, err);
                        if(err){
                            if(token){
                                // A billed body that cannot be used would fail the same way again.
                                this._backOff(key, token, meta && meta.status === 200 ? this.badResponseBackoffMs : this.failureBackoffMs);
                            }
                            if(err.providerDown){
                                this._markProviderDown(err);
                            }
                            log.error('cDsf > VC fetch failed; backing off', this._logKey(key), err.message);
                            return respond(err);
                        }
                        if(range === 'combined' && !records.yesterday){
                            this._markNoYesterday(key, records);
                        }
                        if(token){
                            this._releaseLock(key, token);
                        }
                        if(!responded){
                            this._merge(output, records);
                        }
                        return respond();
                    });
                });
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
                        return cb(null, result || {});
                    });
                },
                (res, cb)=>{
                    // Try to get Data from Provider
                    this._requestDatas(geo, res, cDate, (err, result)=>{
                        if(err){
                            log.error('cDsf > something wrong to get DSF data ', err, JSON.stringify(meta));
                            return cb(err);
                        }
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
