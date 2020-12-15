/**
 * Created by aleckim on 2017. 12. 06..
 */

"use strict";

var assert  = require('assert');
var mongoose = require('mongoose');

var Logger = require('../../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var controllerManager = require('../../controllers/controllerManager');
global.manager = new controllerManager();

var Keco  = require('../../lib/kecoRequester.js');
var config = require('../../config/config');

describe('e2e test - keco requester', function() {
    var keco;

    before(function (done) {
        this.timeout(10*1000);
        keco = new Keco();
        keco.setServiceKeys(JSON.parse(config.keyString.airkorea_keys));
        keco.setDaumApiKeys(JSON.parse(config.keyString.daum_keys));
        keco.setKakaoApiKeys(JSON.parse(config.keyString.kakao_keys));
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

    it('_check data time', function (done) {
        keco._checkDataTime(function (err, result) {
            if (err) {
                console.log(err);
            }
            console.log(result);
            done();
        });
    });

    it('_get frcst', function (done) {
        var dataTime = { dataDate: '2017-12-06', dataHours: '11시 발표'};
        keco._getFrcst(dataTime.dataDate, function (err, body) {
            if (err) {
                console.log(err);
            }
            console.log(body);
            done();
        });
    });

    it('get MD Frcst', function (done) {
        keco.getMinuDustFrcstDspth.call(keco, function (err) {
            if (err !== 'skip') {
                log.error(err);
            }
            console.log('get it done');
            done();
        });
    });

    it('remove MD Frcst', function (done) {
        keco.removeMinuDustFrcst.call(keco, function (err) {
            if (err) {
                log.error(err);
            }
            console.log('get it done');
            done();
        });
    });

    it('get real time ctprvn', function (done) {
        // var async = require('async');
        // async.retry(100,
        //     function (callback) {
        //         keco.getCtprvn("서울", function (err, body) {
        //             if (err) {
        //                 console.error(err);
        //             }
        //             console.info(body);
        //             callback(1);
        //         });
        //     },
        //     function (err, result) {
        //        console.log(err, result);
        //     });

        keco.getRLTMCtprvn("서울", function (err, body) {
            if (err) {
                console.error(err);
            }
            console.info(body);
            done();
        });
    });

    it('get Near By Msrstn', function (done) {
        this.timeout(10*1000);
        var tmCoord = {"y":476266.59248414496,"x":369036.86549488344};
        keco.getNearbyMsrstn(tmCoord.y, tmCoord.x, function (err, body) {
            if (err) {
                console.log(err);
                return done();
            }

            keco.getStationNameFromMsrstn(body, function (err, result) {
                if (err) {
                    console.log(err);
                    return done();
                }
                console.log(result);
                done();
            });
        });
    });

    it ('get Msrstn List', function (done) {
        keco.getMsrstnList(function (err, body) {
            if (err) {
                console.log(err);
            }
            assert.equal('number', typeof body.list.length, 'Fail to get length of msr stn list');
            done();
        });
    });

    //강릉시, 강동면 , 37.7254,128.9565111 -> tmX 373627.403952, tmY 465928.44815,
    it('convert WGS84 to TM', function (done) {
        this.timeout(10*1000);
        keco.getTmPointFromWgs84(keco._kakaoApiKeys, 37.773315, 128.919327, function (err, body) {
            console.log(body);
            done();
        });
    });

    it('get All data from keco', function(done) {
        this.timeout(60*1000); //1min

        var Arpltn = require('../../models/arpltnKeco');

        keco.getAllCtprvn(['서울'], null, function(err) {
            if (err) {
                console.log(err);
                return done();
            }

            Arpltn.find({}, function(err, arpltnList) {
                if(err) {
                    console.log(err);
                    return done();
                }
                console.log(arpltnList);
                done();
            });
        });
    });

    it ('get all msr stn list', function (done) {
        this.timeout(10*60*1000);

        keco.getAllMsrStnInfo(function (err, result) {
            if (err) {
                log.error(err);
            }
            console.log('saved msr stn list len=', result.length);
            assert.equal('number', typeof result.length, 'Fail to get all msr stn list');
            done();
        });
    });

    // it('save msr stn list', function (done) {
    //
    //     var coords = parsedList[1].geo;
    //
    //     keco.saveMsrstnList(parsedList, function(err, results) {
    //         if (err) {
    //             console.log(err);
    //         }
    //
    //         assert.equal(1, results[results.length-1].ok, 'Fail to save msr stn list');
    //         done();
    //
    //         //var MsrStn = require('../models/modelMsrStnInfo.js');
    //         //console.log(coords);
    //         //
    //         //MsrStn.find({geo: {$near:coords, $maxDistance: 1}}).lean().exec(function (err, msrStnList) {
    //         //    if (err) {
    //         //        console.log(err);
    //         //    }
    //         //    console.log(JSON.stringify(msrStnList));
    //         //    done();
    //         //});
    //     });
    // });

    it('get sido ctprvn', function (done) {
        keco.getCtprvn("서울", 'getCtprvnMesureSidoLIst', function (err, body) {
            if (err) {
                console.error(err);
            }
            console.info(body);
            done();
        });
    });

    it('get sido data from keco', function(done) {
        this.timeout(60*1000); //1min

        var SidoArpltn = require('../../models/sido.arpltn.keco.model');

        keco.getSidoCtprvn(['서울'], null, function(err) {
            if (err) {
                console.log(err);
                return done();
            }

            SidoArpltn.find({}, function(err, sidoArpltnList) {
                if(err) {
                    console.log(err);
                    return done();
                }
                console.log(sidoArpltnList);
                done();
            });
        });
    });

    after(function () {
        mongoose.disconnect();
    });
});

