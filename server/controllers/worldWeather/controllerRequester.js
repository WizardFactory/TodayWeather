/**
 * Created by Peter on 2016. 3. 17..
 */
"use strict";

var events = require('events');
var req = require('request');
var async = require('async');
var modelGeocode = require('../../models/worldWeather/modelGeocode');

var commandCategory = ['ALL','MET','OWM','WU'];
var command = ['get_all','get', 'req_add'];

function ControllerRequester(){
    var self = this;

    self.runCommand = function(req, res, next){

        if(!self.isValidCommand(req)){
            req.validReq = false;
            log.error('Invalid Command');
            return next();
        }

        // TODO : implement running command. ex> run collecting all weather, request geocode for weather
        switch(req.params.command)
        {
            case 'get_all':
                break;
            case 'get':
                break;
            case 'req_add':
                self.addNewLocation(req, function(err){
                    if(err){
                        log.info('RQ>  fail to run req_add_geocode');
                    }
                    log.info('RQ> success adding geocode');
                    req.result = {status: 'OK', cmd: req.params.command};
                    next();
                });
                break;
        }
    };

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

    return (i < commandCategory.length && j < command.length);
};

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
        lat: codelist[0],
        lon: codelist[1]
    };

    log.info('RQ> ', req.geocode);

    return true;
};

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

ControllerRequester.prototype.addNewLocation = function(req, callback){
    var self = this;

    async.waterfall([
            function(cb){
                // 1. add location to DB
                self.addLocation(req, function(err){
                    if(err){
                        log.info('RQ>  fail to run req_add_geocode');
                        cb('err_exit_fail to add');
                        return;
                    }
                    cb(null);
                });
            },
            function(cb){
                // 2. get weather data from provider.
                cb(null);
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

module.exports = ControllerRequester;