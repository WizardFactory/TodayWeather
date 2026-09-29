/**
 * Created by aleckim on 18. 7. 17..
 */

"use strict";

var assert  = require('assert');

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var controllerManager = require('../controllers/controllerManager');
global.manager = new controllerManager();

const KmaSpecialWeatherController = require('../controllers/kma.specialweather.controller');


describe('unit test - kma special weather controller', ()=> {
    // Town matching moved from national text to warning zone codes (#2609);
    // see test/offline/kma-warning.test.js.
    it ('test sort special info list', ()=> {
        let list = [{weather: 9, weatherStr: "한파"}, {weather: 11, weatherStr: "황사"}];
        let kmaSpecial = new KmaSpecialWeatherController();
        let newList = kmaSpecial._sort(list);

        assert(newList[0].weather === 11);
    });
});
