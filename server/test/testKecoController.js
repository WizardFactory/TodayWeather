/**
 * Created by aleckim on 15. 11. 4..
 */

"use strict";

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var assert  = require('assert');

var kecoController = require('../controllers/kecoController');

describe('unit test - keco controller', function() {
    var mongoose = require('mongoose');
    mongoose.connect('localhost/todayweather', function(err) {
        if (err) {
            console.error('Could not connect to MongoDB!');
            console.log(err);
        }
    });
    mongoose.connection.on('error', function(err) {
        console.error('MongoDB connection error: ' + err);
    });

    it('test _convertDustFrcstRegion', function () {
        var controllerManager = require('../controllers/controllerManager');
        global.manager = new controllerManager();
        var siDo;
        siDo = kecoController._convertDustFrcstRegion('강원도','강릉시');
        assert.equal(siDo, '영동', '');
    });

    it('test get dust forecast', function (done) {
        var dateList = ['20160331', '20160401', '20160402', '20160403', '20160404'];
       kecoController.getDustFrcst({region:'강원도', city:'강릉시'}, dateList, function (err, results) {
           if (err) {
               console.log(err);
           }
           console.log(results);
           done();
       });
    });
    //it('test get arpltn info', function (done) {
    //    var town = { "first" : "경기도", "second" : "성남시분당구", "third" : "수내1동"};
    //    kecoController.getArpLtnInfo(town, new Date(), function (err, arpltn) {
    //        if (err) {
    //            log.error (err);
    //        }
    //        console.log(JSON.stringify(arpltn));
    //        done();
    //    });
    //});

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


