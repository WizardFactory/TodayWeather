/**
 * Created by aleckim on 18. 1. 23..
 */

"use strict";

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var assert  = require('assert');

var AqiConverter = require('../lib/aqi.converter');

describe('unit test - aqi converter', function() {
    var testData = { "stationName" : "상대원동", "pm25Grade" : -1, "pm10Grade" : 2,
        "no2Grade" : 3, "o3Grade" : 1, "coGrade" : 1, "so2Grade" : 1,
        "khaiGrade" : -1, "khaiValue" : -1, "pm25Value" : 80,
        "pm10Value" : 80, "no2Value" : 0.064, "o3Value" : 0.003,
        "coValue" : 0.9, "so2Value" : 0.005, "dataTime" : "2017-12-22 20:00" };

    it('test getting aqi index', function(){
        var index = AqiConverter.value2index('airkorea', 'pm10', testData.pm10Value);
        assert.equal(index, 100);

        index = AqiConverter.value2index('airkorea_who', 'pm10', testData.pm10Value);
        assert.equal(index, 190);

        index = AqiConverter.value2index('airnow', 'pm10', testData.pm10Value);
        assert.equal(index, 63);

        index = AqiConverter.value2index('aqicn', 'pm10', testData.pm10Value);
        assert.equal(index, 65);

        index = AqiConverter.value2index('airnow', 'o3', testData.o3Value);
        assert.equal(index, 3);

        index = AqiConverter.value2index('aqicn', 'so2', testData.so2Value);
        assert.equal(index, 5);

        var airkorea = { "stationName" : "강남구", "pm25Grade" : 2,
            "pm25Grade24" : 2, "pm10Grade" : 2, "pm10Grade24" : 2, "no2Grade" : 2, "o3Grade" : 1,
            "coGrade" : 1, "so2Grade" : 1, "khaiGrade" : 2, "khaiValue" : 97, "pm25Value24" : 31,
            "pm25Value" : 40, "pm10Value24" : 51, "pm10Value" : 46, "no2Value" : 0.058, "o3Value" : 0.003,
            "coValue" : 0.7, "so2Value" : 0.005, "dataTime" : "2018-01-22 18:00", "mangName" : "도시대기" };
        var aqicn = {
            "pm25": 112, "pm10": 43, "o3": 3, "no2": 55, "so2": 7, "co": 8, "aqi":112
        };
        ['pm25', 'pm10', 'o3', 'no2', 'so2', 'co'].forEach(function (name) {
            index = AqiConverter.value2index('airnow', name, airkorea[name+'Value']);
            //console.log({name: name, value: airkorea[name+'Value'], aqiCNIndex: index});
            assert.equal(index, aqicn[name]);
        });
    });
});

