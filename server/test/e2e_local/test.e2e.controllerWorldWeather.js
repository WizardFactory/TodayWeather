/**
 * Created by Peter on 2016. 3. 2..
 */

"use strict";

var assert  = require('assert');
var Logger = require('../../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var controllerWorldWeather = require('../../controllers/worldWeather/controllerWorldWeather');
var ctrlWW = new controllerWorldWeather();

describe('unit test - controller world Weather', function(){
    it('test get address by geocode', function(done){
        // NY 40.663527,-73.960852
        var loc = {lat: 40.663527, lng: -73.960852};
        ctrlWW.getaddressByGeocode(loc.lat, loc.lng, function (err, result) {
            if (err) {
                console.error(err);
            }
            else {
                assert(result.indexOf('USA') !== -1);
            }
           done() ;
        });
    });
});
