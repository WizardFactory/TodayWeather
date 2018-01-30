/**
 * Created by aleckim on 2017. 12. 23..
 */

var should = require('should');
var assert = require('assert');
var request = require('supertest');

var fs = require('fs');
var targetName = './utils/data/cityGeocodeList.csv';
var baseList = [];
baseList = fs.readFileSync(targetName).toString().split('\n');
baseList = baseList.slice(0, baseList.length-1);

describe('Routing Darksky', function() {
    var url = 'http://tw-test.wizardfactory.net';
    //var url = 'http://localhost:3000';
    before(function (done) {
        //add new town
        done();
    });

    baseList.forEach(function (geoInfo) {
        var geo = geoInfo.split(",");

        it('test v000901 ' + geoInfo, function () {
            this.timeout(20 * 1000);
            var path = '/v000901/dsf/coord/' + parseFloat(geo[2]).toFixed(3) + ','+parseFloat(geo[3]).toFixed(3);
            console.log(path);
            return request(url)
                .get(encodeURI(path))
                .set('Accept', 'application/json')
                .expect(200)
                .then(function (res) {
                    assert(res.body.hasOwnProperty('units'), false);
                    assert(res.body.hasOwnProperty('thisTime'), true);
                    assert(res.body.hasOwnProperty('hourly'), true);
                    assert(res.body.hasOwnProperty('daily'), true);
                    assert(res.body.hasOwnProperty('source'), true);

                    assert(res.body.thisTime.length === 2, true);

                    var current = res.body.thisTime[1];
                    assert(current.hasOwnProperty('t1h'), true);
                    assert(current.hasOwnProperty('pty'), true);
                    assert(current.hasOwnProperty('reh'), true);
                    assert(current.hasOwnProperty('date'), true);
                    assert(current.hasOwnProperty('dateObj'), true);
                    assert(current.hasOwnProperty('time'), true);
                    assert(current.hasOwnProperty('arpltn'), true);
                    assert(current.hasOwnProperty('summary'), true);

                    var arpltn = current.arpltn;

                    if (!arpltn.pm25Grade) {
                        console.log('geo=',geo, ' does not have pm25Grade');
                    }
                    if (!arpltn.khaiGrade) {
                        console.log('geo=',geo, ' does not have khaiGrade');
                    }
                    if (arpltn.pm25Grade) {
                        assert(arpltn.hasOwnProperty('pm25Value'), true);
                    }
                    if (arpltn.pm10Grade) {
                        assert(arpltn.hasOwnProperty('pm10Value'), true);
                    }
                    if (arpltn.khaiGrade) {
                        assert(arpltn.hasOwnProperty('khaiValue'), true);
                    }

                    res.body.hourly.forEach(function(sh) {
                        assert(sh.hasOwnProperty('dateObj'), true);
                        assert(sh.hasOwnProperty('t3h'), true);
                        assert(sh.hasOwnProperty('fromToday'), true);
                        assert(sh.hasOwnProperty('skyIcon'), true);
                        assert(sh.hasOwnProperty('pty'), true);
                        assert(sh.hasOwnProperty('time'), true);
                    });

                    res.body.daily.forEach(function (daily) {
                        assert(daily.hasOwnProperty('dateObj'), true);
                        assert(daily.hasOwnProperty('tmn'), true);
                        assert(daily.hasOwnProperty('tmx'), true);
                        assert(daily.hasOwnProperty('skyAm'), true);
                        assert(daily.hasOwnProperty('skyPm'), true);
                        assert(daily.hasOwnProperty('fromToday'), true);
                        assert(daily.hasOwnProperty('dayOfWeek'), true);
                    });
                });
        });
    });
});



