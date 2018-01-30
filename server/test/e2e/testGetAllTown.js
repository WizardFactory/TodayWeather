/**
 * Created by aleckim on 2016. 3. 30..
 */

var should = require('should');
var assert = require('assert');
var request = require('supertest');

var fs = require('fs');
var targetName = './utils/data/base.csv';
var baseList = [];
baseList = fs.readFileSync(targetName).toString().split('\n');
baseList.shift();
baseList = baseList.slice(0, baseList.length-1);

//baseList.push("포항시,효곡동포항공과대학교,화공실험동");
baseList.push("경기도,수원시장안구,율전동");
baseList.push("서울특별시,서대문구,창천동");
baseList.push("경기도,고양시일산서구,덕이동");
baseList.push("전라북도,군산시,문화동");

describe('Routing kma', function() {
    var url = 'http://tw-test.wizardfactory.net';
    //var url = 'http://tw-wzdfac.rhcloud.com';
    //var url = "http://todayweather-wizardfactory.rhcloud.com";
    before(function (done) {
        //add new town
        done();
    });

    baseList.forEach(function (townInfo) {
        var town = townInfo.split(",");
        // it('test v000803 ' + town[0] + town[1] + town[2], function () {
        //     this.timeout(20 * 1000);
        //     var path = '/v000803/town/' + town[0];
        //     if (town[1]) {
        //         path += '/' + town[1];
        //     }
        //     if (town[2]) {
        //         path += '/' + town[2];
        //     }
        //
        //     return request(url)
        //         .get(encodeURI(path))
        //         .set('Accept', 'application/json')
        //         .expect(200)
        //         .then(function (res) {
        //             var body = res.body;
        //             assert(body.hasOwnProperty('regionName'));
        //             assert(body.hasOwnProperty('cityName'));
        //             assert(body.hasOwnProperty('townName'));
        //             assert(body.hasOwnProperty('short'));
        //             assert(body.hasOwnProperty('current'));
        //             assert(body.hasOwnProperty('midData'));
        //
        //             var current = res.body.current;
        //             current.should.have.property('arpltn');
        //             current.should.have.property('summary');
        //             current.t1h.should.not.be.exactly(-50);
        //             current.reh.should.not.be.exactly(-1);
        //             current.rn1.should.not.be.exactly(-1);
        //             current.sky.should.not.be.exactly(-1);
        //             current.pty.should.not.be.exactly(-1);
        //             current.lgt.should.not.be.exactly(-1);
        //             current.yesterday.should.have.property('t1h');
        //             current.yesterday.t1h.should.not.be.exactly(-50);
        //
        //             res.body.short.forEach(function(sh) {
        //                 sh.t3h.should.not.be.exactly(-50);
        //                 //신규로 들어온 지역이 아직 short가 모이지 않아 pop에러 발생함.
        //                 //sh.pop.should.not.be.exactly(-1);
        //                 sh.pty.should.not.be.exactly(-1);
        //                 sh.sky.should.not.be.exactly(-1);
        //             });
        //
        //             var midData = res.body.midData;
        //             midData.should.have.property('dailyData');
        //             midData.dailyData.forEach(function (daily) {
        //                 daily.should.have.property('wfAm');
        //                 daily.should.have.property('wfPm');
        //                 daily.taMax.should.not.be.exactly(-50);
        //                 daily.taMin.should.not.be.exactly(-50);
        //             });
        //         });
        // });

        it('test v000901 ' + town[0] + town[1] + town[2], function () {
            this.timeout(20 * 1000);
            var path = '/v000901/kma/addr/' + encodeURIComponent(town[0]);
            if (town[1]) {
                path += '/' + encodeURIComponent(town[1]);
            }
            if (town[2]) {
                path += '/' + encodeURIComponent(town[2]);
            }

            return request(url)
                .get(path)
                .set('Accept', 'application/json')
                .expect(200)
                .then(function (res) {
                    var body = res.body;
                    assert(body.hasOwnProperty('regionName'));
                    assert(body.hasOwnProperty('cityName'));
                    assert(body.hasOwnProperty('townName'));
                    assert(body.hasOwnProperty('short'));
                    assert(body.hasOwnProperty('current'));
                    assert(body.hasOwnProperty('midData'));
                    assert(body.hasOwnProperty('units'));
                    assert(body.hasOwnProperty('source'));
                    assert(body.hasOwnProperty('airInfo'));

                    var current = body.current;
                    current.should.have.property('arpltn');
                    current.should.have.property('summary');
                    current.should.have.property('yesterday');
                    current.should.have.property('dateObj');
                    current.t1h.should.not.be.exactly(-50);
                    current.reh.should.not.be.exactly(-1);
                    current.rn1.should.not.be.exactly(-1);
                    current.sky.should.not.be.exactly(-1);
                    current.pty.should.not.be.exactly(-1);
                    current.lgt.should.not.be.exactly(-1);

                    current.yesterday.should.have.property('t1h');
                    current.yesterday.t1h.should.not.be.exactly(-50);

                    var arpltn = current.arpltn;
                    arpltn.should.have.property('pm10Grade');
                    arpltn.should.have.property('pm25Grade');
                    arpltn.should.have.property('aqiGrade');
                    arpltn.pm10Grade.should.not.be.exactly(-1);
                    arpltn.pm25Grade.should.not.be.exactly(-1);
                    arpltn.khaiGrade.should.not.be.exactly(-1);

                    arpltn.should.have.property('pm10Value');
                    arpltn.should.have.property('pm25Value');
                    arpltn.should.have.property('aqiValue');
                    arpltn.pm10Value.should.not.be.exactly(-1);
                    arpltn.pm25Value.should.not.be.exactly(-1);
                    arpltn.khaiValue.should.not.be.exactly(-1);

                    res.body.short.forEach(function(sh) {
                        sh.should.have.property('dateObj');
                        sh.should.have.property('t3h');
                        sh.should.have.property('fromToday');

                        sh.t3h.should.not.be.exactly(-50);
                        //신규로 들어온 지역이 아직 short가 모이지 않아 pop에러 발생함.
                        //sh.pop.should.not.be.exactly(-1);
                        sh.pty.should.not.be.exactly(-1);
                        sh.sky.should.not.be.exactly(-1);
                    });

                    var midData = body.midData;
                    midData.should.have.property('dailyData');
                    midData.dailyData.forEach(function (daily) {
                        daily.should.have.property('dateObj');
                        daily.should.have.property('tmn');
                        daily.should.have.property('tmx');
                        daily.should.have.property('skyAm');
                        daily.should.have.property('skyPm');
                        daily.should.have.property('fromToday');
                        daily.should.have.property('dayOfWeek');
                        if (daily.dustForecast) {
                            daily.dustForecast.should.have.property('pm10Grade');
                            daily.dustForecast.should.have.property('pm10Str');
                            daily.dustForecast.should.have.property('pm25Grade');
                            daily.dustForecast.should.have.property('pm25Str');
                        }

                        daily.should.have.property('wfAm');
                        daily.should.have.property('wfPm');
                    });

                    var airInfo = body.airInfo;

                    airInfo.should.have.property('pollutants');
                    airInfo.pollutants.should.have.property('pm10');
                    airInfo.pollutants.should.have.property('pm25');
                    airInfo.pollutants.should.have.property('aqi');
                    assert.equal(airInfo.pollutants.pm10.hourly.length > 26, true);
                    assert.equal(airInfo.pollutants.pm25.hourly.length > 26, true);
                    assert.equal(airInfo.pollutants.aqi.hourly.length > 26, true);
                });
        });

    });
});

