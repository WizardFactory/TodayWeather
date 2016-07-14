/**
 * Created by aleckim on 2015. 12. 4..
 */

var assert  = require('assert');
var convert = require('../utils/convertGeocode');
var Logger = require('../lib/log');

global.log  = new Logger(__dirname + "/debug.log");

describe('unit test - get geoCode from daum/google by address', function(){
    // To avoid the Error on the Travis CI, because there is no key for getting data from DAUM API service.
    //it('convertGeocode', function(done){
    //    this.timeout(10*1000);
    //    convert('서울특별시','마포구','신공덕동', function (err, result) {
    //        log.info(result);
    //        assert.equal(result.mx, 59, 'check receive mx');
    //        assert.equal(result.my, 126, 'check receive my');
    //        done();
    //    });
    //});
});
