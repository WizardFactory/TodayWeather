/**
 * Created by Peter on 2015. 8. 4..
 */
"use strict";

var assert  = require('assert');
var config = require('../config/config');
var collect = require('../lib/collectTownForecast');
var Logger = require('../lib/log');

var keyString = 'KXK7ONQ7F8BaIRLM1Us%2FHmITwhKnrkq8XR0GI1lEimenATLDvAXpsBpOXPfTUjpxFgn5NVqvl02sBCe%2B2iviyw%3D%3D';

global.log  = new Logger(__dirname + "/debug.log");

describe('unit test - lib/collect class', function(){
    it('lib/collect : get towns SHORT info by using XY list', function(done){
        var listXY = [{x:91, y:131}, {x:91, y:132}, {x:94, y:131}];

        var collection = new collect(listXY);
        assert.doesNotThrow(function(){
            collection.getTownData(collection.DATA_TYPE.SHORT, keyString, '20150815', '0500', function(err, dataList){
                log.info('short data receive completed : ', dataList.length);

                //log.info(dataList);
                //log.info(dataList[0]);
                //for(var i in dataList){
                //    for(var j in dataList[i].data){
                //        log.info(dataList[i].data[j]);
                //    }
                //}


                assert.equal(dataList.length, listXY.length, 'check receive count');

                assert.notEqual(dataList[0].data[0].date, '', 'check date whether it is invalid');
                assert.notEqual(dataList[1].data[0].date, '', 'check date whether it is invalid');
                assert.notEqual(dataList[2].data[0].date, '', 'check date whether it is invalid');

                assert.notEqual(dataList[0].data[0].time, '', 'check time whether it is invalid');
                assert.notEqual(dataList[1].data[0].time, '', 'check time whether it is invalid');
                assert.notEqual(dataList[2].data[0].time, '', 'check time whether it is invalid');

                done();
            });
        });
    });

    it('lib/collect : get towns SHORTEST info by using XY list', function(done){
        var listXY = [{x:91, y:131}, {x:91, y:132}, {x:94, y:131}];

        var collection = new collect(listXY);
        assert.doesNotThrow(function(){
            collection.getTownData(collection.DATA_TYPE.SHORTEST, keyString, '20150815', '1530', function(err, dataList){
                log.info('shortest data receive completed : ', dataList.length);

                //log.info(dataList);
                //log.info(dataList[0]);
                //for(var i in dataList){
                //    for(var j in dataList[i].data){
                //        log.info(dataList[i].data[j]);
                //    }
                //}

                assert.equal(dataList.length, listXY.length, 'check receive count');

                assert.notEqual(dataList[0].data[0].date, '', 'check date whether it is invalid');
                assert.notEqual(dataList[1].data[0].date, '', 'check date whether it is invalid');
                assert.notEqual(dataList[2].data[0].date, '', 'check date whether it is invalid');

                assert.notEqual(dataList[0].data[0].time, '', 'check time whether it is invalid');
                assert.notEqual(dataList[1].data[0].time, '', 'check time whether it is invalid');
                assert.notEqual(dataList[2].data[0].time, '', 'check time whether it is invalid');

                done();
            });
        });
    });

    it('lib/collect : get towns CURRENT info by using XY list', function(done){
        var listXY = [{x:91, y:131}, {x:91, y:132}, {x:94, y:131}];

        var collection = new collect(listXY);
        assert.doesNotThrow(function(){
            collection.getTownData(collection.DATA_TYPE.CURRENT, keyString, '20150815', '1600', function(err, dataList){
                log.info('current data receive completed : ', dataList.length);

                //log.info(dataList);
                //log.info(dataList[0]);
                //for(var i in dataList){
                //    for(var j in dataList[i].data){
                //        log.info(dataList[i].data[j]);
                //    }
                //}

                assert.equal(dataList.length, listXY.length, 'check receive count');

                assert.notEqual(dataList[0].data[0].date, '', 'check date whether it is invalid');
                assert.notEqual(dataList[1].data[0].date, '', 'check date whether it is invalid');
                assert.notEqual(dataList[2].data[0].date, '', 'check date whether it is invalid');

                assert.notEqual(dataList[0].data[0].time, '', 'check time whether it is invalid');
                assert.notEqual(dataList[1].data[0].time, '', 'check time whether it is invalid');
                assert.notEqual(dataList[2].data[0].time, '', 'check time whether it is invalid');

                done();
            });
        });
    });
});
