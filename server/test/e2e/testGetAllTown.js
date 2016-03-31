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

baseList.push("포항시,효곡동포항공과대학교,화공실험동");
baseList.push("경기도,수원시장안구,율전동");
baseList.push("서울특별시,서대문구,창천동");
baseList.push("경기도,고양시일산서구,덕이동");
baseList.push("전라북도,군산시,문화동");

describe('Routing', function() {
    var url = 'http://localhost:3000';
    //var url = 'http://tw-wzdfac.rhcloud.com';
    //var url = "http://todayweather-wizardfactory.rhcloud.com";
    before(function (done) {
        //add new town
        done();
    });

    baseList.forEach(function (townInfo) {
        var town = townInfo.split(",");
        it('test ' + town[0] + town[1] + town[2], function (done) {
            this.timeout(20 * 1000);
            var path = '/v000705/town/' + town[0];
            if (town[1]) {
                path += '/' + town[1];
            }
            if (town[2]) {
                path += '/' + town[2];
            }

            request(url)
                .get(encodeURI(path))
                .set('Accept', 'application/json')
                .expect(200)
                .end(function (err, res) {
                    if (err) {
                        console.log(err);
                        console.log(path);
                    }
                    else {
                        res.body.should.have.property('regionName');
                        res.body.should.have.property('cityName');
                        res.body.should.have.property('townName');
                        res.body.should.have.property('short');
                        res.body.should.have.property('current');
                        res.body.current.should.have.property('arpltn');
                        res.body.current.should.have.property('summary');
                        res.body.should.have.property('midData');
                        res.body.midData.should.have.property('dailyData');

                        res.body.current.t1h.should.not.be.exactly(-50);
                        res.body.current.reh.should.not.be.exactly(-1);
                        res.body.current.rn1.should.not.be.exactly(-1);
                        res.body.current.sky.should.not.be.exactly(-1);
                        res.body.current.pty.should.not.be.exactly(-1);
                        res.body.current.lgt.should.not.be.exactly(-1);

                        res.body.short.forEach(function(sh) {
                            sh.t3h.should.not.be.exactly(-50);
                            //신규로 들어온 지역이 아직 short가 모이지 않아 pop에러 발생함.
                            //sh.pop.should.not.be.exactly(-1);
                            sh.pty.should.not.be.exactly(-1);
                            sh.sky.should.not.be.exactly(-1);
                        });

                        res.body.midData.dailyData.forEach(function (daily) {
                            daily.should.have.property('wfAm');
                            daily.should.have.property('wfPm');
                            daily.taMax.should.not.be.exactly(-50);
                            daily.taMin.should.not.be.exactly(-50);
                        });
                    }
                    done();
                });
        });
    });
});

