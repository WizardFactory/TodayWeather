/**
 * Created by Peter on 2016. 3. 17..
 */
"use strict";

var events = require('events');
var req = require('request');
var async = require('async');
var modelGeocode = require('../../models/worldWeather/modelGeocode');
var conCollector = require('./controllerCollector');

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

        if(!self.isValidCommand(req)){
            req.validReq = false;
            log.error('RQ> Invalid Command');
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
                            log.error('command error : get_all');
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
                        log.error('RQ>  fail to run req_add_geocode');
                        req.result = {status: 'Fail', cmd: req.params.command};
                        next();
                        return;
                    }
                    log.info('RQ> success adding geocode');
                    req.result = {status: 'OK', cmd: req.params.command};
                    next();
                });
                break;

            case 'req_two_days':
                self.reqDataForTwoDays(req, function(err){
                    if(err){
                        log.error('RQ>  fail to run req_two_days');
                        req.result = {status: 'Fail', cmd: req.params.command};
                        next();
                        return;
                    }
                    log.info('RQ> success adding req_two_days');
                    req.result = {status: 'OK', cmd: req.params.command};
                    next();
                });
                break;

            case 'add_key':
                if(global.collector){
                    self.addKey(req, function(err){
                        if(err){
                            log.error('RQ>  fail to run addKey');
                            req.result = {status: 'Fail', cmd: req.params.command};
                            next();
                            return;
                        }
                        log.info('RQ> success adding Key');
                        req.result = {status: 'OK', cmd: req.params.command};
                        next();
                    });
                }else{
                    log.info('RQ> There is no collector module');
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

        if(req.query.key === undefined){
            req.validReq = false;
            log.error('RQ> Unknown user connect to the server');
            return next();
        }

        log.info('RQ> key : ', req.query.key);

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

    log.info('category: ', req.params.category);
    log.info('command : ', req.params.command);
    log.silly(i, commandCategory.length, j , command.length)
    return (i < commandCategory.length && j < command.length);
};
/**
 *
 * @param req
 * @returns {boolean}
 */
ControllerRequester.prototype.parseGeocode = function(req){
    if(req.query.gcode === undefined){
        log.silly('RQ> There are no geocode');
        return false;
    }
    var geocodeString = req.query.gcode;

    //log.info('code:', geocodeString);
    var codelist = geocodeString.split(',');
    if(codelist.length !== 2){
        log.error('RQ> geocode has somthing wrong : ', codelist);
        return false;
    }

    req.geocode = {
        lat: parseFloat(codelist[0]),
        lon: parseFloat(codelist[1])
    };

    log.info('RQ> ', req.geocode);

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
ControllerRequester.prototype.saveGeocodeToDb = function(geocode, address, callback){
    var self = this;
    var meta = {};
    meta.method = 'saveGeocodeToDb';
    meta.geocode = geocode;

    log.silly(meta);
    var newGeocodeItem = new modelGeocode({
        geocode: geocode,
        address: address
    });

    newGeocodeItem.save(function(err){
        log.info('RQ> save geocode :', err);
        callback(err);
    });
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
                    log.silly('There are no geocode');
                    cb(undefined, false);
                }else{
                    cb(undefined, true);
                }
            },
            function(isGeocode, cb){
                if(!self.parseAddress(req)){
                    log.silly('There are no address');
                    if(isGeocode){
                        log.info('Only have geocode');
                        cb(null);
                        return;
                    }else{
                        log.error('There are no geocode or city name');
                        cb('err_exit_no_parameter');
                        return;
                    }
                }
                cb(null);
            },
            function(cb){
                // 2. save Geocode to DB
                var address = {country:'', city:'', zipcode:'', postcode:''};
                var geocode = {lat:1, lon:1};

                if(req.address){
                    if(req.address.country){
                        address.country = req.address.country;
                    }
                    if(req.address.city){
                        address.city = req.address.city;
                    }
                }
                if(req.geocode){
                    geocode = req.geocode;
                }

                self.saveGeocodeToDb(geocode, address, function(err){
                    if(err){
                        req.err = new Error('RQ> Can not save geocode to DB');
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
                log.info('RQ> end of adding geocode :', err);
            }else{
                log.silly('RQ> success adding geocode :', err);
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
                if(global.collector === undefined){
                    collector = new conCollector;
                }else{
                    collector = global.collector;
                }
                async.parallel([
                        function(callback){
                            collector.requestWuData(req.geocode, function(err, wuData){
                                if(err){
                                    log.error('RQ> Fail to requestWuData');
                                    callback('Fail to requestWuData');
                                    return;
                                }

                                callback(null);
                            });
                        },
                        function(callback){
                            collector.requestDsfData(req.geocode,1 ,8, function(err, dsfData){
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
    req.weather = {};
    var collector;
    if(global.collector === undefined){
        collector = new conCollector;
    }else{
        collector = global.collector;
    }

    if(!self.parseGeocode(req)) {
        log.error('There are no geocode : reqDataForTwoDays()');
        callback('err_no_geocode');
        return;
    }

    async.parallel([
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
            function(cb){
                collector.requestDsfData(req.geocode, 0, 2, function(err, dsfData){
                    if(err){
                        log.error('RQ> Fail to requestDsfData');
                        cb('Fail to requestDsfData');
                        return;
                    }

                    cb(null);
                });
            }
        ],
        function(err, result){
            if(err){
                log.error('RQ> Fail to request weather');
            }
            callback(err, result);
        }
    );
};

ControllerRequester.prototype.addKey = function(req, callback){
    var self = this;
    var key = {};

    if(req.query.key_type === undefined){
        log.error('RQ> There is no key type parmeter');
        callback('fail_add_key');
        return;
    }

    if(req.query.ckey === undefined){
        log.error('RQ> There is no key parmeter');
        callback('fail_add_key');
        return;
    }

    if(req.query.key_type === 'wu'){
        if(req.query.key_id === undefined){
            log.error('RQ> There is no WU key ID parmeter');
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