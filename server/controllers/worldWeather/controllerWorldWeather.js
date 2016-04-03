/**
 * Created by Peter on 2016. 3. 17..
 */
var req = require('request');
var async = require('async');

var weatherCategory = ['short', 'current'];

function controllerWorldWeather(){
    var self = this;

    self.sendResult = function(req, res){
        if(req.error){
            res.json(req.error);
            return;
        }

        if(req.result){
            res.json(req.result);
            return;
        }

        return;
    };

    self.showUsage = function(req, res, next){
        if(req.result === undefined){
            req.result = {};
        }
        req.result.usage = [
            '/{API version}/{code}/[options]',
            'example 1 > /010000/39.66,116.40',
            'example 2 > /010000/39.66,116.40/short',
            'example 3 > /010000/39.66,116.40/current'
        ];

        next();
    };

    self.checkApiVersion = function(req, res, next){
        var self = this;
        var meta = {};

        meta.method = 'checkApiVersion';
        meta.version = req.params.version;
        req.version = req.params.version;

        log.info(meta);

        // todo: To check all version and make way to alternate route.
        if(req.version !== '010000') {
            log.error('It is not valid version :', req.version);
            req.validVersion = false;
            req.error = 'It is not valid version : ' + req.version;
            next();
        }else{
            log.info('WW > go to next step');
            req.validVersion = true;
            next();
        }
    };

    self.queryWeather = function(req, res, next){
        var meta = {};
        meta.method = 'queryWeather';

        if(!req.validVersion){
            log.error('invalid version : ', req.validVersion);
            return next();
        }

        if(!self.isValidCategory(req)){
            return next();
        }

        if(!self.getCode(req)){
            log.error('There is no geocode');
            return next();
        }

        log.info('geocode : ', req.geocode);
        next();

    };

    self.isValidCategory = function(req){
        if(req.params.category === undefined){
            log.error('there is no category');
            return false;
        }

        for(var i in weatherCategory){
            if(weatherCategory[i] === req.params.category){
                return true;
            }
        }

        return false;
    };

    self.getCode = function(req){
        if(req.query.gcode === undefined){
            log.error('can not find geocode from qurey');
            req.error = 'Can not find geocode from query';
            return false;
        }

        var geocode = req.query.gcode.split(',');
        if(geocode.length !== 2){
            log.error('wrong goecode : ', geocode);
            req.error = 'wrong geocode : ' + geocode;
            return false;
        }

        req.geocode = {lat:geocode[0], lon:geocode[1]};

        return true;
    };

    return self;
}

module.exports = controllerWorldWeather;