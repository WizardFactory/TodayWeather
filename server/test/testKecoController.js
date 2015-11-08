/**
 * Created by aleckim on 15. 11. 4..
 */

"use strict";

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var assert  = require('assert');

var kecoController = require('../controllers/kecoController');

describe('unit test - keco controller', function() {
    //var mongoose = require('mongoose');
    //mongoose.connect('localhost/todayweather', function(err) {
    //    if (err) {
    //        console.error('Could not connect to MongoDB!');
    //        console.log(err);
    //        done();
    //    }
    //});
    //mongoose.connection.on('error', function(err) {
    //    console.error('MongoDB connection error: ' + err);
    //    done();
    //});
    //
    //it('test appendData', function(done) {
    //    this.timeout(4*1000);
    //    var town = { "first" : "경기도", "second" : "안성시", "third" : "안성3동"};
    //    var current = {};
    //
    //    kecoController.appendData(town, current, function (err, result) {
    //        if (err) {
    //            console.log(err + ' ' + result);
    //        }
    //        //console.log(current);
    //        done();
    //    });
    //});

    //it('test again to get appendData', function(done) {
    //    this.timeout(10*1000);
    //    var town = { "first" : "경기도", "second" : "안성시", "third" : "안성3동"};
    //    var current = {};
    //
    //    kecoController.appendData(town, current, function (err, result) {
    //        console.log(err + ' ' + result);
    //        console.log(current);
    //        done();
    //    });
    //});
});


