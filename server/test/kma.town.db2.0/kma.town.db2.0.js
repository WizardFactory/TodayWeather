/**
 * Created by Peter on 2017. 10. 7..
 */


var wrRequester = require('../../lib/WU/wuRequester');
var assert  = require('assert');
var config = require('../../config/config');
var Logger = require('../../lib/log');
var convertGeocode = require('../../utils/convertGeocode');
var keybox = require('../../config/config').keyString;
var util = require('util');
var async = require('async');
var collectTown = require('../../lib/collectTownForecast');
var test_key = require('../../config/config').keyString.test_normal;
var mongoose = require('mongoose');

var kecoController = require('../../controllers/kecoController');

global.log  = new Logger(__dirname + "/debug.log");

var controllerManager = require('../../controllers/controllerManager');
var town = require('../../models/town');
var modelCurrent = require('../../models/modelCurrent');

var kmaTownShortRss = new (require('../../controllers/kma/kma.town.short.rss.controller.js'));
var libMidRss = require('../../lib/midRssKmaRequester');

var options = { server: { socketOptions: { keepAlive: 1, connectTimeoutMS: 30000 } },
    replset: { socketOptions: { keepAlive: 1, connectTimeoutMS : 30000 } },
    mongos: true };

mongoose.Promise = global.Promise;
mongoose.connect(config.db.path, options, function(err) {
    if (err) {
        log.error('Could not connect to MongoDB! ' + config.db.path);
        log.error(err);
    }
});

var manager = new controllerManager();


String.prototype.hashCode = function(){
    var hash = 0;
    if (this.length == 0) return hash;
    for (i = 0; i < this.length; i++) {
        char = this.charCodeAt(i);
        hash = ((hash<<5)-hash)+char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
};

describe('test KMA DB 2.0', function(){
/*
    it('process gathering current', function(done){
        town.getCoord = function(cb){
            var list = [
                {mx: 91, my: 131},
                {mx: 55, my: 119}
            ];

            cb(0, list);
        };

        manager.getTownCurrentData(9, test_key, function(err, result){
            if(err){
                log.info('Fail to gather current');
                return done();
            }

            log.info('Success to gather current');
            done();
        });
    });


    it('process gathering short', function(done){
        town.getCoord = function(cb){
            var list = [
                {mx: 91, my: 131},
                {mx: 55, my: 119}
            ];

            cb(0, list);
        };

        manager.getTownShortData(9, test_key, function(err, result){
            if(err){
                log.info('Fail to gather short');
                return done();
            }

            log.info('Success to gather short');
            done();
        });
    });

    it('process gathering shortest', function(done){
        town.getCoord = function(cb){
            var list = [
                {mx: 91, my: 131},
                {mx: 55, my: 119}
            ];

            cb(0, list);
        };

        manager.getTownShortestData(9, test_key, function(err, result){
            if(err){
                log.info('Fail to gather short');
                return done();
            }

            log.info('Success to gather short');
            done();
        });
    });

    it('process gathering short rss', function(done){
        town.getCoord = function(cb){
            var list = [
                {mx: 91, my: 131},
                {mx: 55, my: 119}
            ];

            cb(0, list);
        };

        kmaTownShortRss.mainTask(function() {
            log.info('Success to gater short rss');
            done();
        });
    });
*/
    /*
    it('process gathering mid forecast', function(done) {
        manager.getMidForecast(9, test_key, function (err) {
            if (err) {
                log.error(err);
            }
            log.info('Success to get mid forecast');
            done();
        });
    });

    it('process gathering mid Land', function(done) {

        manager.getMidLand(9, test_key, function (err) {
            if (err) {
                log.error(err);
            }
            log.info('Success to get mid land');
            done();
        });
    });

    it('process gathering mid Temp', function(done) {

        manager.getMidTemp(9, test_key, function (err) {
            if (err) {
                log.error(err);
            }
            log.info('Success to get mid temp');
            done();
        });
    });

    it('process gathering mid Sea', function(done) {

        manager.getMidSea(9, test_key, function (err) {
            if (err) {
                log.error(err);
            }
            log.info('Success to get mid sea');
            done();
        });
    });
    */
    it('process gathering mid rss', function(done) {

        var midRequester = new libMidRss();
        midRequester.mainProcess(midRequester, function (err) {
            if (err) {
                log.error(err);
            }
            log.info('Success to get mid rss');
            done();
        });
    });
});