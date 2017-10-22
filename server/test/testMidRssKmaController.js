/**
 * Created by aleckim on 2015. 12. 27..
 */

"use strict";

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var assert  = require('assert');
var midRssKmaController  = require('../controllers/kma/kma.town.mid.rss.controller');


describe('unit test - controller of MID RSS KMA service class', function() {

    //var mongoose = require('mongoose');
    //mongoose.connect('localhost/todayweather', function(err) {
    //    if (err) {
    //        console.error('Could not connect to MongoDB!');
    //        console.log(err);
    //    }
    //});
    //mongoose.connection.on('error', function(err) {
    //    console.error('MongoDB connection error: ' + err);
    //    process.exit(-1);
    //});

    //it('getData', function (done) {
    //    var regId='11B10101';
    //    midRssKmaController.getData(regId, function (err, midRssData) {
    //        log.info(midRssData.toJSON());
    //        done();
    //    });
    //});

    //it('overwriteData', function(done) {
    //    var regId='11B10101';
    //    var regMidData = {};
    //    midRssKmaController.overwriteData(regMidData, regId, function (err, result) {
    //        log.info(JSON.stringify(result));
    //        done();
    //    });
    //});
});


