/**
 * Created by aleckim on 2016. 3. 16..
 */

var Logger = require('../lib/log');
global.log  = new Logger(__dirname + "/debug.log");

var assert  = require('assert');

var kmaTimeLib = require('../lib/kmaTimeLib');


describe('unit test - kma time lib', function() {
    it('test convertStringToDate', function() {
        var date = kmaTimeLib.convertStringToDate('20160316');
        assert('2016', date.getFullYear(), 'Fail to convert string to date')
    });

    it('test convertDateToYYYYMMDD', function () {
        var date = new Date();
        var yyyymmdd = kmaTimeLib.convertDateToYYYYMMDD(date);
        var target = ''+ date.getFullYear();
        target += date.getMonth()+1 < 10 ? '0'+(date.getMonth()+1):date.getMonth()+1;
        target += date.getDate()<10 ? '0' + date.getDate():date.getDate();
        assert(yyyymmdd, target, 'Fail to convert date to yyyymmdd');
    });

    it('test convertDateToHHZZ', function () {
        var date = new Date();
        var hhmm = kmaTimeLib.convertDateToHHZZ(date);
        var target = date.getHours() < 10 ? '0'+ date.getHours(): ''+date.getHours();
        target += '00';
        assert(hhmm, target, 'Fail to convert date to hhmm');
    });

    it('test compareDateTime', function () {
        var timeA = {date:"20160629", time:"2400"};
        var timeB = {date:"20160630", time:"0000"};

        assert(kmaTimeLib.compareDateTime(timeA, timeB), true, 'Fail compare date time');
    });

    it('test convertStringToDate', function() {
        var date = kmaTimeLib.convertStringToDate('2016031600');
        assert(date.getMonth()+1==3, true, 'Fail to convert string to date')
    });

    it('test convertStringToDate', function() {
        var date = kmaTimeLib.convertStringToDate('201603160010');
        assert(date.getMinutes()==10, true, 'Fail to convert string to date')
    });

    it('test toLocalTime ', function () {
        var current = new Date();
        var local = kmaTimeLib.toLocalTime(current.getTimezoneOffset()*(-1), new Date(current));
        assert.equal(current.toISOString(), local.toISOString());
    });

    it('test toLocalTime ', function () {
        var current = new Date();
        var local = kmaTimeLib.toLocalTime(current.getTimezoneOffset()*(-1)-60, new Date(current));
        current.setMinutes(current.getMinutes()-60);
        assert.equal(current.toISOString(), local.toISOString());
    });
});
