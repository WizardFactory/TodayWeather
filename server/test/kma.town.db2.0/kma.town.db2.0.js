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


describe('test KMA DB 2.0', function(){

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
});