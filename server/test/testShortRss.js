/**
 * Created by Peter on 2015. 8. 4..
 */
"use strict";

var assert  = require('assert');
var config = require('../config/config');
//var keydata = require('../config/config');
var collect = require('../lib/collectTownForecast');
var Logger = require('../lib/log');
var convert = require('../utils/coordinate2xy');
var fs = require('fs');
var convertGeocode = require('../utils/convertGeocode');
var controllerTownRss = require('../controllers/controllerShortRss');

describe('unit test - get short rss by using controllerShortRss', function(){

    it('controller/controllerShortRss', function(done){
        var townRss = new controllerTownRss();

        var resultTime = townRss.calculateTime('201512150000', 18);

        assert.equal(resultTime, '201512151800', 'calcuate time');

        townRss.StartShortRss();

        townRss.mainTask();
        this.timeout(5000);

        setTimeout(done, 300);
    });
});