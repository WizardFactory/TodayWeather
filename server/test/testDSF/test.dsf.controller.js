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

let current = {dateObj : new Date("2018-07-13T08:15:04Z"), geo : [ 51.5007, -0.1288 ], address : { country : "Etc/GMT-3" },
    data : { hourly : { data : [ { dateObj : new Date("2018-07-13T08:00:00Z") }, { dateObj : new Date("2018-07-13T09:00:00Z") }, { dateObj : new Date("2018-07-13T10:00:00Z") }, { dateObj : new Date("2018-07-13T11:00:00Z") }, { dateObj : new Date("2018-07-13T12:00:00Z") }, { dateObj : new Date("2018-07-13T13:00:00Z") }, { dateObj : new Date("2018-07-13T14:00:00Z") }, { dateObj : new Date("2018-07-13T15:00:00Z") }, { dateObj : new Date("2018-07-13T16:00:00Z") }, { dateObj : new Date("2018-07-13T17:00:00Z") }, { dateObj : new Date("2018-07-13T18:00:00Z") }, { dateObj : new Date("2018-07-13T19:00:00Z") }, { dateObj : new Date("2018-07-13T20:00:00Z") }, { dateObj : new Date("2018-07-13T21:00:00Z") }, { dateObj : new Date("2018-07-13T22:00:00Z") }, { dateObj : new Date("2018-07-13T23:00:00Z") }, { dateObj : new Date("2018-07-14T00:00:00Z") }, { dateObj : new Date("2018-07-14T01:00:00Z") }, { dateObj : new Date("2018-07-14T02:00:00Z") }, { dateObj : new Date("2018-07-14T03:00:00Z") }, { dateObj : new Date("2018-07-14T04:00:00Z") }, { dateObj : new Date("2018-07-14T05:00:00Z") }, { dateObj : new Date("2018-07-14T06:00:00Z") }, { dateObj : new Date("2018-07-14T07:00:00Z") }, { dateObj : new Date("2018-07-14T08:00:00Z") }, { dateObj : new Date("2018-07-14T09:00:00Z") }, { dateObj : new Date("2018-07-14T10:00:00Z") }, { dateObj : new Date("2018-07-14T11:00:00Z") }, { dateObj : new Date("2018-07-14T12:00:00Z") }, { dateObj : new Date("2018-07-14T13:00:00Z") }, { dateObj : new Date("2018-07-14T14:00:00Z") }, { dateObj : new Date("2018-07-14T15:00:00Z") }, { dateObj : new Date("2018-07-14T16:00:00Z") }, { dateObj : new Date("2018-07-14T17:00:00Z") }, { dateObj : new Date("2018-07-14T18:00:00Z") }, { dateObj : new Date("2018-07-14T19:00:00Z") }, { dateObj : new Date("2018-07-14T20:00:00Z") }, { dateObj : new Date("2018-07-14T21:00:00Z") }, { dateObj : new Date("2018-07-14T22:00:00Z") }, { dateObj : new Date("2018-07-14T23:00:00Z") }, { dateObj : new Date("2018-07-15T00:00:00Z") }, { dateObj : new Date("2018-07-15T01:00:00Z") }, { dateObj : new Date("2018-07-15T02:00:00Z") }, { dateObj : new Date("2018-07-15T03:00:00Z") }, { dateObj : new Date("2018-07-15T04:00:00Z") }, { dateObj : new Date("2018-07-15T05:00:00Z") }, { dateObj : new Date("2018-07-15T06:00:00Z") }, { dateObj : new Date("2018-07-15T07:00:00Z") }, { dateObj : new Date("2018-07-15T08:00:00Z") } ] } }, pubDate : new Date("2018-07-13T08:15:03.712Z"), timeOffset : 180 };

