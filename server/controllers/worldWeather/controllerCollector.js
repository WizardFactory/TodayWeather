/**
 * Created by Peter on 2016. 5. 29..
 */
"use strict";

var fs = require('fs');
var async = require('async');

var modelGeocode = require('../../models/worldWeather/modelGeocode');
var modelWuForecast = require('../../models/worldWeather/modelWuForecast');

var config = require('../../config/config');
var metRequester = require('../../lib/MET/metRequester');
var owmRequester = require('../../lib/OWM/owmRequester');
var wuRequester = require('../../lib/WU/wuRequester');

function ConCollector() {
    var self = this;
}

ConCollector.prototype.getGeocodeList = function(db, callback){

};

ConCollector.prototype.getWuForecast = function(list, callback){
    var self = this;
};

ConCollector.prototype.saveWuForecast = function(){
    var self = this;
};

module.exports = ConCollector;
