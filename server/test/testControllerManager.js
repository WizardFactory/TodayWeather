/**
 * Created by aleckim on 2015. 12. 22..
 */

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var assert  = require('assert');
var config = require('../config/config');
var controllerManager = require('../controllers/controllerManager');

var manager = new controllerManager();

describe('unit test - controller manager', function() {
    //var mongoose = require('mongoose');
    //mongoose.connect(config.db.path, function(err) {
    //    if (err) {
    //        console.error('Could not connect to MongoDB!');
    //        console.log(err);
    //        done();
    //    }
    //});
    //
    //mongoose.connection.on('error', function(err) {
    //    console.error('MongoDB connection error: ' + err);
    //    done();
    //});
    //
    //
    //it('test appendData', function(done) {
    //    this.timeout(60*1000);
    //    manager.getTownShortestData(9, config.keyString.test_cert, function (err, results) {
    //        done();
    //    });
    //});
});


