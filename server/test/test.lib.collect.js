/**
 * Created by Peter on 2015. 8. 4..
 */
"use strict";

var assert  = require('assert');
var config = require('../config/config');
var collect = require('../lib/collect');
var Logger = require('../lib/log');

var keyString = 'KXK7ONQ7F8BaIRLM1Us%2FHmITwhKnrkq8XR0GI1lEimenATLDvAXpsBpOXPfTUjpxFgn5NVqvl02sBCe%2B2iviyw%3D%3D';

global.log  = new Logger(__dirname + "/debug.log");

describe('unit test - lib/collect class', function(){
    it('lib/collect : get towns SHORT info by using XY list', function(done){
        var listXY = [{x:91, y:131}, {x:91, y:132}, {x:94, y:131}];

        var collection = new collect(listXY);
        assert.doesNotThrow(function(){
            collection.getDataFromList(collection.DATA_TYPE.SHORT, keyString, '20150804', '0800', function(err, dataList){
                log.info('receive completed : ', dataList.length);

                //log.info(dataList[0].data.response.header[0].resultCode[0]);
                //log.info(dataList[0].data.response.body[0].totalCount[0]);

                assert.equal(dataList.length, listXY.length, 'check receive count');

                assert.equal(dataList[0].data.response.header[0].resultCode[0], '0000', 'check result code #0');
                assert.equal(dataList[1].data.response.header[0].resultCode[0], '0000', 'check result code #1');
                assert.equal(dataList[2].data.response.header[0].resultCode[0], '0000', 'check result code #2');

                assert.notEqual(dataList[0].data.response.body[0].totalCount[0], '0', 'check result count #0');
                assert.notEqual(dataList[1].data.response.body[0].totalCount[0], '0', 'check result count #1');
                assert.notEqual(dataList[2].data.response.body[0].totalCount[0], '0', 'check result count #2');

                done();
            });
        });
    });
});
