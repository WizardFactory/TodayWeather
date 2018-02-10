/**
 * Created by aleckim on 2018. 2. 1..
 */

"use strict";

var Logger = require('../../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var controllerManager = require('../../controllers/controllerManager');
global.manager = new controllerManager();

var assert  = require('assert');
var config = require('../../config/config');
var LifeIndexKmaRequester  = require('../../lib/lifeIndexKmaRequester');

describe('unit test - requester of kma index service class', function() {
    var reqLifeIndex = new LifeIndexKmaRequester();

    reqLifeIndex.setServiceKey(config.keyString.cert_key, config.keyString);

    it ('get fsn life index', function (done) {
        reqLifeIndex.getLifeIndex2('fsn', function (err, body) {
            assert.equal(body.Response.header.successYN, 'Y', '');
            done();
        });
    });

    // it ('get ultrv life index', function (done) {
    //     co.getLifeIndex('ultrv', '1100000000', function (err, body) {
    //         assert.equal(body.Response.header.successYN, 'Y', '');
    //         done();
    //     });
    // });

    it('update Life Index Db From Towns', function (done) {
        this.timeout(30*1000);
        var mongoose = require('mongoose');
        mongoose.connect('localhost/todayweather', function(err) {
            if (err) {
                console.error('Could not connect to MongoDB!');
                console.log(err);
                done();
            }
        });
        mongoose.connection.on('error', function(err) {
            console.error('MongoDB connection error: ' + err);
        });

        reqLifeIndex.setNextGetTime('fsn', new Date());
        reqLifeIndex.taskLifeIndex2('fsn', function (err, result) {
            if (err) {
                log.error(err.toString());
                return done();
            }
            log.info(result);
            done();
        });
    });
});


