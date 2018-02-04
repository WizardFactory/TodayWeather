/**
 * Created by aleckim on 2018. 2. 2..
 */

"use strict";

var assert  = require('assert');
var request = require('supertest');
var Logger = require('../../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var i18n = require('i18n');
i18n.configure({
    // setup some locales - other locales default to en silently
    locales: ['en', 'ko', 'ja', 'zh-CN', 'de', 'zh-TW'],
    // sets a custom cookie name to parse locale settings from
    cookie: 'twcookie',

    // where to store json files - defaults to './locales'
    directory: __dirname + './../../locales',

    register: global
});
global.i18n = i18n;

describe('e2e local test - controller push', function() {

    before(function (done) {
        done();
    });

    var pushInfo1 = {
        registrationId: 'asdf',
        pushTime: 6900,
        cityIndex: 0,
        type: 'ios',
        town: {first: '서울특별시', second: '송파구', third: '잠실본동'},
        geo: [36, 102],
        lang: 'ko',
        name: 'jamsil',
        source: 'KMA',
        units: {
            temperatureUnit: "C",
            windSpeedUnit: "m/s",
            pressureUnit: "hPa",
            distanceUnit: "km",
            precipitationUnit: "mm",
            airUnit: "airkorea"
        }
    };

    var pushInfo2 = {
       registrationId: 'asdf',
       pushTime: 6900,
       cityIndex: 1,
       type: 'ios',
       town: {first: '', second: '', third: ''},
       geo: [139.6917064, 35.6894875],
       lang: 'en',
       name: 'Tokyo',
       source: 'DSF',
       units: {
           temperatureUnit: "F",
           windSpeedUnit: "mph",
           pressureUnit: "mbar",
           distanceUnit: "miles",
           precipitationUnit: "inch"
       }
    };

    var url = 'http://localhost:3000';

    it('test update push list', function(done) {
        this.timeout(60*1000*60); //1mins
        var path = '/v000902/push-list';
        var pushList = [];
        pushList.push(pushInfo1);
        pushList.push(pushInfo2);
        request(url)
            .post(encodeURI(path))
            .send(pushList)
            .set('Accept', 'application/json')
            .expect(200)
            .end(function (err, res) {
                if (err) {
                    throw err;
                }
                console.log(res.body);
                done();
            });
    });
});
