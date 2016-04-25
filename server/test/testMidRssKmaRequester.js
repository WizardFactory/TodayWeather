/**
 * Created by aleckim on 2015. 12. 26..
 */

"use strict";

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var assert  = require('assert');
var MidRssKmaRequester  = require('../lib/midRssKmaRequester');

describe('unit test - requester of MID RSS KMA service class', function() {

    //var midRssKma = new MidRssKmaRequester();

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

    //it('start MidRssKma Requester', function (done) {
    //    this.timeout(1000*60*2); //2mins
    //    midRssKma.start();
    //});

    //it('call main process', function (done) {
    //    this.timeout(1000*10);
    //    midRssKma.mainProcess(midRssKma, function (self, err) {
    //        if (err) {
    //            log.error(err);
    //            assert(false);
    //        }
    //        assert(true);
    //        done();
    //    });
    //});
});
