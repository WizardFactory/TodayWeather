/**
 * Created by aleckim on 2015. 10. 24..
 */

"use strict";

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var assert  = require('assert');
var Keco  = require('../lib/kecoRequester.js');

describe('unit test - keco requester', function() {
    var keco;
    var list;

    it('create keco service', function () {
        keco = new Keco();
        assert.equal(keco._currentSidoIndex, 0, '');
    });
    it('set key', function () {
        var key = require('../config/config').keyString.test_normal;
        keco.setServiceKey(key);
        assert.equal(key, keco.getServiceKey(), '');
    });

    //it ('get Msrstn List', function (done) {
    //    keco.getMsrstnList(keco.getServiceKey(), function (err, body) {
    //        if (err) {
    //            console.log(err);
    //        }
    //        assert.equal('number', typeof body.list.length, 'Fail to get length of msr stn list');
    //        done();
    //    });
    //});

    var parsedList;
    it ('parse msr stn list', function () {
        var msrStnList= [{
            "_returnType": "xml",
            "addr": "경남 창원시 의창구 두대동145번지 시설관리공단 내 실내수영장 앞(원이대로 480)",
            "districtNum": "",
            "dmX": "35.232222",
            "dmY": "128.671389",
            "item": "SO2, CO, O3, NO2, PM10",
            "mangName": "도로변대기",
            "map": "http://www.airkorea.or.kr/airkorea/station_map/238145.gif",
            "numOfRows": "10",
            "oper": "경상남도보건환경연구원",
            "pageNo": "1",
            "photo": "http://www.airkorea.or.kr/airkorea/station_photo/NAMIS/station_images/238145/INSIDE_OTHER_1.jpg",
            "resultCode": "",
            "resultMsg": "",
            "rnum": 0,
            "serviceKey": "",
            "sggName": "",
            "sidoName": "",
            "stationCode": "",
            "stationName": "반송로",
            "tm": 0,
            "tmX": "",
            "tmY": "",
            "totalCount": "",
            "umdName": "",
            "vrml": "",
            "year": "2008"
        }, {
            "_returnType": "xml",
            "addr": "경남 창원시 성산구 사파동(창이대로 706길)106-1(16-23)",
            "districtNum": "",
            "dmX": "35.221729",
            "dmY": "128.69825",
            "item": "SO2, CO, O3, NO2, PM10",
            "mangName": "도시대기",
            "map": "http://www.airkorea.or.kr/airkorea/station_map/238146.gif",
            "numOfRows": "10",
            "oper": "경상남도보건환경연구원",
            "pageNo": "1",
            "photo": "http://www.airkorea.or.kr/airkorea/station_photo/NAMIS/station_images/238146/INSIDE_OTHER_1.jpg",
            "resultCode": "",
            "resultMsg": "",
            "rnum": 0,
            "serviceKey": "",
            "sggName": "",
            "sidoName": "",
            "stationCode": "",
            "stationName": "사파동",
            "tm": 0,
            "tmX": "",
            "tmY": "",
            "totalCount": "",
            "umdName": "",
            "vrml": "",
            "year": "2009"
        }];
        parsedList = keco.parseMsrstnList(msrStnList);

        assert.equal(2, parsedList.length, 'Fail to parse msr stn list');
    });

    //it('complete geo msr stn info', function (done) {
    //    var msrStn = {
    //        "_returnType": "xml",
    //        "addr": "강원 춘천시 중앙로 3가67-1(춘천시보건소 3층 옥상)",
    //        "districtNum": "",
    //        "dmX": "",
    //        "dmY": "",
    //        "item": "SO2, CO, O3, NO2, PM10",
    //        "mangName": "도시대기",
    //        "map": "http://www.airkorea.or.kr/airkorea/station_map/132112.gif",
    //        "numOfRows": "10",
    //        "oper": "강원도보건환경연구원",
    //        "pageNo": "1",
    //        "photo": "http://www.airkorea.or.kr/airkorea/station_photo/NAMIS/station_images/132112/INSIDE_OTHER_1.jpg",
    //        "resultCode": "",
    //        "resultMsg": "",
    //        "rnum": 0,
    //        "serviceKey": "",
    //        "sggName": "",
    //        "sidoName": "",
    //        "stationCode": "",
    //        "stationName": "중앙로",
    //        "tm": 0,
    //        "tmX": "",
    //        "tmY": "",
    //        "totalCount": "",
    //        "umdName": "",
    //        "vrml": "http://www.airkorea.or.kr/airkorea/vrml/132112.swf",
    //        "year": "2003"
    //    };
    //    //keco.getGeoInfo(msrStn.addr, function (err, result) {
    //    //    if (err) {
    //    //        log.error(err);
    //    //    }
    //    //    console.log(result);
    //    //    done();
    //    //});
    //
    //    keco.completeGeoMsrStnInfo([msrStn], function(err, results) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        console.log(results);
    //        done();
    //    });
    //});

    //it('save msr stn list', function (done) {
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
    //    var coords = parsedList[1].geo;
    //
    //    keco.saveMsrstnList(parsedList, function(err, results) {
    //        if (err) {
    //            console.log(err);
    //        }
    //
    //        assert.equal(1, results[results.length-1].ok, 'Fail to save msr stn list');
    //        done();
    //
    //        //var MsrStn = require('../models/modelMsrStnInfo.js');
    //        //console.log(coords);
    //        //
    //        //MsrStn.find({geo: {$near:coords, $maxDistance: 1}}).lean().exec(function (err, msrStnList) {
    //        //    if (err) {
    //        //        console.log(err);
    //        //    }
    //        //    console.log(JSON.stringify(msrStnList));
    //        //    done();
    //        //});
    //    });
    //});

    //it ('get all msr stn list', function (done) {
    //    this.timeout(10*60*1000);
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
    //    keco.getAllMsrStnInfo(function (err, result) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        console.log('saved msr stn list len=', result.length);
    //        assert.equal('number', typeof result.length, 'Fail to get all msr stn list');
    //        done();
    //    });
    //});

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

        keco.getStationNameFromMsrstn(body, function (err, result) {
            if (err) {
                console.error(err);
            }
            else {
                assert.equal(result, '옥천동', '');
            }
            done();
        });
    });

       // it('get Near By Msrstn', function (done) {
   //
   //     this.timeout(10*1000);
   //     var tmCoord = {"y":476266.59248414496,"x":369036.86549488344};
   //
   //     keco.getNearbyMsrstn(keco.getServiceKey(), tmCoord.y, tmCoord.x, function (err, body) {
   //         if (err) {console.log(err);}
   //
   //         keco.getStationNameFromMsrstn(body, function (err, result) {
   //             console.log(err);
   //             console.log(result);
   //             done();
   //         });
   //     });
   //});

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

});
