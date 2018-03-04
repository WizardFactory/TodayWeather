/**
 * Created by Peter on 2016. 3. 17..
 */
"use strict";

var events = require('events');
var request = require('request');
var async = require('async');
var modelGeocode = require('../../models/worldWeather/modelGeocode');
var conCollector = require('./controllerCollector');
var controllerAqi = require('./controllerAqi');
var config = require('../../config/config');

var commandCategory = ['all','met','owm','wu', 'dsf'];
var command = ['get_all','get', 'req_add', 'req_two_days', 'add_key'];

/**
 *
 * @returns {ControllerRequester}
 * @constructor
 */
function ControllerRequester(){
    var self = this;

    /**
     *
     * @param req
     * @param res
     * @param next
     * @returns {*}
     */
    self.runCommand = function(req, res, next){
        var meta = {};
        meta.sID = req.sessionID;

        if(!self.isValidCommand(req)){
            req.validReq = false;
            log.error('RQ> Invalid Command', meta);
            req.result = {status: 'Fail', cmd: req.params.command};
            return next();
        }

        // TODO : implement running command. ex> run collecting all weather, request geocode for weather
        switch(req.params.command)
        {
            case 'get_all':
                if(req.params.category === 'WU'){
                    var collector;
                    if(global.collector === undefined){
                        collector = new conCollector;
                    }else{
                        collector = global.collector;
                    }
                    collector.runTask(true, function(err){
                        if(err){
                            log.error('command error : get_all', meta);
                            req.result = {status: 'Fail', cmd: req.params.command};
                        }else{
                            req.result = {status: 'OK', category: req.params.category, cmd: req.params.command};
                        }

                        next();
                    });
                }else{
                    req.result = {status: 'OK', cmd: req.params.command};
                    next();
                }
                break;
            case 'get':
                break;
            case 'req_add':
                self.addNewLocation(req, function(err){
                    if(err){
                        log.error('RQ>  fail to run req_add_geocode', meta);
                        req.result = {status: 'Fail', cmd: req.params.command};
                        next();
                        return;
                    }
                    log.info('RQ> success adding geocode', meta);
                    req.result = {status: 'OK', cmd: req.params.command};
                    next();
                });
                break;

            case 'req_two_days':
                self.reqDataForTwoDays(req, function(err, response){
                    if(err){
                        log.error('RQ>  fail to run req_two_days', meta);
                        req.result = {status: 'Fail', cmd: req.params.command};
                        next();
                        return;
                    }
                    log.info('RQ> success adding req_two_days', meta);
                    req.result = {status: 'OK', cmd: req.params.command, data: response};
                    next();
                });
                break;

            case 'add_key':
                if(global.collector){
                    self.addKey(req, function(err){
                        if(err){
                            log.error('RQ>  fail to run addKey', meta);
                            req.result = {status: 'Fail', cmd: req.params.command};
                            next();
                            return;
                        }
                        log.info('RQ> success adding Key', meta);
                        req.result = {status: 'OK', cmd: req.params.command};
                        next();
                    });
                }else{
                    log.info('RQ> There is no collector module', meta);
                    req.result = {status: 'Fail', cmd: req.params.command};
                    next();
                }
                break;

            default:
                req.result = {status: 'Fail', cmd: req.params.command};
                next();
                break;
        }
    };

    /**
     *
     * @param req
     * @param res
     * @param next
     * @returns {*}
     */
    self.checkKey = function(req, res, next){
        var self = this;
        var meta = {};
        meta.sID = req.sessionID;

        if(req.query.key === undefined){
            req.validReq = false;
            log.error('RQ> Unknown user connect to the server', meta);
            return next();
        }

        log.debug('RQ> key : ', req.query.key, meta);

        //todo: Check user key.
        // !!! CAUTION !!! This is Administrator's KEY.
        req.validReq = true;

        next();
        return self;
    };

    /**
     *
     * @param req
     * @param res
     */
    self.sendResult = function(req, res){
        log.info('@@ - ' + decodeURI(req.originalUrl) + ' Time[', (new Date()).toISOString() + '] sID=' + req.sessionID);
        if(req.result){
            res.json(req.result);
        }

        if(req.error){
            res.json({error:'RQ> fail to request'});
            res.json(req.error);
        }

        return;
    };

    return self;
}

