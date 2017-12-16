/**
 * Created by aleckim on 2017. 11. 26..
 */

"use strict";

var GeoCtrl = require('../../controllers/geo.controller');
var assert  = require('assert');
var Logger = require('../../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

describe('e2e test - geo controller class', function() {
    it('get address of "경기도 성남시 분당구 수내1동" from geocode', function(done) {
        var cGeo = new GeoCtrl();
        var req = {params:{lat:37.379, lon:127.114}, query:{lang:"ko"}};
        var res = {};

        cGeo.setGoogleApiKey(null);
        cGeo.setInfoFromReq(req);

        cGeo.location2address(req, res, function (err) {
           if (err) {
               console.error(err);
           }
            console.info(cGeo);
           assert.equal(cGeo.kmaAddress.city, "성남시분당구");
           done();
        });
    });

    it('get address of "세종특별자치시 도담동" from geocode', function(done) {
        var cGeo = new GeoCtrl();
        var req = {params:{lat:36.517, lon:127.259}, query:{lang:"ko"}};
        var res = {};

        cGeo.setGoogleApiKey(null);
        cGeo.setInfoFromReq(req);

        cGeo.location2address(req, res, function (err) {
           if (err) {
               console.error(err);
           }
            console.info(cGeo);
           assert.equal(cGeo.kmaAddress.city, undefined);
           done();
        });
    });

    it('get address "서울특별시 중구 소공동" from geocode', function(done) {
        var cGeo = new GeoCtrl();
        var req = {params:{lat:37.566, lon:126.977}, query:{lang:"en"}};
        var res = {};

        cGeo.setGoogleApiKey(null);
        cGeo.setInfoFromReq(req);

        cGeo.location2address(req, res, function (err) {
            if (err) {
                console.error(err);
            }
            assert.equal(cGeo.kmaAddress.town, "소공동");
            assert.equal(cGeo.name, "Jeong-dong");
            console.info(cGeo);
            done();
        });
    });

    it('get address from geocode', function(done) {
        var cGeo = new GeoCtrl();
        var req = {
            params:{lat:37.566, lon:126.977},
            query:{lang:"ko", country:"KR", kma_region:"서울특별시", kma_city:"중구", address:"서울특별시 중구", name:"테스트"}};
        var res = {};

        cGeo.setGoogleApiKey(null);
        cGeo.setInfoFromReq(req);

        cGeo.location2address(req, res, function (err) {
            if (err) {
                console.error(err);
            }
            assert.equal(cGeo.name, req.query.name);
            console.info(cGeo);
            done();
        });
    });

    it('get address from geocode', function(done) {
        var cGeo = new GeoCtrl();
        var req = {params:{lat:35.689, lon:139.691}, query:{lang:"ko"}};
        var res = {};

        cGeo.setGoogleApiKey(null);
        cGeo.setInfoFromReq(req);

        cGeo.location2address(req, res, function (err) {
            if (err) {
                console.error(err);
            }
            console.info(cGeo);
            assert.equal(cGeo.name, "니시신주쿠");
            done();
        });
    });
});
