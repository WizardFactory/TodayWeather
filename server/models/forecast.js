/**
 * Created by kay on 2015-10-08.
 */

var current = require('./current');
var short = require('./short');
var midLand = require('./midLand');
var midTemp = require('./midTemp');

function Forecast(){
}

Forecast.getCurrentData = function(first, second, third, cb){
    current.getCurrentData(first, second, third, cb);
};
Forecast.getOneCurrentData = function(first, second, third, cb){
    current.getOneCurrentData(first, second, third, cb);
};

Forecast.getOneShortData = function(first, second, third, cb){
    short.getOneShortData(first, second, third, cb);
}
module.exports = Forecast;