/**
 *
 * @param req
 * @returns {boolean}
 */
ControllerRequester.prototype.isValidCommand = function(req){
    var i, j;
    var meta = {};
    meta.sID = req.sessionID;

    if(req.params.category === undefined ||
        req.params.command === undefined){
        return false;
    }

    // TODO: Check command wether it is valid or not.
    for(i=0 ; i < commandCategory.length ; i++){
        if(commandCategory[i] === req.params.category){
            break;
        }
    }

    for(j=0 ; j < command.length ; j++){
        if(command[j] === req.params.command){
            break;
        }
    }

    log.info('category: ', req.params.category, meta);
    log.info('command : ', req.params.command, meta);
    log.silly(i, commandCategory.length, j , command.length);
    return (i < commandCategory.length && j < command.length);
};
/**
 *
 * @param req
 * @returns {boolean}
 */
ControllerRequester.prototype.parseGeocode = function(req){
    var meta = {};
    meta.sID = req.sessionID;

    if(req.query.gcode === undefined){
        log.silly('RQ> There are no geocode', meta);
        return false;
    }
    var geocodeString = req.query.gcode;

    //log.info('code:', geocodeString);
    var codelist = geocodeString.split(',');
    if(codelist.length !== 2){
        log.error('RQ> geocode has something wrong : ', codelist, meta);
        return false;
    }

    req.geocode = {
        lat: parseFloat(codelist[0]),
        lon: parseFloat(codelist[1])
    };

    log.info('RQ> ', req.geocode, meta);

    return true;
};

/**
 * must be supporting 30 mins
 * @param req
 * @returns {boolean}
 */
ControllerRequester.prototype.parseTimezone = function(req){
    var meta = {};
    meta.sID = req.sessionID;

    if(req.query.timezone === undefined){
        log.silly('RQ> There are no timezone', meta);
        return false;
    }
    req.timezone = req.query.timezone;

    log.info('RQ timezone> ', req.timezone, meta);

    return true;
};
/**
 *
 * @param req
 * @returns {boolean}
 */
ControllerRequester.prototype.parseAddress = function(req){
    if(req.query.city === undefined){
        log.silly('RQ> There are no city name');
        return false;
    }

    var address = {};

    address.city = req.query.city;
    if(req.query.country){
        address.country = req.query.country;
    }
    if(req.query.zipcode){
        address.country = req.query.zipcode;
    }
    if(req.query.postcode){
        address.postcode = req.query.postcode;
    }

    req.address = address;

    log.info('RQ> ', req.address);

    return true;
};

/**
 *
 * @param geocode
 * @param address
 * @param callback
 */
ControllerRequester.prototype.saveGeocodeToDb = function(geocode, address, timeOffset, callback){
    var self = this;
    var meta = {};
    meta.method = 'saveGeocodeToDb';
    meta.geocode = geocode;

    log.silly(meta);
    var newGeocodeItem = new modelGeocode({
        geocode: geocode,
        address: address,
        timeOffset : timeOffset
    });

    newGeocodeItem.save(function(err){
        log.info('RQ saveGeocodeToDb> save geocode :', err);
        callback(err);
    });
};

ControllerRequester.prototype.getLocalTimeOffset = function (geocode, callback) {
    var timestamp;
    var url;

    if(geocode.hasOwnProperty('lat') && geocode.hasOwnProperty('lon')){
        timestamp = (new Date()).getTime();
        url = "https://maps.googleapis.com/maps/api/timezone/json";
        url += "?location="+geocode.lat+","+geocode.lon+"&timestamp="+Math.floor(timestamp/1000);
        if (config.keyString.google_key) {
            url += '&key='+config.keyString.google_key;
        }

        request.get(url, {json:true, timeout: 1000 * 20}, function(err, response, body){
            if (err) {
                log.error('RQ Timezone > Fail to get timezone', err);
                return callback(err);
            }
            else {
                try {
                    if(body.status == 'ZERO_RESULTS') {
                        log.error('RQ Timezone > There is no timezone');
                        return callback('RQ Timezone > error');
                    }

                    log.info(body);
                    var result = body;
                    var offset = (result.dstOffset+result.rawOffset);
                    result = (offset / 60) / 60; //convert to hour;

                    log.info('RQ Timezone > getLocalTimeOffset : ', result);

                    return callback(0, result);
                }
                catch (e) {
                    log.error(e);
                    return callback(e);
                }
            }
        });
    }else{
        log.error('RQ Timezone > there is no geocode');
        callback(1);
    }
};

