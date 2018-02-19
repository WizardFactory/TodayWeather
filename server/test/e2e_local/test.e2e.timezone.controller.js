/**
 * Created by Peter on 2018. 2. 10..
 */

"use strict";

var assert  = require('assert');
var config = require('../../config/config');
var Logger = require('../../lib/log');
var convertGeocode = require('../../utils/convertGeocode');
var keybox = require('../../config/config').keyString;
var timezoneController = require('../../controllers/timezone.controller');

const mongoose = require('mongoose');

global.log  = new Logger(__dirname + "/debug.log");

describe('timezoneController', function(){
    before(function (done) {
        this.timeout(10*1000);
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

    it('timezoneController - class allocate/getter/setter', function(done){
        let tz = new timezoneController('Africa/Ndjamena');
        assert.equal('Africa/Ndjamena', tz.timezone);
        assert.equal(undefined, tz.geo);
        assert.equal(undefined, tz.timezoneOffset);
        tz.timezone = 'Europe/London';
        assert.equal('Europe/London', tz.timezone);
        done();
    });

    it('timezoneController - get geo by Timezone', function(done){
        let tz = new timezoneController('Africa/Ndjamena');
        tz._getGeoByTimezone(tz.timezone, function(err,geo){
            if(err){
                assert.fail();
                done();
            }

            let res = {lat:12.1348457, lon:15.0557415};
            log.info(geo);
            assert.equal(res.lat, geo.lat);
            assert.equal(res.lon, geo.lon);
            assert.equal(res.lat, tz.geo.lat);
            assert.equal(res.lon, tz.geo.lon);
            log.info();
            done();
        });
    });

    it('timezoneController - get Timezone Offset by geo', function(done){
        let tz = new timezoneController('Africa/Ndjamena');
        tz._getTimozoneOffsetByGeo({lat:12.1348457, lon:15.0557415}, function(err,timezoneOffset){
            if(err){
                assert.fail();
                done();
            }

            log.info('Timezone Offset(min) :', timezoneOffset);
            assert.equal(60, timezoneOffset);
            assert.equal(60, tz.timezoneOffset);
            log.info();
            done();
        });
    });

    it('timezoneController - update Timezone Data', function(done){
        let tz = new timezoneController('Africa/Ndjamena');
        tz.timezoneOffset = 60;
        tz.geo = {lat:12.1348457, lon:15.0557415};

        tz._updateTimezone(tz, function(err, result){
            if(err){
                assert.fail();
                done();
            }

            assert.equal(tz.timezone, result.timezone);
            assert.equal(tz.timezoneOffset, result.timezoneOffset);
            assert.equal(tz.geo.lon, result.geo[0]);
            assert.equal(tz.geo.lat, result.geo[1]);
            log.info();
            done();
        });
    });

    it('timezoneController - requestTimezoneOffset - new Req', function(done){
        let tz = new timezoneController('Africa/Ndjamena');

        tz._removeTimezone(tz.timezone);

        tz.requestTimezoneOffset(undefined, 'get', function(err, timezoneOffset){
            if(err){
                assert.fail();
                done();
            }
            log.info('TZ offset :', tz.timezoneOffset);
            log.info('TZ geo :', tz.geo);
            log.info('TZ timezone :', tz.timezone);
            log.info('TZ updatedAt : ', tz.updatedAt.toString());

            let res = {lat:12.1348457, lon:15.0557415};
            assert.equal(60, timezoneOffset);
            assert.equal(60, tz.timezoneOffset);
            assert.equal('Africa/Ndjamena', tz.timezone);
            assert.equal(res.lat, tz.geo.lat);
            assert.equal(res.lon, tz.geo.lon);

            log.info();
            done();
        })
    });

    it('timezoneController - requestTimezoneOffset - DB Query', function(done){
        let tz = new timezoneController('Africa/Ndjamena');

        tz.requestTimezoneOffset(undefined, undefined, function(err, timezoneOffset){
            if(err){
                assert.fail();
                done();
            }
            log.info('TZ offset :', tz.timezoneOffset);
            log.info('TZ geo :', tz.geo);
            log.info('TZ timezone :', tz.timezone);
            log.info('TZ updatedAt : ', tz.updatedAt.toString());

            let res = {lat:12.1348457, lon:15.0557415};
            assert.equal(60, timezoneOffset);
            assert.equal(60, tz.timezoneOffset);
            assert.equal('Africa/Ndjamena', tz.timezone);
            assert.equal(res.lat, tz.geo.lat);
            assert.equal(res.lon, tz.geo.lon);

            log.info();
            done();
        });
    });

    it('timezoneController - requestTimezoneOffset - DB Query', function(done){
        let tz = new timezoneController('Europe/London');

        tz.requestTimezoneOffset(undefined, undefined, function(err, timezoneOffset){
            if(err){
                assert.fail();
                done();
            }
            log.info('TZ offset :', tz.timezoneOffset);
            log.info('TZ geo :', tz.geo);
            log.info('TZ timezone :', tz.timezone);
            log.info('TZ updatedAt : ', tz.updatedAt.toString());

            let res = {lat:51.5073509, lon:-0.1277583};
            assert.equal(0, timezoneOffset);
            assert.equal(0, tz.timezoneOffset);
            assert.equal('Europe/London', tz.timezone);
            assert.equal(res.lat, tz.geo.lat);
            assert.equal(res.lon, tz.geo.lon);

            log.info();
            done();
        });
    });

    it('timezoneController - updateTimezoneList - DB Query', function(done){
        let tz = new timezoneController();
        tz._interval = 3 * 1000; // 10 sec for testing
        tz.maintain(function(){
            done();
        });
    });
});