let today = {dateObj : new Date("2018-07-12T21:00:00Z"), geo : [ 51.5007, -0.1288 ], address : { country : "Etc/GMT-3" }, data : { hourly : {data : [ { dateObj : new Date("2018-07-12T21:00:00Z") }, { dateObj : new Date("2018-07-12T22:00:00Z") }, { dateObj : new Date("2018-07-12T23:00:00Z") }, { dateObj : new Date("2018-07-13T00:00:00Z") }, {dateObj : new Date("2018-07-13T01:00:00Z") }, { dateObj : new Date("2018-07-13T02:00:00Z") }, { dateObj : new Date("2018-07-13T03:00:00Z") }, { dateObj : new Date("2018-07-13T04:00:00Z") }, { dateObj : new Date("2018-07-13T05:00:00Z") }, { dateObj : new Date("2018-07-13T06:00:00Z") }, { dateObj : new Date("2018-07-13T07:00:00Z") }, { dateObj : new Date("2018-07-13T08:00:00Z") }, { dateObj : new Date("2018-07-13T09:00:00Z") }, { dateObj : new Date("2018-07-13T10:00:00Z") }, { dateObj : new Date("2018-07-13T11:00:00Z") }, { dateObj : new Date("2018-07-13T12:00:00Z") }, { dateObj : new Date("2018-07-13T13:00:00Z") }, { dateObj : new Date("2018-07-13T14:00:00Z") }, { dateObj : new Date("2018-07-13T15:00:00Z") }, { dateObj : new Date("2018-07-13T16:00:00Z") }, { dateObj : new Date("2018-07-13T17:00:00Z") }, { dateObj : new Date("2018-07-13T18:00:00Z") }, { dateObj : new Date("2018-07-13T19:00:00Z") }, { dateObj : new Date("2018-07-13T20:00:00Z") } ] } }, pubDate : new Date("2018-07-13T08:15:03.712Z"), timeOffset : 180 };
let yesterday1 = {dateObj : new Date("2018-07-11T21:00:00Z"), geo : [ 51.5007, -0.1288 ],address : { country : "Etc/GMT-3" }, data : { hourly : { data : [ { dateObj : new Date("2018-07-11T21:00:00Z") }, { dateObj : new Date("2018-07-11T22:00:00Z") }, { dateObj : new Date("2018-07-11T23:00:00Z") }, { dateObj : new Date("2018-07-12T00:00:00Z") }, { dateObj : new Date("2018-07-12T01:00:00Z") }, { dateObj : new Date("2018-07-12T02:00:00Z") }, { dateObj : new Date("2018-07-12T03:00:00Z") }, { dateObj : new Date("2018-07-12T04:00:00Z") }, { dateObj : new Date("2018-07-12T05:00:00Z") }, { dateObj : new Date("2018-07-12T06:00:00Z") }, { dateObj : new Date("2018-07-12T07:00:00Z") }, { dateObj : new Date("2018-07-12T08:00:00Z") }, { dateObj : new Date("2018-07-12T09:00:00Z") }, { dateObj : new Date("2018-07-12T10:00:00Z") }, { dateObj : new Date("2018-07-12T11:00:00Z") }, { dateObj : new Date("2018-07-12T12:00:00Z") }, { dateObj : new Date("2018-07-12T13:00:00Z") }, { dateObj : new Date("2018-07-12T14:00:00Z") }, { dateObj : new Date("2018-07-12T15:00:00Z") }, { dateObj : new Date("2018-07-12T16:00:00Z") }, { dateObj : new Date("2018-07-12T17:00:00Z") }, { dateObj : new Date("2018-07-12T18:00:00Z") }, { dateObj : new Date("2018-07-12T19:00:00Z") }, { dateObj : new Date("2018-07-12T20:00:00Z") } ] }}, pubDate : new Date("2018-07-13T08:15:08.176Z"), timeOffset : 180 };
let yesterday2 = {dateObj : new Date("2018-07-11T21:00:00Z"), geo : [ 51.5007, -0.1288 ],address : { country : "Etc/GMT-3" }, data : { hourly : { data : [ { dateObj : new Date("2018-07-11T21:00:00Z") }, { dateObj : new Date("2018-07-11T22:00:00Z") }, { dateObj : new Date("2018-07-11T23:00:00Z") }, { dateObj : new Date("2018-07-12T00:00:00Z") }, { dateObj : new Date("2018-07-12T01:00:00Z") }, { dateObj : new Date("2018-07-12T02:00:00Z") }, { dateObj : new Date("2018-07-12T03:00:00Z") }, { dateObj : new Date("2018-07-12T04:00:00Z") }, { dateObj : new Date("2018-07-12T05:00:00Z") }, { dateObj : new Date("2018-07-12T06:00:00Z") }, { dateObj : new Date("2018-07-12T07:00:00Z") }, { dateObj : new Date("2018-07-12T08:00:00Z") }, { dateObj : new Date("2018-07-12T09:00:00Z") }, { dateObj : new Date("2018-07-12T10:00:00Z") }, { dateObj : new Date("2018-07-12T11:00:00Z") }, { dateObj : new Date("2018-07-12T12:00:00Z") }, { dateObj : new Date("2018-07-12T13:00:00Z") }, { dateObj : new Date("2018-07-12T14:00:00Z") }, { dateObj : new Date("2018-07-12T15:00:00Z") }, { dateObj : new Date("2018-07-12T16:00:00Z") }, { dateObj : new Date("2018-07-12T17:00:00Z") }, { dateObj : new Date("2018-07-12T18:00:00Z") }, { dateObj : new Date("2018-07-12T19:00:00Z") }, { dateObj : new Date("2018-07-12T20:00:00Z") } ] }}, pubDate : new Date("2018-07-13T08:15:08.176Z"), timeOffset : 180 };


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

    it('To test a function that support fulfilling missed dateObj', done=>{
        let dsf = new dsfController();
        dsf._findDB = (query, sort, callback)=>{
            yesterday1.data.hourly.data.splice(4,1);
            yesterday1.data.hourly.data.splice(7,1);
            callback(null, [yesterday1, yesterday2, today, current]);
        };

        let cDate = new Date("2018-07-13T08:15:04Z");
        dsf._findDataFromDB([ 51.5007, -0.1288 ], cDate, (err, result)=>{
            if(err){
                assert.fail();
                return done();
            }

            log.info(JSON.stringify(result));

            assert(result['current'], 'There is no current data');
            assert(result['today'], 'There is no today data');
            assert(result['yesterday'], 'There is no yesterday data');

            assert.deepEqual(result['current'], current, `It doesn't matched to current data`);
            assert.deepEqual(result['today'], today, `It doesn't matched to today data`);
            assert.deepEqual(result['yesterday'], yesterday2, `It doesn't matched to yesterday data`);
            done();
        });

    })

});


