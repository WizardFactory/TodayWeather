/**
 * Created by Peter on 2018. 2. 10..
 */
"use strict";

const request = require('request');
const async = require('async');
const config = require('../config/config');
const modelTimezone = require('../models/timezone.model');

class TimezoneController{
    constructor(timezone){
        this._timezone = timezone;
        this._googleKey = config.keyString.google_key;
        this._interval = 15 * 24 * 60 * 60 * 1000; // 15 days
    }

    get geo() {return this._geo;}
    set geo(geo) {this._geo = geo;}
    get timezone() {return this._timezone;}
    set timezone(timezone) {this._timezone = timezone;}
    get timezoneOffset() {return this._timezoneOffset;}
    set timezoneOffset(timezoneOffset) {this._timezoneOffset = timezoneOffset;}
    get updatedAt() {return this._updatedAt;}
    set updatedAt(updatedAt) {this._updatedAt = updatedAt;}

    /**
     *
     * @param callback
     */
    maintain(callback){
        setInterval(()=>{
            this._updateTimezoneDB(()=>{
                log.info('TZ > update Timezone List : ', new Date().toString());
                if(callback) callback();
            });
        }, this._interval);
    }

    /**
     * Description : request Timezone Offset by using Geocode
     * Caution : In this case, it's possible to change geocode of DB's data, but it doesn't impact to
     * @param geo
     * @param callback
     * @returns {TimezoneController}
     */
    requestTimezoneOffsetByGeo(geo, timezone, callback){
        async.waterfall([
            (cb)=>{
                this._getTimozoneOffsetByGeo(geo, (err, tzOffset)=>{
                    if(err){
                            return cb('Fail');
                    }
                    return cb(null, tzOffset);
                });
            },
            (timezoneOffset,cb)=>{
                this._updateTimezone({timezone, geo, timezoneOffset}, (err)=>{
                    if(err){
                        err.message += '' + JSON.stringify({timezone, geo, timezoneOffset});
                        log.error('TZ > requestTimezoneOffsetByGeo > Fail to Save', err);
                    }
                });

                // to reduce response time
                return cb(null, timezoneOffset);
            }
            ],
            (err, tzOffset)=>{
                if(tzOffset === undefined){
                    log.warn('TZ> Fail to get Timezoneoffset by geocode : ', err);
                }
                return callback(err, tzOffset);
            }
        );
    }

    /**
     *
     * @param timezone
     * @param callback
     * @returns {TimezoneController}
     */
    requestTimezoneOffset(timezone, opts, callback){
        if(timezone){
            this.timezone = timezone;
        }

        async.waterfall([
                (cb)=>{
                    // 1. find timeoffset from DB
                    if(this.timezone === undefined){
                        return cb('1. NO_TIMEZONE');
                    }

                    if(opts === 'updateDB'){
                        return cb(null, this.timezone);
                    }

                    this._getTimezoneOffsetFromDB(this.timezone, (err, timezoneOffset)=>{
                        if(err){
                            log.info(this.timezone);
                            return cb(null, this.timezone);
                        }

                        log.info('TZ > TimezoneOffset from DB:', timezoneOffset);
                        return cb('FOUND_TIMEOFFSET', timezoneOffset);
                    });
                },
                (timezone, cb)=>{
                    // 2. get geocode by using timezone
                    this._getGeoByTimezone(timezone, (err, geo)=>{
                        if(err){
                            return cb('FAIL_GET_GEO');
                        }
                        return cb(null, {timezone, geo});
                    });
                },
                ({timezone, geo}, cb)=>{
                    // 3. get timeoffset by using geocode
                    this._getTimozoneOffsetByGeo(geo, (err, timezoneOffset)=>{
                        if(err){
                            return cb('2. FAIL_GET_TIMEZONEOFFSET');
                        }
                        return cb(null, {timezone, geo, timezoneOffset});
                    });
                },
                ({timezone, geo, timezoneOffset}, cb)=>{
                    // 4. store timeoffset to DB
                    this._updateTimezone({timezone, geo, timezoneOffset}, (err)=>{
                        if(err){
                            log.error('TZ > requestTimezoneOffset > Fail to Save : ', {timezone, geo, timezoneOffset});
                            return;
                        }
                    });

                    // to reduce response time.
                    return cb(null, timezoneOffset);
                }
            ],
            (err, timezoneOffset)=>{
                if(err && timezoneOffset === undefined){
                    log.warn('TZ> Fail to get Timezoneoffset by timezone string : ', err);
                    return callback('FAIL');
                }

                return callback(null, timezoneOffset);
            }
        );

        return this;
    }

    /**
     *
     * @param callback
     * @private
     */
    _updateTimezoneDB(callback){
        async.waterfall([
                (cb)=>{
                    // 1. get timezone info list from DB
                    this._getTimezoneList((err, list)=>{
                        if(err){
                            log.warn('TZ > There is no list in DB');
                            return callback('NO_DATA_LIST');
                        }

                        return cb(undefined, list);
                    });
                },
                (list, cb)=>{
                    // 2. update timezone info
                    this._updateTimezoneList(list, (err, count)=>{
                        if(err){
                            log.warn('TZ > Fail to update timezone list');
                            return cb('FAIL_TO_UPDATE');
                        }
                        return cb(undefined, count);
                    })
                }
            ],
            (err, res)=>{
                if(err){
                    log.error('TZ > Fail to update :', err);
                }

                return callback();
            }
        );
    }

