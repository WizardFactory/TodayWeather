/**
 * Created by Peter on 2017. 9. 10..
 */

"use strict";

var wrRequester = require('../../lib/WU/wuRequester');
var assert  = require('assert');
var config = require('../../config/config');
var Logger = require('../../lib/log');
var convertGeocode = require('../../utils/convertGeocode');
var keybox = require('../../config/config').keyString;
var util = require('util');
var async = require('async');
var collectTown = require('../../lib/collectTownForecast');

var kecoController = require('../../controllers/kecoController');

global.log  = new Logger(__dirname + "/debug.log");

var controllerManager = require('../../controllers/controllerManager');
var town = require('../../models/town');
var modelCurrent = require('../../models/modelCurrent');

var manager = new controllerManager();

describe('invalid t1h', function(){
    it('test invalid t1h on Sep', function(done){
        var list = [{mx:91, my:131}];
        var key = 'ZHnG%2BY4Lm4ro7irtG1atoYPJTVgSPFz5iZbHQYFTEXJfCCrdcF1caV1UK%2FQH5fMqbA%2B%2FpL9Cy%2BSYVi%2BAqzG8bw%3D%3D';

        var qureyResult = [{"isCompleted":true,"data":[{"pubDate":"201709101700","date":"20170910","time":"1700","mx":91,"my":131,"lgt":0,"pty":0,"reh":93,"rn1":0,"sky":4,"t1h":21.5,"uuu":-1.3,"vec":106,"vvv":0.4,"wsd":1.5}],"url":"http://newsky2.kma.go.kr/service/SecndSrtpdFrcstInfoService2/ForecastGrib?serviceKey=ZHnG%2BY4Lm4ro7irtG1atoYPJTVgSPFz5iZbHQYFTEXJfCCrdcF1caV1UK%2FQH5fMqbA%2B%2FpL9Cy%2BSYVi%2BAqzG8bw%3D%3D&base_date=20170910&base_time=1600&nx=91&ny=131&pageNo=1&numOfRows=999","retryCount":0,"options":{"date":"20170910","time":"1600","dataType":0,"code":""},"mCoord":{"mx":91,"my":131}}];
        var qureyResult2 = [{"isCompleted":true,"data":[{"pubDate":"201712101600","date":"20170909","time":"1600","mx":91,"my":131,"lgt":0,"pty":0,"reh":93,"rn1":0,"sky":4,"t1h":20.5,"uuu":-1.3,"vec":106,"vvv":0.4,"wsd":1.5}],"url":"http://newsky2.kma.go.kr/service/SecndSrtpdFrcstInfoService2/ForecastGrib?serviceKey=ZHnG%2BY4Lm4ro7irtG1atoYPJTVgSPFz5iZbHQYFTEXJfCCrdcF1caV1UK%2FQH5fMqbA%2B%2FpL9Cy%2BSYVi%2BAqzG8bw%3D%3D&base_date=20170910&base_time=1600&nx=91&ny=131&pageNo=1&numOfRows=999","retryCount":0,"options":{"date":"20170910","time":"1600","dataType":0,"code":""},"mCoord":{"mx":91,"my":131}}];
        var data = [{
            mCoord: {
                mx : 91,
                my : 131
            },
            pubDate : 201709091500, //YYYYMMDDHHMM last baseDate+baseTime
            currentData : [{
                date: '20170909', // get시 sort용
                time: '1400',
                mx: 91,
                my: 131,
                t1h: 15,
                rn1: 1,
                sky: 2,
                uuu: 3,
                vvv: 4,
                reh: 5,
                pty: 6,
                lgt: 7,
                vec: 8,
                wsd: 9
            }, {
                date: '20170909', // get시 sort용
                time: '1500',
                mx: 91,
                my: 131,
                t1h: 19.2,
                rn1: 1,
                sky: 2,
                uuu: 3,
                vvv: 4,
                reh: 5,
                pty: 6,
                lgt: 7,
                vec: 8,
                wsd: 9
            },{
                date: '20170909', // get시 sort용
                time: '1600',
                mx: 91,
                my: 131,
                t1h: 0,
                rn1: 1,
                sky: 2,
                uuu: 3,
                vvv: 4,
                reh: 5,
                pty: 6,
                lgt: 7,
                vec: 8,
                wsd: 9
            }
            ],
            save:function(cb){
                cb(0);
            }
        }];



        modelCurrent.find = function(mCoord, cb){
            cb(0, data);
        };

        town.getCoord = function(cb){
            log.info('> gcoord : ', list);
            cb(0, list);
        };

        collectTown.requestData = function(srcList, dataType, key, date, time, cb) {
            cb(0, qureyResult);
        };

        manager._checkPubDate = function (modelCurrent, listTownDb, dateString, cb) {
            cb(0, listTownDb);
        };

        manager.getTownCurrentData(9, key, function(err, result){
            log.info(data);
            log.info('END -----------------------------');
            done();
        });

    });


    it('test collecting current data with invalid t1h on Nov', function(done){
        var list = [{mx:91, my:131}];
        var key = 'ZHnG%2BY4Lm4ro7irtG1atoYPJTVgSPFz5iZbHQYFTEXJfCCrdcF1caV1UK%2FQH5fMqbA%2B%2FpL9Cy%2BSYVi%2BAqzG8bw%3D%3D';

        var queryCount = 0;
        var qureyResult = [{"isCompleted":true,"data":[{"pubDate":"201712101600","date":"20171210","time":"1700","mx":91,"my":131,"lgt":0,"pty":0,"reh":93,"rn1":0,"sky":4,"t1h":0,"uuu":-1.3,"vec":106,"vvv":0.4,"wsd":1.5}],"url":"http://newsky2.kma.go.kr/service/SecndSrtpdFrcstInfoService2/ForecastGrib?serviceKey=ZHnG%2BY4Lm4ro7irtG1atoYPJTVgSPFz5iZbHQYFTEXJfCCrdcF1caV1UK%2FQH5fMqbA%2B%2FpL9Cy%2BSYVi%2BAqzG8bw%3D%3D&base_date=20170910&base_time=1600&nx=91&ny=131&pageNo=1&numOfRows=999","retryCount":0,"options":{"date":"20170910","time":"1600","dataType":0,"code":""},"mCoord":{"mx":91,"my":131}}];
        var qureyResult2 = [{"isCompleted":true,"data":[{"pubDate":"201712101600","date":"20171209","time":"1600","mx":91,"my":131,"lgt":0,"pty":0,"reh":93,"rn1":0,"sky":4,"t1h":20.2,"uuu":-1.3,"vec":106,"vvv":0.4,"wsd":1.5}],"url":"http://newsky2.kma.go.kr/service/SecndSrtpdFrcstInfoService2/ForecastGrib?serviceKey=ZHnG%2BY4Lm4ro7irtG1atoYPJTVgSPFz5iZbHQYFTEXJfCCrdcF1caV1UK%2FQH5fMqbA%2B%2FpL9Cy%2BSYVi%2BAqzG8bw%3D%3D&base_date=20170910&base_time=1600&nx=91&ny=131&pageNo=1&numOfRows=999","retryCount":0,"options":{"date":"20170910","time":"1600","dataType":0,"code":""},"mCoord":{"mx":91,"my":131}}];
        var data = [{
            mCoord: {
                mx : 91,
                my : 131
            },
            pubDate : 201712091500, //YYYYMMDDHHMM last baseDate+baseTime
            currentData : [{
                date: '20171209', // get시 sort용
                time: '1400',
                mx: 91,
                my: 131,
                t1h: 15,
                rn1: 1,
                sky: 2,
                uuu: 3,
                vvv: 4,
                reh: 5,
                pty: 6,
                lgt: 7,
                vec: 8,
                wsd: 9
            }, {
                date: '20171209', // get시 sort용
                time: '1500',
                mx: 91,
                my: 131,
                t1h: 19.5,
                rn1: 1,
                sky: 2,
                uuu: 3,
                vvv: 4,
                reh: 5,
                pty: 6,
                lgt: 7,
                vec: 8,
                wsd: 9
            },{
                date: '20171209', // get시 sort용
                time: '1600',
                mx: 91,
                my: 131,
                t1h: 0,
                rn1: 1,
                sky: 2,
                uuu: 3,
                vvv: 4,
                reh: 5,
                pty: 6,
                lgt: 7,
                vec: 8,
                wsd: 9
            }
            ],
            save:function(cb){
                cb(0);
            }
        }];



        modelCurrent.find = function(mCoord, cb){
            cb(0, data);
        };

        town.getCoord = function(cb){
            log.info('> gcoord : ', list);
            cb(0, list);
        };

        collectTown.requestData = function(srcList, dataType, key, date, time, cb) {
            log.info('> requestData');
            if(queryCount == 0){
                cb(0, qureyResult);
                queryCount++;
            }else{
                cb(0, qureyResult2);
            }

        };

        manager._checkPubDate = function (modelCurrent, listTownDb, dateString, cb) {
            cb(0, listTownDb);
        };

        manager.getTownCurrentData(9, key, function(err, result){
            log.info(data);
            log.info('END -----------------------------');
            done();
        });

    });


    it('test invalid t1h on Nov, current t1h is 0', function(done){
        var list = [{mx:91, my:131}];
        var key = 'ZHnG%2BY4Lm4ro7irtG1atoYPJTVgSPFz5iZbHQYFTEXJfCCrdcF1caV1UK%2FQH5fMqbA%2B%2FpL9Cy%2BSYVi%2BAqzG8bw%3D%3D';

        var queryCount = 0;
        var qureyResult = [{"isCompleted":true,"data":[{"pubDate":"201712101600","date":"20171210","time":"1700","mx":91,"my":131,"lgt":0,"pty":0,"reh":93,"rn1":0,"sky":4,"t1h":23.5,"uuu":-1.3,"vec":106,"vvv":0.4,"wsd":1.5}],"url":"http://newsky2.kma.go.kr/service/SecndSrtpdFrcstInfoService2/ForecastGrib?serviceKey=ZHnG%2BY4Lm4ro7irtG1atoYPJTVgSPFz5iZbHQYFTEXJfCCrdcF1caV1UK%2FQH5fMqbA%2B%2FpL9Cy%2BSYVi%2BAqzG8bw%3D%3D&base_date=20170910&base_time=1600&nx=91&ny=131&pageNo=1&numOfRows=999","retryCount":0,"options":{"date":"20170910","time":"1600","dataType":0,"code":""},"mCoord":{"mx":91,"my":131}}];
        var qureyResult2 = [{"isCompleted":true,"data":[{"pubDate":"201712101600","date":"20171209","time":"1600","mx":91,"my":131,"lgt":0,"pty":0,"reh":93,"rn1":0,"sky":4,"t1h":22.5,"uuu":-1.3,"vec":106,"vvv":0.4,"wsd":1.5}],"url":"http://newsky2.kma.go.kr/service/SecndSrtpdFrcstInfoService2/ForecastGrib?serviceKey=ZHnG%2BY4Lm4ro7irtG1atoYPJTVgSPFz5iZbHQYFTEXJfCCrdcF1caV1UK%2FQH5fMqbA%2B%2FpL9Cy%2BSYVi%2BAqzG8bw%3D%3D&base_date=20170910&base_time=1600&nx=91&ny=131&pageNo=1&numOfRows=999","retryCount":0,"options":{"date":"20170910","time":"1600","dataType":0,"code":""},"mCoord":{"mx":91,"my":131}}];

        var data = [{
            mCoord: {
                mx : 91,
                my : 131
            },
            pubDate : 201712091500, //YYYYMMDDHHMM last baseDate+baseTime
            currentData : [{
                date: '20171209', // get시 sort용
                time: '1400',
                mx: 91,
                my: 131,
                t1h: 15,
                rn1: 1,
                sky: 2,
                uuu: 3,
                vvv: 4,
                reh: 5,
                pty: 6,
                lgt: 7,
                vec: 8,
                wsd: 9
            }, {
                date: '20171209', // get시 sort용
                time: '1500',
                mx: 91,
                my: 131,
                t1h: 20.5,
                rn1: 1,
                sky: 2,
                uuu: 3,
                vvv: 4,
                reh: 5,
                pty: 6,
                lgt: 7,
                vec: 8,
                wsd: 9
            },{
                date: '20171209', // get시 sort용
                time: '1600',
                mx: 91,
                my: 131,
                t1h: 0,
                rn1: 1,
                sky: 2,
                uuu: 3,
                vvv: 4,
                reh: 5,
                pty: 6,
                lgt: 7,
                vec: 8,
                wsd: 9
            }
            ],
            save:function(cb){
                cb(0);
            }
        }];



        modelCurrent.find = function(mCoord, cb){
            cb(0, data);
        };

        town.getCoord = function(cb){
            log.info('> gcoord : ', list);
            cb(0, list);
        };

        collectTown.requestData = function(srcList, dataType, key, date, time, cb) {
            log.info('> requestData');
            if(queryCount == 0){
                cb(0, qureyResult);
                queryCount++;
            }else{
                cb(0, qureyResult2);
            }
        };

        manager._checkPubDate = function (modelCurrent, listTownDb, dateString, cb) {
            cb(0, listTownDb);
        };

        manager.getTownCurrentData(9, key, function(err, result){
            log.info(data);
            log.info('END -----------------------------');
            done();
        });

    });
});