/**
 *
 * @param req
 * @param callback
 */
ControllerRequester.prototype.addLocation = function(req, callback){
    var self = this;

    async.waterfall([
            function(cb){
                // 1. paese geocode from URL
                if(!self.parseGeocode(req)){
                    log.silly('RQ addLocation> There are no geocode');
                    cb(undefined, false);
                }else{
                    cb(undefined, true);
                }
            },
            function(isGeocode, cb){
                if(!self.parseAddress(req)){
                    log.silly('RQ addLocation> There are no address');
                    if(isGeocode){
                        log.info('RQ addLocation> Only have geocode');
                        cb(null);
                        return;
                    }else{
                        log.error('RQ addLocation> There are no geocode or city name');
                        cb('err_exit_no_parameter');
                        return;
                    }
                }
                cb(null);
            },
            function(cb){
                // set timezone
                if(req.hasOwnProperty('geocode')){
                    self.getLocalTimeOffset(req.geocode, function(err, result){
                        if(err){
                            log.error('RQ addLocation> Fail to get localtimeoffset : ', err);
                        }else{
                            req.timeOffset = result;
                        }
                        cb(null);
                    });
                }else{
                    log.error('RQ addLocation> cannot get geocode');
                    cb(null);
                }
            },
            function(cb){
                // save Geocode to DB
                var address = {country:'', city:'', zipcode:'', postcode:''};
                var geocode = {lat:1, lon:1};
                var timeOffset = 100;

                if(req.hasOwnProperty('address')){
                    if(req.address.hasOwnProperty('country')){
                        address.country = req.address.country;
                    }
                    if(req.address.hasOwnProperty('city')){
                        address.city = req.address.city;
                    }
                }
                if(req.hasOwnProperty('geocode')){
                    geocode = req.geocode;
                }
                if(req.hasOwnProperty('timeOffset')){
                    timeOffset = req.timeOffset;
                }

                self.saveGeocodeToDb(geocode, address, timeOffset, function(err){
                    if(err){
                        req.err = new Error('RQ addLocation> Can not save geocode to DB');
                        cb('err_exit_save');
                        return;
                    }
                    cb(null);
                });
            },
            function(cb){
                // 3. notify that saving is completed to client if it is necessery.
                cb(null);
            }
        ],
        function(err, result){
            if(err){
                log.info('RQ addLocation> end of adding geocode :', err);
            }else{
                log.silly('RQ addLocation> success adding geocode :', err);
            }

            if(callback){
                callback(err, result);
            }
        }
    );
};

/**
 *
 * @param req
 * @param callback
 */
ControllerRequester.prototype.addNewLocation = function(req, callback){
    var self = this;

    async.waterfall([
            function(cb){
                // 1. add location to DB
                self.addLocation(req, function(err){
                    if(err){
                        log.error('RQ>  fail to run req_add_geocode');
                        cb('err_exit_fail to add');
                        return;
                    }
                    cb(null);
                });
            },
            function(cb){
                // 2. get weather data from provider.
                req.weather = {};
                var collector;
                var timeOffset = 100;

                if(global.collector === undefined){
                    collector = new conCollector;
                }else{
                    collector = global.collector;
                }
                if(req.hasOwnProperty('timeOffset')){
                    timeOffset = req.timeOffset;
                }
                async.parallel([
                        function(callback){
                            collector.requestWuData(req.geocode, timeOffset, function(err, wuData){
                                if(err){
                                    log.error('RQ> Fail to requestWuData');
                                    callback('Fail to requestWuData');
                                    return;
                                }

                                callback(null);
                            });
                        },
                        function(callback){
                            collector.requestDsfData(req.geocode,1 ,8, timeOffset, function(err, dsfData){
                                if(err){
                                    log.error('RQ> Fail to requestDsfData');
                                    callback('Fail to requestDsfData');
                                    return;
                                }

                                callback(null);
                            });
                        }
                    ],
                    function(err, result){
                        if(err){
                            log.error('RQ> Fail to request weather');
                        }
                        cb(null);
                    }
                );
            },
            function(cb){
                // 3. adjust weather data for client.
                cb(null);
            }
        ],
        function(err, result){
            if(err){
                log.error('Fail to add and get weather for new location : ', err);
            }else{
                log.silly('Success to add and get weather');
            }

            if(callback){
                callback(err, result);
            }
        }
    );
};

