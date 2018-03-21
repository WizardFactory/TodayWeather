/**
 * Created by aleckim on 18. 3. 20..
 */

"use strict";

const Logger = require('../../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

const controllerManager = require('../../controllers/controllerManager');
global.manager = new controllerManager();

const assert  = require('assert');
const mongoose = require('mongoose');

const KaqHourlyForecastController = require('../../controllers/kaq.hourly.forecast.controller');


describe('e2e test - kaq hourly forecast controller', function() {
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

    it('test kaq hourly forecast do', function (done) {
        this.timeout(10*60*1000);
        let ctrl = new KaqHourlyForecastController();
        ctrl.do(new Date(), err=> {
            if (err) {
                console.error(err);
            }
            done();
        });
    });
});

