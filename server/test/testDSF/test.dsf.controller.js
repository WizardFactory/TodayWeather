/**
 * Created by Peter on 2018. 5. 16..
 */
"use strict";

const assert  = require('assert');
const config = require('../../config/config');
const mongoose = require('mongoose');
const dsfController = require('../../controllers/worldWeather/dsf.controller');
const Logger = require('../../lib/log');
const dsfModel = require('../../models/worldWeather/dsf.model');

global.log  = new Logger(__dirname + "/debug.log");

describe('DSF Controller', function() {
    before(function (done) {
        this.timeout(10*1000);
        mongoose.Promise = global.Promise;
        mongoose.connect('mongodb://localhost/testDSF', function(err) {
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

    let fnDataReceive = function(cDate, callback){
        let dsf = new dsfController;
        let req = {
            geocode: {
                lon: 51.5007,
                lat: -0.1288
            }
        };

        dsf.getDsfData(req, cDate, function(err){
            if(err){
                log.info('Fail to get DSF');
                return done();
            }

            log.info('DSF Data : ', JSON.stringify(req.DSF));

            return callback(dsf);
        });
    };

    it('check basic data receive', function(done){
        let cDate = new Date();
        fnDataReceive(cDate, function(dsf){
            done();
        });
    });

    it('check remove all', function(done){
        let cDate = new Date();
        fnDataReceive(cDate, function(dsf){
            dsf._removePastData(0, function(err){

                dsfModel.count({}).exec(function(err, count){
                    log.info('Data Count :', count);
                    assert.equal(count, 0, 'The data count should be 0');
                    done();
                });
            });
        });
    });

    it('check remove data of yesterday', function(done){
        let cDate = new Date();
        fnDataReceive(cDate, function(dsf){
            dsf._removePastData(1, function(err){

                dsfModel.count({}).exec(function(err, count){
                    log.info('Data Count :', count);
                    assert.equal(count, 2, 'The data count should be 2');
                    done();
                });
            });
        });
    });

    it('check remove past data', function(done){
        let cDate = new Date();
        fnDataReceive(cDate, function(dsf){
            dsf._removePastData(2, function(err){

                dsfModel.count({}).exec(function(err, count){
                    log.info('Data Count :', count);
                    assert.equal(count, 3, 'The data count should be 3');
                    done();
                });
            });
        });
    });

    it('To test get timeoffset with unknown timezone', function(done){
        let dsf = new dsfController;

        dsf._getTimeOffset('ETC/GMT-9', [51.5007,-0.1288], (err, tzOffset)=>{
            if(err){
                assert.fail();
                done();
            }

            log.info(tzOffset);
            assert.equal(tzOffset, 540, 'Time Offset should be 9');

            done();
        });
    });

    it('To test get timeoffset by using geocode', function(done){
        let dsf = new dsfController;
        dsf._getTimeOffset('ETC/GMT-1', [127.2025, 37.3914], (err, tzOffset)=>{
            if(err){
                assert.fail();
                return done();
            }

            log.info(tzOffset);
            assert.equal(tzOffset, 540, 'Time Offset should be 9');

            done();
        });
    });
});


