/**
 * Created by aleckim on 2015. 10. 24..
 */

"use strict";

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var assert  = require('assert');
var Keco  = require('../controllers/kecoController.js');

describe('unit test - keco controller', function() {
    var keco;
    var list;

    it('create keco service', function () {
        keco = new Keco();
        assert.equal(keco._currentSidoIndex, 0, '');
    });
    it('set key', function () {
        var key = require('../config/keydata.js').keyString.kay;
        keco.setServiceKey(key);
        assert.equal(key, keco.getServiceKey(), '');
    });
    it('get sido list', function () {
        list = keco.getCtprvnSidoList();
        assert.equal(list.length, keco._sidoList.length, '');
    });
    it('get Ctpvn url', function () {
        var url = keco.getUrlCtprvn(keco._sidoList[0]);
        assert.notEqual(url.search('sidoName'), -1, '');
    });
    it('update time to get Ctpvn', function () {
        var time = new Date();
        time.setHours(time.getHours()+1);
        keco.updateTimeGetCtprvn();
        assert.equal(keco._nextGetCtprvnTime.getHours(), time.getHours(), '');
    });
    it('check time to get Ctpvn', function () {
        assert.equal(keco.checkGetCtprvnTime(new Date()), false, '');
    });

    //it('get data from keco', function (done) {
    //     keco.getCtprvn(keco.getServiceKey(), keco._sidoList[0], function (err, body) {
    //         console.log(body);
    //         done();
    //     });
    //});

    //강릉시, 강동면 , 37.7254,128.9565111 -> tmX 373627.403952, tmY 465928.44815,
    //it('convert WGS84 to TM', function (done) {
    //    this.timeout(10*1000);
    //    keco.getTmPointFromWgs84(keco._daumApiKey, 37.773315, 128.919327, function (err, body) {
    //       console.log(body);
    //        done();
    //    });
    //});

    it('parse Near By Msrstn', function (done) {
        var body = '<?xml version="1.0" encoding="UTF-8"?>'+
            '<response> <header> <resultCode>00</resultCode> <resultMsg>NORMAL SERVICE.</resultMsg> </header>'+
            '<body> <items> <item> <stationName>옥천동</stationName> <addr>강원 강릉시 옥천동327-2(옥천동주민센터)</addr> '+
            '<tm>2.1</tm> </item> <item> <stationName>천곡동</stationName> <addr>강원 동해시 천곡동806 (동해시청 4층 옥상)'+
            '</addr> <tm>32.5</tm> </item> <item> <stationName>남양동1</stationName> '+
            '<addr>강원 삼척시 남양동339-1 (남양동 주민센터 3층 옥상)</addr> <tm>42.8</tm> </item> </items> '+'' +
            '<numOfRows>999</numOfRows> <pageNo>1</pageNo> <totalCount>3</totalCount> </body> </response>';

        keco.parseMsrstn(body, function (err, result) {
            if (err) {
                console.error(err);
            }
            else {
                assert.equal(result, '옥천동', '');
            }
            done();
        });
    });

    //it('load town list', function(done) {
    //    this.timeout(60*1000); //1min
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
    //        process.exit(-1);
    //    });
    //
    //    keco.loadTownList(function (err, townList) {
    //        console.log(err);
    //        console.log(townList.length);
    //        done();
    //    });
    //});

       // it('get Near By Msrstn', function (done) {
   //
   //     this.timeout(10*1000);
   //     var tmCoord = {"y":476266.59248414496,"x":369036.86549488344};
   //
   //     keco.getNearbyMsrstn(keco.getServiceKey(), tmCoord.y, tmCoord.x, function (err, body) {
   //         if (err) {console.log(err);}
   //
   //         keco.parseMsrstn(body, function (err, result) {
   //             console.log(err);
   //             console.log(result);
   //             done();
   //         });
   //     });
   //});

    it('add msrstn info to town', function(done) {
        this.timeout(60*1000*10); //10min

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
            done();
        });

        keco.setDaumApiKey(require('../config/keydata.js').keyString.daum_key);

        keco.addMsrstnInfoToTown(function (err, result) {
            if (err) {
                console.log(err);
            }
            else {
                console.log(result);
            }

            mongoose.disconnect();
            done();
        });
    });

    //it('get All data from keco', function(done) {
    //    this.timeout(60*1000); //1min
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
    //        process.exit(-1);
    //    });
    //
    //    var Arpltn = require('../models/arpltn.keco');
    //
    //    keco.getAllCtprvn(['서울'], null, function(err) {
    //        if (err) console.log(err);
    //
    //        Arpltn.find({}, function(err, arpltnList) {
    //            if(err) console.log(err);
    //            //console.log(arpltnList);
    //            mongoose.disconnect();
    //            done();
    //        });
    //    });
    //});

    //it('save arpltn.town', function (done) {
    //    this.timeout(60*1000);
    //
    //    var mongoose = require('mongoose');
    //    mongoose.connect('localhost/todayweather', function(err) {
    //        if (err) {
    //            console.error('Could not connect to MongoDB!');
    //            done();
    //        }
    //    });
    //    mongoose.connection.on('error', function(err) {
    //        if (err) {
    //            console.error('MongoDB connection error: ' + err);
    //            done();
    //        }
    //    });
    //
    //    var Town = require('../models/town');
    //    var Arpltn = require('../models/arpltn.keco');
    //    var ArpltnTown = require('../models/arpltn.town.keco');
    //
    //    Town.find({}, function(err, townList) {
    //        var town = townList[0];
    //        town.kecoStationName = '영등포구';
    //        console.log(town.toString());
    //
    //        Arpltn.findOne({stationName: town.kecoStationName}, function (err, arpltn) {
    //            console.log(arpltn.toString());
    //            keco.saveArpltnTown(town, arpltn, function (err, raw) {
    //                if (err) {
    //                    console.log(err);
    //                    return done();
    //                }
    //                console.log(raw);
    //
    //                ArpltnTown.findOne({}, function (err, arpltntown) {
    //                    console.log("findONE!!");
    //                    console.log(arpltntown.town);
    //                    console.log(arpltntown.arpltn);
    //                    done();
    //                });
    //            });
    //        });
    //    });
    //});

    //it('update arpltn.town', function (done) {
    //   this.timeout(60*1000);
    //
    //    var mongoose = require('mongoose');
    //    mongoose.connect('localhost/todayweather', function(err) {
    //        if (err) {
    //            console.error('Could not connect to MongoDB!');
    //            done();
    //        }
    //    });
    //    mongoose.connection.on('error', function(err) {
    //        if (err) {
    //            console.error('MongoDB connection error: ' + err);
    //            done();
    //        }
    //    });
    //
    //    keco.updateTownArpltnInfo(function (err) {
    //        if (err)  {
    //            console.error(err);
    //        }
    //
    //        var ArpltnTown = require('../models/arpltn.town.keco');
    //        ArpltnTown.find({}, function (err, arpltnTownList) {
    //            console.log(arpltnTownList[0].toString());
    //            done();
    //        });
    //    });
    //});
});
