/**
 * Created by Peter on 2016. 11. 20..
 */

'use strict';

var config = require('../../config/config');

function ControllerKeys() {
    var self = this;
    var keyBox = config.keyString;

    self.owm_keys = {
        limitCount : 10000,
        usedCount : 0,
        curIndex : 0,
        date: new Date(),
        keys: []
    };
    self.wu_keys = {
        limitCount : 20000,
        usedCount : 0,
        curIndex : 0,
        date: new Date(),
        keys: []
    };
    self.dsf_keys = {
        limitCount : 1000,
        usedCount : 0,
        curIndex : 0,
        date: new Date(),
        keys: []
    };
    self.aqi_keys = {
        limitCount: 10000,
        usedCount: 0,
        curIndex: 0,
        date: new Date(),
        keys: []
    };

    log.info('loging keys.....');
    log.info('------------------------------------');
    if(keyBox.owm_keys){
        keyBox.owm_keys.forEach(function(item){
            self.owm_keys.keys.push(item);
        });
        log.info('OpenWeatherMap : key count(%d)', self.owm_keys.keys.length);
    }

    if(keyBox.wu_keys){
        keyBox.wu_keys.forEach(function(item){
            self.wu_keys.keys.push(item);
        });
        log.info('WeatherUnloched : key count(%d)', self.wu_keys.keys.length);
    }

    if(keyBox.dsf_keys){
        keyBox.dsf_keys.forEach(function(item){
            self.dsf_keys.keys.push(item);
        });
        log.info('DarkSkyForecast : key count(%d)', self.dsf_keys.keys.length);
    }

    if(keyBox.aqi_keys){
        keyBox.aqi_keys.forEach(function(item){
            self.aqi_keys.keys.push(item);
        });
        log.info('AQI : key count(%d)', self.aqi_keys.keys.length);
    }
    log.info('------------------------------------');
    log.info('Keys have been loaded');
}

ControllerKeys.prototype.addKey = function(type, key){
    var self = this;

    switch(type){
        case 'owm':
            self.owm_keys.keys.push(key);
            break;

        case 'wu':
            self.wu_keys.keys.push(key);
            break;

        case 'dsf':
            self.dsf_keys.keys.push(key);
            break;

        case 'aqi':
            self.aqi_keys.keys.push(key);
            break;

        default:
            log.error('unknow key type : ', type);
            return false;
            break;
    }

    log.info('Key Added :', type, key);
    return true;
};

ControllerKeys.prototype.getOwmKey = function(){
    var self = this;
    var curDate = new Date();

    if(curDate.getDay() != self.owm_keys.date.getDay()){
        // renew data used count as day has been changed.
        self.owm_keys.curIndex = 0;
        self.owm_keys.usedCount = 0;
    }

    // update current date
    self.owm_keys.date = curDate;

    if(self.owm_keys.usedCount >= self.owm_keys.limitCount) {
        self.owm_keys.curIndex += 1;

        if (self.owm_keys.curIndex >= self.owm_keys.keys.length) {
            // no more keys.
            log.info('OWM key : There is no more available key');
            return '';
        }
    }
    self.owm_keys.usedCount += 1;

    return self.owm_keys.keys[self.owm_keys.curIndex];
};

ControllerKeys.prototype.getWuKey = function(){
    var self = this;
    var curDate = new Date();

    if(curDate.getDay() != self.wu_keys.date.getDay()){
        // renew data used count as day has been changed.
        self.wu_keys.curIndex = 0;
        self.wu_keys.usedCount = 0;
    }

    // update current date
    self.wu_keys.date = curDate;

    if(self.wu_keys.usedCount >= self.wu_keys.limitCount) {
        self.wu_keys.curIndex += 1;

        if (self.wu_keys.curIndex >= self.wu_keys.keys.length) {
            // no more keys.
            log.info('WU key : There is no more available key');
            return '';
        }
    }
    self.wu_keys.usedCount += 1;

    return self.wu_keys.keys[self.wu_keys.curIndex];
};

ControllerKeys.prototype.getDsfKey = function(){
    var self = this;
    var curDate = new Date();

    if(curDate.getDay() != self.dsf_keys.date.getDay()){
        // renew data used count as day has been changed.
        self.dsf_keys.curIndex = 0;
        self.dsf_keys.usedCount = 0;
    }

    // update current date
    self.dsf_keys.date = curDate;

    if(self.dsf_keys.usedCount >= self.dsf_keys.limitCount) {
        self.dsf_keys.curIndex += 1;

        if (self.dsf_keys.curIndex >= self.dsf_keys.keys.length) {
            // no more keys.
            log.info('DSF key : There is no more available key');
            return '';
        }
        self.dsf_keys.usedCount = 0;
    }
    self.dsf_keys.usedCount += 1;

    return self.dsf_keys.keys[self.dsf_keys.curIndex];
};

ControllerKeys.prototype.getAqiKey = function(){
    var self = this;
    var curDate = new Date();

    if(curDate.getDay() != self.aqi_keys.date.getDay()){
        // renew data used count as day has been changed.
        self.aqi_keys.curIndex = 0;
        self.aqi_keys.usedCount = 0;
    }

    // update current date
    self.aqi_keys.date = curDate;

    if(self.aqi_keys.usedCount >= self.aqi_keys.limitCount) {
        self.aqi_keys.curIndex += 1;

        if (self.aqi_keys.curIndex >= self.aqi_keys.keys.length) {
            // no more keys.
            log.info('AQI key : There is no more available key');
            return '';
        }
        self.aqi_keys.usedCount = 0;
    }
    self.aqi_keys.usedCount += 1;

    return self.aqi_keys.keys[self.aqi_keys.curIndex];
};

ControllerKeys.prototype.setKeyLimit = function(type, count){
    var self = this;

    switch(type){
        case 'owm':
            self.owm_keys.limitCount = count;
            break;

        case 'wu':
            self.wu_keys.limitCount = count;
            break;

        case 'dsf':
            self.dsf_keys.limitCount = count;
            break;

        case 'aqi':
            self.aqi_keys.limitCount = count;
            break;

        default:
            log.error('unknow key type : ', type);
            return false;
            break;
    }

    return true;
};

ControllerKeys.prototype.setDate = function(type, date){
    var self = this;

    switch(type){
        case 'owm':
            self.owm_keys.date = date;
            break;

        case 'wu':
            self.wu_keys.date = date;
            break;

        case 'dsf':
            self.dsf_keys.date = date;
            break;

        case 'aqi':
            self.aqi_keys.date = date;
            break;

        default:
            log.error('unknow key type : ', type);
            return false;
            break;
    }

    return true;
};

module.exports = ControllerKeys;