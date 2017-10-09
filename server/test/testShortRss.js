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
var controllerTownRss = require('../controllers/kma/kma.town.short.rss.controller');

describe('unit test - get short rss by using controllerShortRss', function(){
    //var mongoose = require('mongoose');
    //mongoose.connect(config.db.path, function(err) {
    //    if (err) {
    //        log.error('Could not connect to MongoDB!');
    //        console.log(err);
    //        done();
    //    }
    //});
    //
    //mongoose.connection.on('error', function(err) {
    //    log.error('MongoDB connection error: ' + err);
    //    done();
    //});
    //
    //var townRss = new controllerTownRss();
    //
    //it('controller/controllerShortRss', function(done){
    //    var resultTime = townRss.calculateTime('201512150000', 18);
    //    assert.equal(resultTime, '201512151800', 'calculate time');
    //
    //    resultTime = townRss.calculateTime('201512310000', 25);
    //    assert.equal(resultTime, '201601010100', 'calculate time');
    //
    //    townRss.StartShortRss();
    //    log.info('start mainTask');
    //    townRss.mainTask();
    //    this.timeout(1000*8);
    //    setTimeout(done, 1000*10);
    //});
    //it('controller/controllerShortRss2', function(done){
    //    log.info('restart mainTask');
    //    // pubDate
    //    townRss.mainTask();
    //    this.timeout(1000*8);
    //    setTimeout(done, 1000*10);
    //});
});