ControllerRequester.prototype.reqDataForTwoDays = function(req, callback){
    var self = this;
    var meta = {};
    meta.sID = req.sessionID;

    var collector;
    if(global.collector === undefined){
        collector = new conCollector;
    }else{
        collector = global.collector;
    }

    //if(!self.parseGeocode(req)) {
    //    log.error('There are no geocode : reqDataForTwoDays()', meta);
    //    callback('err_no_geocode');
    //    return;
    //}

    //if(!self.parseTimezone(req)){
    //    req.timezone = 0;
    //}

    async.parallel([
            /*
            function(cb){
                collector.requestWuData(req.geocode, function(err, wuData){
                    if(err){
                        log.error('RQ> Fail to requestWuData');
                        cb('Fail to requestWuData');
                        return;
                    }

                    cb(null);
                });
            },
            */
            function(cb){
                collector.requestDsfData(req.geocode, 0, 2, function(err, dsfData, timeoffset){
                    if(err){
                        log.error('RQ> Fail to requestDsfData', meta);
                        cb('Fail to requestDsfData');
                        return;
                    }

                    if(req.hasOwnProperty('result') === false){
                        req.result = {};
                    }
                    if(req.result.hasOwnProperty('timezone') === false){
                        req.result.timezone = {};
                    }
                    // timezone Id
                    if(dsfData.address.hasOwnProperty('country')){
                        req.result.timezone.timezoneId = dsfData.address.country;
                    }

                    // timezone offset
                    if(timeoffset != undefined){
                        req.result.timezone.min = timeoffset;
                        req.result.timezone.ms = timeoffset * 60 * 1000;
                    }else{
                        log.error('RQ> No Timeoffset in DSF data!!, ', req.geocode);
                    }

                    //log.info('==> DSF RESULT:', JSON.stringify(dsfData));

                    cb(null, dsfData);
                });
            },
            function(cb){
                var collectorAqi = new controllerAqi;

                collectorAqi.requestAqiData(req.geocode, 0, 0, req.timezone, function(err, aqiData){
                    if(err){
                        log.error('RQ> Fail to requestAqiData', meta);
                        return cb('Fail to requestAqiData');
                    }

                    log.info('RQ> AQI result : ', aqiData);
                    cb(null, aqiData);
                });
            }
        ],
        function(err, result){
            if(err){
                log.error('RQ> Fail to request weather', meta);
            }

            var res = {};

            if(result.length > 0){
                result.forEach(function(item, index){
                    if(typeof item === 'object'){
                        if(item.type === 'DSF'){
                            res.DSF = item;
                        }

                        if(item.type === 'AQI'){
                            res.AQI = item;
                        }
                    }
                });
            }

            log.info('RQ> dsf : ', JSON.stringify(res.DSF));
            log.info('RQ> aqi : ', JSON.stringify(res.AQI));

            callback(err, res);
        }
    );
};

ControllerRequester.prototype.addKey = function(req, callback){
    var self = this;
    var meta = {};
    meta.sID = req.sessionID;

    var key = {};

    if(req.query.key_type === undefined){
        log.error('RQ> There is no key type parameter', meta);
        callback('fail_add_key');
        return;
    }

    if(req.query.ckey === undefined){
        log.error('RQ> There is no key parameter', meta);
        callback('fail_add_key');
        return;
    }

    if(req.query.key_type === 'wu'){
        if(req.query.key_id === undefined){
            log.error('RQ> There is no WU key ID parameter', meta);
            callback('fail_add_key');
            return;
        }
        key.id = req.query.key_id;
    }
    key.key = req.query.ckey;

    global.collector.addKey(req.query.key_type, key);
    callback(null);

};

module.exports = ControllerRequester;