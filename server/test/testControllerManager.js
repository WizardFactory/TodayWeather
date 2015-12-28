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

    //it('test shortest appendData', function(done) {
    //    this.timeout(60*1000*60*100); //100mins
    //    manager.getTownShortestData(9, config.keyString.test_cert, function (err, results) {
    //        done();
    //    });
    //});

    //it('test current appendData', function(done) {
    //    this.timeout(60*1000*60*100); //100mins
    //    manager.getTownCurrentData(9, config.keyString.test_cert, function (err, results) {
    //        done();
    //    });
    //});

    //it('test short appendData', function (done) {
    //    this.timeout(60*1000*60*100); //100mins
    //    manager.getTownShortData(9, config.keyString.test_cert, function (err, results) {
    //        done();
    //    });
    //});

    //it('test mid forecast', function (done) {
    //    this.timeout(60 * 1000 * 60 * 100); //100mins
    //    manager.getMidForecast(9, config.keyString.test_cert, function (err, results) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        done();
    //    });
    //});

    //it('test mid land', function (done) {
    //    this.timeout(60 * 1000 * 60 * 100); //100mins
    //    manager.getMidLand(9, config.keyString.test_cert, function (err, results) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        done();
    //    });
    //});

    //it('test mid temp', function (done) {
    //    this.timeout(60 * 1000 * 60 * 100); //100mins
    //    manager.getMidTemp(9, config.keyString.test_cert, function (err, results) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        done();
    //    });
    //});

    //it('test mid sea', function (done) {
    //    this.timeout(60 * 1000 * 60 * 100); //100mins
    //    manager.getMidSea(9, config.keyString.test_cert, function (err, results) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        done();
    //    });
    //});
    it('test stop manager', function () {
        manager.stopManager();
    });
});


