/**
 * Created by aleckim on 18. 4. 4..
 */

"use strict";

const Logger = require('../../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

const assert  = require('assert');
const mongoose = require('mongoose');

const controllerManager = require('../../controllers/controllerManager');
global.manager = new controllerManager();

const config = require('../../config/config');

const KmaForecastZoneController = require('../../controllers/kma/kma.forecast.zone.controller');

describe('unit test - kma forecast zone controller', function() {

    before(function (done) {
        this.timeout(10 * 1000);
        mongoose.Promise = global.Promise;
        mongoose.connect('mongodb://localhost/todayweather', function (err) {
            if (err) {
                console.error('Could not connect to MongoDB!');
            }
            done();
        });
        mongoose.connection.on('error', function (err) {
            if (err) {
                console.error('MongoDB connection error: ' + err);
                done();
            }
        });
    });

    it('test send alert push list', function (done) {
        this.timeout(10*1000);
        let keyList = JSON.parse(config.keyString.dongnae_forecast_keys);
        let ctrl = new KmaForecastZoneController(keyList[0]);
        ctrl.getFromKma()
            .then(result => {
                console.info(result);
                done();
            })
            .catch(err => {
                console.error(err);
                done();
            });
    });

    it('test find forecast by regId', function (done) {
        let ctrl = new KmaForecastZoneController();
        ctrl.findForecastZoneCode({regId:"11B002P0"})
            .then(list => {
                console.info(list);
                done();
            })
            .catch(err => {
                console.error(err);
                done();
            });
    });

    it('test find forecast by near', function (done) {
        let example = {name: '서울특별시', loc: [126.980,37.563]};
        let ctrl = new KmaForecastZoneController();
        ctrl.findForecastZoneNear(example.loc)
            .then(list => {
                console.info(list);
                done();
            })
            .catch(err => {
                console.error(err);
                done();
            });
    });
});

