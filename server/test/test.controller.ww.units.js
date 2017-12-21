/**
 * Created by aleckim on 2017. 12. 14..
 */

'use strict';

var assert  = require('assert');

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var controllerManager = require('../controllers/controllerManager');
global.manager = new controllerManager();

var ControllerWWUnits = require('../controllers/worldWeather/controller.ww.units');

describe('unit test - controller ww units', function() {

    var query = {temperatureUnit: 'C', windSpeedUnit: 'm/s', pressureUnit: 'hPa',
        distanceUnit: 'km', precipitationUnit: 'mm', airUnit: 'airKorea'};

    var thisTime0 = {"date":"2017.12.13 03:00","desc":"Clear","weatherType":0,
        "temp_c":4.2,"temp_f":39.6,"ftemp_c":4.2,"ftemp_f":39.6,"cloud":9,
        "windSpd_mh":2.88,"windSpd_ms":1.29,"windDir":330,"humid":52,
        "precType":0,"vis":12,"press":1014.76,"oz":325.61};
    var thisTime1 = {"date":"2017.12.14 03:22","desc":"Clear","weatherType":0,
        "temp_c":2.9,"temp_f":37.2,"ftemp_c":-0.3,"ftemp_f":31.4,"cloud":9,
        "windSpd_mh":7.67,"windSpd_ms":3.43,"windDir":326,"humid":50,
        "precType":0,"vis":12,"press":1019.14,"oz":318.27,"skyIcon":"Moon",
        "coValue":0.23,"no2Value":18.6,"o3Value":64,"pm10Value":3,
        "pm25Value":17.5,"so2Value":4.5,"aqiGrade":1,"coGrade":1,"no2Grade":1,
        "o3Grade":1,"pm10Grade":1,"pm25Grade":1,"so2Grade":1,"t":1.75,"h":41,
        "p":1004,"aqiStr":"Good","coStr":"Good","no2Str":"Good","o3Str":"Good",
        "pm10Str":"Good","pm25Str":"Good","so2Str":"Good"};
    var hourly ={"date":"2017.12.13 00:00","temp_c":5.7,"temp_f":42.3,
        "ftemp_c":4.8,"ftemp_f":40.7,"cloud":12,"windSpd_mh":3.28,"windSpd_ms":1.47,
        "windDir":2,"humid":47,"precType":0,"precProb":0,"precip":0,"vis":11.93,
        "press":1014.43,"oz":321,"desc":"Clear","weatherType":0,"skyIcon":"Moon"};
    var daily = {"date":"2017.12.13 00:00","desc":"Partly cloudy in the evening.",
        "sunrise":"2017.12.13 06:43","sunset":"2017.12.13 16:29","tempMax_c":11.3,
        "tempMax_f":52.4,"tempMin_c":2.6,"tempMin_f":36.6,"ftempMax_c":11.3,
        "ftempMax_f":52.4,"ftempMin_c":2.3,"ftempMin_f":36.1,"cloud":16,"precType":0,
        "humid":45,"windSpd_mh":3.11,"windSpd_ms":1.39,"windDir":353,"press":1015.23,
        "vis":11.46,"skyIcon":"Sun"};

    it('test _convertHourlyWeather ', function () {
       var ctrlWWUnits = new ControllerWWUnits();
       var current = thisTime1.date;
       var wData = JSON.parse(JSON.stringify(hourly));
       ctrlWWUnits._convertHourlyWeather(wData, query, current);
       assert.equal(wData.time, 0);
    });

    it ('test convertUnits', function (done) {
        var result = {thisTime:[thisTime0, thisTime1], hourly: [hourly], daily: [daily]};
        var req={result: result, query: query};
        var res;

        var ctrlWWUnits = new ControllerWWUnits();

        ctrlWWUnits.convertUnits(req, res, function () {
            //console.log(req.result.thisTime[1]);
            assert.equal(req.result.thisTime[1].time, 3);
            assert.equal(req.result.thisTime[1].arpltn.coValue, 0.23);
            assert.equal(req.result.thisTime[1].arpltn.khaiGrade, 1);
            done();
        });
    });

});

