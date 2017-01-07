/**
 * Created by aleckim on 2016. 4. 2..
 */


"use strict";

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var assert  = require('assert');

var Scrape = require('../lib/kmaScraper');

describe('unit test - kma city weather scraping', function() {
    //it('test get city weather', function(done) {
    //    var scrape = new Scrape();
    //    scrape.getCityWeather(function (err, data) {
    //        if (err) {
    //            console.log(err);
    //        }
    //        //console.log(JSON.stringify(data));
    //        done();
    //    });
    //});

    //make for gathering weather description of kma
    //it('test get city weather from 2015.01.01.01:00', function(done) {
    //    this.timeout(1000*60*60*12);
    //
    //    var scrape = new Scrape();
    //    var weatherList = [];
    //    function _findWeather(weather) {
    //        for (var i=0; i<weatherList.length; i++) {
    //            if (weather == weatherList[i]) {
    //                return true;
    //            }
    //        }
    //        return false;
    //    }
    //
    //    var controllerManager = require('../controllers/controllerManager');
    //    global.manager = new controllerManager();
    //    var date = new Date("2015.01.01.01:00");
    //    var kmaTimeLib = require('../lib/kmaTimeLib');
    //
    //    function _recursiveGetCityWeather(date) {
    //
    //        var dateStr = kmaTimeLib.convertDateToYYYYoMMoDDoHHoZZ(date);
    //        console.log(dateStr);
    //        scrape.getCityWeather(undefined, function (err, data) {
    //            if (err) {
    //                console.log(err);
    //            }
    //            if (!data.hasOwnProperty('cityList')) {
    //                _recursiveGetCityWeather(date);
    //                return;
    //            }
    //            data.cityList.forEach(function (city) {
    //                if (!_findWeather(city.weather)) {
    //                    weatherList.push(city.weather);
    //                }
    //            });
    //
    //            console.log(JSON.stringify(weatherList));
    //
    //            if (date.getTime() < (new Date()).getTime()) {
    //                date.setHours(date.getHours()+1);
    //                _recursiveGetCityWeather(date);
    //            }
    //            else {
    //                weatherList.push('END');
    //                console.log(JSON.stringify(weatherList));
    //                done();
    //            }
    //        }, dateStr);
    //    }
    //
    //    _recursiveGetCityWeather(date);
    //});

    //it('test get aws weather', function (done) {
    //    var scrape = new Scrape();
    //    scrape.getAWSWeather('hourly', '2016', function (err, results) {
    //        if (err) {
    //            console.log(err);
    //        }
    //        //console.log(JSON.stringify(results));
    //        done();
    //    });
    //});

    //it('test _recursiveConvertGeoCode', function (done) {
    //    this.timeout(10*1000);
    //    var scrape = new Scrape();
    //    var isDone = false;
    //    scrape._recursiveConvertGeoCode('', 10, function (err, result) {
    //       if (err)  {
    //           log.error(err);
    //       }
    //        if (isDone) {
    //           log.error('recvd !!!');
    //        }
    //        else {
    //           isDone = true;
    //            log.error(new Error('first recvd !!!'));
    //        }
    //        //log.info(result);
    //        done();
    //    });
    //});

    //it('test get aws weather', function (done) {
    //    var scrape = new Scrape();
    //    scrape.getAWSWeather('min', '', function (err, results) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        log.info(results);
    //        done();
    //    });
    //});

    //it('test get kma stn weather info', function (done) {
    //    this.timeout( 30*1000);
    //
    //    var controllerManager = require('../controllers/controllerManager');
    //    global.manager = new controllerManager();
    //
    //    var mongoose = require('mongoose');
    //    mongoose.connect('localhost/todayweather', function(err) {
    //        if (err) {
    //            console.error('Could not connect to MongoDB!');
    //            console.log(err);
    //        }
    //    });
    //    mongoose.connection.on('error', function(err) {
    //        console.error('MongoDB connection error: ' + err);
    //    });
    //
    //    var scrape = new Scrape();
    //    scrape.getStnHourlyWeather(function (err, results) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        log.info(results);
    //        done();
    //    });
    //});

    //it('test get kma stn weather info', function (done) {
    //    this.timeout( 24*1000*60*60);
    //
    //    var controllerManager = require('../controllers/controllerManager');
    //    global.manager = new controllerManager();
    //
    //    log.info('connect db');
    //    var mongoose = require('mongoose');
    //    mongoose.connect('localhost/todayweather', function(err) {
    //        if (err) {
    //            console.error('Could not connect to MongoDB!');
    //            console.log(err);
    //        }
    //    });
    //    mongoose.connection.on('error', function(err) {
    //        console.error('MongoDB connection error: ' + err);
    //    });
    //
    //    var scrape = new Scrape();
    //    scrape.getStnPastHourlyWeather(8, function (err, results) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        log.info(results);
    //        done();
    //    });
    //});

    //it('test get kma stn weather info', function (done) {
    //    this.timeout( 30*1000);
    //
    //    var controllerManager = require('../controllers/controllerManager');
    //    global.manager = new controllerManager();
    //
    //    var mongoose = require('mongoose');
    //    mongoose.connect('localhost/todayweather', function(err) {
    //        if (err) {
    //            console.error('Could not connect to MongoDB!');
    //            console.log(err);
    //        }
    //    });
    //    mongoose.connection.on('error', function(err) {
    //        console.error('MongoDB connection error: ' + err);
    //    });
    //
    //    var scrape = new Scrape();
    //    scrape.getStnMinuteWeather(function (err, results) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        log.info(results);
    //        done();
    //    });
    //});

    //it('test update rns hit rate', function (done) {
    //    this.timeout( 30*1000);
    //
    //    var controllerManager = require('../controllers/controllerManager');
    //    global.manager = new controllerManager();
    //
    //    var mongoose = require('mongoose');
    //    mongoose.connect('localhost/todayweather', function(err) {
    //        if (err) {
    //            console.error('Could not connect to MongoDB!');
    //            console.log(err);
    //        }
    //    });
    //    mongoose.connection.on('error', function(err) {
    //        console.error('MongoDB connection error: ' + err);
    //    });
    //
    //    var scrape = new Scrape();
    //    scrape.updateRnsHitRates(function (err) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        done();
    //    });
    //});

    //it('test reset rns hit rate', function (done) {
    //    this.timeout( 30*1000);
    //
    //    var controllerManager = require('../controllers/controllerManager');
    //    global.manager = new controllerManager();
    //
    //    var mongoose = require('mongoose');
    //    mongoose.connect('localhost/todayweather', function(err) {
    //        if (err) {
    //            console.error('Could not connect to MongoDB!');
    //            console.log(err);
    //        }
    //    });
    //    mongoose.connection.on('error', function(err) {
    //        console.error('MongoDB connection error: ' + err);
    //    });
    //
    //    var scrape = new Scrape();
    //    scrape.resetRnsHitRates(function (err) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        done();
    //    });
    //});

    //it('test add stn address to towns', function (done) {
    //    this.timeout( 100*1000);
    //
    //    var controllerManager = require('../controllers/controllerManager');
    //    global.manager = new controllerManager();
    //
    //    var mongoose = require('mongoose');
    //    mongoose.connect('localhost/todayweather2', function(err) {
    //        if (err) {
    //            console.error('Could not connect to MongoDB!');
    //            console.log(err);
    //        }
    //    });
    //    mongoose.connection.on('error', function(err) {
    //        console.error('MongoDB connection error: ' + err);
    //    });
    //
    //    var scrape = new Scrape();
    //    scrape.addStnAddressToTown(function(err, results) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        done();
    //    });
    //});

    //it('test reset mountain info', function (done) {
    //    this.timeout( 300*1000);
    //
    //    var controllerManager = require('../controllers/controllerManager');
    //    global.manager = new controllerManager();
    //
    //    var mongoose = require('mongoose');
    //    mongoose.connect('localhost/todayweather', function(err) {
    //        if (err) {
    //            console.error('Could not connect to MongoDB!');
    //            console.log(err);
    //        }
    //    });
    //    mongoose.connection.on('error', function(err) {
    //        console.error('MongoDB connection error: ' + err);
    //    });
    //
    //    var scrape = new Scrape();
    //    scrape.resetMoutainInfo(function (err) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        done();
    //    });
    //});
});

