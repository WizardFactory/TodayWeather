/**
 * Created by aleckim on 2018. 03. 16..
 */

"use strict";

const controllerKmaStnWeather = require('../../controllers/controllerKmaStnWeather');
const Town = require('../../models/town');

const assert  = require('assert');
const mongoose  = require('mongoose');
const async = require('async');

const Logger = require('../../lib/log');

global.log  = new Logger(__dirname + "/debug.log");

describe('e2e test - ', function() {
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

    it('..', function(done) {
        this.timeout(60*1000*30);
        async.waterfall([
                callback => {
                    Town.find({}, {_id:0}).lean().exec(callback);
                },
                (list, callback) => {
                    console.info('town length='+list.length);
                    async.mapLimit(list, 20,
                        (townInfo, callback)=> {
                            console.info(townInfo.town);
                            let coords = [townInfo.gCoord.lon, townInfo.gCoord.lat];
                            controllerKmaStnWeather.getStnList(coords, 0.1, undefined, 5, (err, results)=> {
                                if (err) {
                                    return callback(null, {town: townInfo, err:err});
                                }
                                callback(null, {town: townInfo, results:results});
                            });
                        },
                        callback);
                }
            ],
            (err, results) => {
                let validCount= 0;
                results.forEach(obj => {
                    if (obj.results && obj.results.length >= 2) {
                        console.info({town: obj.town.town, stnCount: obj.results.length});
                        validCount++;
                    }
                    else {
                        if (obj.results) {
                            console.error({town: obj.town.town, stnCount: obj.results.length});
                        }
                        else {
                            console.error({town: obj.town.town, stnCount: 0});
                        }
                    }
                });
                console.info('validCount:'+validCount);
                done();
            });
    });
});
