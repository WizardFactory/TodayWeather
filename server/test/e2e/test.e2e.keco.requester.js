/**
 * Created by aleckim on 2017. 12. 06..
 */

"use strict";

var assert  = require('assert');
var mongoose = require('mongoose');

var Logger = require('../../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var controllerManager = require('../../controllers/controllerManager');
global.manager = new controllerManager();

var Keco  = require('../../lib/kecoRequester.js');
var config = require('../../config/config');

describe('e2e test - keco requester', function() {
    var keco;

    before(function (done) {
        this.timeout(10*1000);
        keco = new Keco();
        keco.setServiceKey(JSON.parse(config.keyString.airkorea_keys)[0]);
        keco.setDaumApiKeys(JSON.parse(config.keyString.daum_keys));
        mongoose.Promise = global.Promise;
        mongoose.connect('mongodb://localhost/todayweather', function(err) {
            if (err) {
                console.error('Could not connect to MongoDB!');
            }
            done();
        });
        mongoose.connection.on('error', function(err) {
            if (err) {
                console.error('MongoDB connection error: ' + err);
                done();
            }
        });
    });

    it('_get frcst', function (done) {
        var dataTime = { dataDate: '2017-12-06', dataHours: '11시 발표'};
        keco._getFrcst(keco.getServiceKey(), dataTime.dataDate, function (err, body) {
            if (err) {
                console.log(err);
            }
            console.log(body);
            done();
        });
    });

    it('get MD Frcst', function (done) {
        keco.getMinuDustFrcstDspth.call(keco, function (err) {
            if (err !== 'skip') {
                log.error(err);
            }
            console.log('get it done');
            done();
        });
    });
});