    /**
     *
     * @param timezone
     * @param callback
     * @returns {TimezoneController}
     * @private
     */
    _getTimezoneOffsetFromDB(timezone, callback){
        if(timezone){
            this.timezone = timezone;
        }

        modelTimezone.find({timezone:timezone}, {_id:0}).limit(1).lean().exec((err, result)=>{
            if(err || result.length === 0){
                log.info('TZ > there is no timezone in DB :', err);
                return callback('NO_DATA_IN_DB');
            }

            this.timezoneOffset = result[0].timezoneOffset || 0;
            if(result[0].geo && result[0].geo.length >= 2){
                this.geo = {lon: result[0].geo[0], lat: result[0].geo[1]};
            }
            this.updatedAt = result[0].updatedAt || new Date();

            return callback(null, this.timezoneOffset);
        });

        return this;
    }

    _updateTimezoneList(list, callback){
        async.mapSeries(list,
            (item, cb)=>{
                this.timezone = item.timezone;
                this.requestTimezoneOffset(undefined, 'updateDB', (err, timezoneOffset)=>{
                    if(err){
                        log.warn('TZ > Fail to update timezone info :', this.timezone);
                    }
                    cb(undefined, timezoneOffset);
                });
            },
            (err, results)=>{
                if(results.length == 0){
                    log.warn('TZ > There is no updated timezone item');
                    return callback('FAIL_TO_UPDATE', results.length);
                }
                return callback(undefined, results.length);
            }
        );

        return this;
    }

    _getTimezoneList(callback){
        modelTimezone.find().lean().exec((err, list)=>{
            if(err || list.length == 0){
                log.info('TZ > There is no timezone info to DB');
                return callback('NO_DATA_IN_DB');
            }
            return callback(undefined, list);
        });
    }
    /**
     *
     * @param info
     * @param callback
     * @private
     */
    _updateTimezone(info, callback){
        let newItem = {
            updatedAt: new Date(),
            timezone: info['timezone'],
            timezoneOffset: info['timezoneOffset'],
            geo: [info['geo'].lon, info['geo'].lat]
        };
        this.updatedAt = newItem.updatedAt;

        log.info('updateTimezone :', JSON.stringify(newItem));
        modelTimezone.update({timezone: newItem.timezone},
            newItem,
            {upsert : true},
            (err, result)=>{
                if(err){
                    return callback(err);
                }
                callback(undefined, newItem);
            }
        );
    }

    /**
     *
     * @param timezone
     * @private
     */
    _removeTimezone(timezone){
        modelTimezone.remove({timezone}, (err)=>{
            if(err){
                log.error('TZ > Faile to remove :', err);
            }
        });
    }

    /**
     *
     * @param timezone
     * @param callback
     * @returns {TimezoneController}
     * @private
     */
    _getGeoByTimezone(timezone, callback){
        let encodedUrl = 'https://maps.googleapis.com/maps/api/geocode/json?address='+timezone+'&language=en&key=' + this._googleKey;
        encodedUrl = encodeURI(encodedUrl);
        log.info(encodedUrl);

        request.get(encodedUrl, {json:true, timeout: 1000 * 10}, (err, response, body)=>{
            if(err) {
                log.error('TZ > Fail!! _getGeoByTimezone : ', err);
                return callback(err);
            }

            if(response.statusCode >= 400){
                err = new Error("response.statusCode="+statusCode);
                return callback(err);
            }

            try {
                let geocode = {};

                //log.info(JSON.stringify(result));
                if(body.hasOwnProperty('results')){
                    if(Array.isArray(body.results)
                        && body.results[0].hasOwnProperty('geometry')){
                        if(body.results[0].geometry.hasOwnProperty('location')){
                            if(body.results[0].geometry.location.hasOwnProperty('lat')){
                                geocode['lat'] = parseFloat(body.results[0].geometry.location.lat);
                            }
                            if(body.results[0].geometry.location.hasOwnProperty('lng')){
                                geocode['lon'] = parseFloat(body.results[0].geometry.location.lng);
                            }
                        }
                    }
                }

                log.info('converted geocode : ', JSON.stringify(geocode));

                return callback(null, this.geo = geocode);
            }
            catch(e) {
                log.error('TZ > something wrong : _getGeoByTimezone');
                return callback(e);
            }
        });

        return this;
    }

    /**
     *
     * @param geo
     * @param callback
     * @returns {TimezoneController}
     * @private
     */
    _getTimozoneOffsetByGeo(geo, callback){
        let encodedUrl = 'https://maps.googleapis.com/maps/api/timezone/json?location=';
        encodedUrl += geo.lat + ',' + geo.lon;
        encodedUrl += '&timestamp=' + Math.floor((new Date().getTime())/1000);
        encodedUrl += '&key=' + this._googleKey;
        encodedUrl = encodeURI(encodedUrl);
        log.info('TZ > URL for TimezoneOffset :', encodedUrl);

        request.get(encodedUrl, {json:true, timeout: 1000 * 10}, (err, response, body)=>{
            if(err) {
                log.warn('TZ > Fail!! _getTimozoneOffsetByGeo : ', err);
                return callback(err);
            }

            if(response.statusCode >= 400){
                err = new Error("response.statusCode="+statusCode);
                return callback(err);
            }

            try {
                log.info(body);
                if(body.status != 'OK')
                {
                    log.warn('Cannot get timezone from Google : ', geo);
                    return callback('ZERO_RESULTS');
                }

                let res = 0;
                ['dstOffset', 'rawOffset'].forEach((item)=>{
                    res += parseInt(body[item]) || 0;
                });

                return callback(null, this.timezoneOffset = res/60); // Minute unit
            }
            catch (e) {
                log.error(e);
                return callback(e);
            }
        });

        return this;
    };
}

module.exports = TimezoneController;
