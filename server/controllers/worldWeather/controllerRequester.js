/**
 * Created by Peter on 2016. 3. 17..
 */
"use strict";

var events = require('events');
var req = require('request');
var async = require('async');

var commandCategory = ['ALL','MET','OWM','WU'];
var command = ['get_all','get', 'req_code'];

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
            case 'req_code':
                if(!self.getCode(req)){
                    log.error('RQ> There are no code');
                    next();
                }
                break;
        }
        next();
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

        res.json({error:'RQ> fail to request'});
        return this;
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

ControllerRequester.prototype.getCode = function(req){
    if(req.query.gcode === undefined){
        log.error('RQ> There are no geocode');
        return false;
    }
    var geocodeString = req.query.gcode;

    log.info('code:', geocodeString);
    var codelist = geocodeString.split(',');
    if(codelist.length !== 2){
        log.error('RQ> geocode has somthing wrong : ', codelist);
        return false;
    }

    req.geocode = {
        lat: codelist[0],
        lon: codelist[1]
    };

    log.info(req.geocode);


    return true;
};


module.exports = ControllerRequester;