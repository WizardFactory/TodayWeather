/**
 * Created by aleckim on 2017. 7. 11..
 */

"use strict";

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var assert  = require('assert');


describe('unit test - kasi rise set controller', function() {

    //it('test gather rise set from api', function (done) {
    //    this.timeout(24*60*60*1000);
    //    var KasiRiseSet = require('../controllers/kasi.riseset.controller');
    //
    //    KasiRiseSet.gatherAreaRiseSetFromApi(function (err, results) {
    //        if (err) {
    //            log.error(err);
    //        }
    //        else {
    //            log.info(results);
    //        }
    //        done();
    //    });
    //});

});


