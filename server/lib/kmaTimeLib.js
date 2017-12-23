/**
 * Created by aleckim on 2016. 2. 13..
 */

'use strict';

var kmaTimeLib = {};

/**
 * 201712242255 -> date
 * @param str YYYYmmDDHHMMSS
 * @returns {*}
 */
kmaTimeLib.convertStringToDate = function(str) {
    if (!str) {
        return new Date(0);
    }

    var y = str.substr(0,4),
        m = str.substr(4,2) - 1,
        d = str.substr(6,2),
        h = str.substr(8,2),
        min = str.substr(10,2),
        sec = str.substr(12,2);

    if (h == '') {
        h = '0';
    }
    if (min == '') {
        min = '0';
    }
    if (sec == '') {
        sec = '0';
    }
    var D = new Date(y,m,d,h,min, sec);
    return (D.getFullYear() == y && D.getMonth() == m && D.getDate() == d) ? D : undefined;
};

/**
 * Date -> 20171007
 * @param date
 * @returns {string}
 */
kmaTimeLib.convertDateToYYYYMMDD = function(date) {

    //I don't know why one more create Date object by aleckim
    var d = new Date(date);
    var month = '' + (d.getMonth() + 1);
    var day = '' + d.getDate();
    var year = d.getFullYear();

    if (month.length < 2) { month = '0' + month; }
    if (day.length < 2) { day = '0' + day; }

    return year+month+day;
};

/**
 * Date -> 1200
 * @param date
 * @returns {string}
 */
kmaTimeLib.convertDateToHHZZ = function(date) {
    //I don't know why one more create Date object by aleckim
    var d = new Date(date);
    var hh = '' + (d.getHours());
    if (hh.length < 2)  {hh = '0'+hh; }

    return hh+'00';
};

/**
 * Date -> 1210
 * @param date
 * @returns {string}
 */
kmaTimeLib.convertDateToHHMM = function(date) {
    //I don't know why one more create Date object by aleckim
    var d = new Date(date);
    var hh = '' + (d.getHours());
    if (hh.length < 2)  {hh = '0'+hh; }

    var mm = '' + (d.getMinutes());
    if (mm.length < 2)  {mm = '0'+mm; }

    return hh+mm;
};

kmaTimeLib.toTimeZone = function (zone, time) {
    if (time == undefined) {
       time = new Date();
    }

    var tz = time.getTime() + (time.getTimezoneOffset() * 60000) + (9* 3600000);
    time.setTime(tz);

    return time;
};

/**
 *  Date -> 2017-10-17
 * @param date
 * @returns {string}
 */
kmaTimeLib.convertDateToYYYY_MM_DD = function (date) {
    if (date == undefined) {
        date = kmaTimeLib.toTimeZone(9);
    }

    return date.getFullYear()+
        '-'+manager.leadingZeros(date.getMonth()+1, 2)+
        '-'+manager.leadingZeros(date.getDate(), 2);
};

/**
 * 20170107 -> 2017-10-07
 * @param dateStr
 * @returns {string}
 */
kmaTimeLib.convertYYYYMMDDtoYYYY_MM_DD = function (dateStr) {
    return dateStr.substr(0,4)+'-'+dateStr.substr(4,2)+'-'+dateStr.substr(6,2);
};

/**
 * 2017-01-07 -> 20171007
 * 2017.01.07 -> 20171007
 * @param dateStr
 * @returns {string}
 */
kmaTimeLib.convertYYYY_MM_DDtoYYYYMMDD = function (dateStr) {
    return dateStr.substr(0,4)+dateStr.substr(5,2)+dateStr.substr(8,2);
};

/**
 * 201701071210 -> 2017.10.07.12:10
 * @param dateStr
 * @returns {string}
 */
kmaTimeLib.convertYYYYMMDDHHMMtoYYYYoMMoDDoHHoMM = function(dateStr) {
    var str = dateStr.substr(0,4)+'.'+dateStr.substr(4,2)+'.'+dateStr.substr(6,2);
    if (dateStr.length > 8) {
        str += '.' + dateStr.substr(8,2) + ':' + dateStr.substr(10,2);
    }
    return str;
};

/**
 * 201701071210 -> 2017.10.07 12:10
 * @param dateStr
 * @returns {string}
 */
kmaTimeLib.convertYYYYMMDDHHMMtoYYYYoMMoDD_HHoMM = function(dateStr) {
    var str = dateStr.substr(0,4)+'.'+dateStr.substr(4,2)+'.'+dateStr.substr(6,2);
    if (dateStr.length > 8) {
        str += ' ' + dateStr.substr(8,2) + ':' + dateStr.substr(10,2);
    }
    return str;
};

/**
 * 201701071210 -> 2017.10.07 12:00
 * @param dateStr
 * @returns {string}
 */
kmaTimeLib.convertYYYYMMDDHHMMtoYYYYoMMoDD_HHoZZ = function(dateStr) {
    var str = dateStr.substr(0,4)+'.'+dateStr.substr(4,2)+'.'+dateStr.substr(6,2);
    if (dateStr.length > 8) {
        str += ' ' + dateStr.substr(8,2) + ':00';
    }
    return str;
};

/**
 * 201701071210 -> 2017.10.07.12:00
 * @param dateStr
 * @returns {string}
 */
kmaTimeLib.convertYYYYMMDDHHMMtoYYYYoMMoDDoHHoZZ = function(dateStr) {
    var str = dateStr.substr(0,4)+'.'+dateStr.substr(4,2)+'.'+dateStr.substr(6,2);
    if (dateStr.length > 8) {
        str += '.' + dateStr.substr(8,2) + ':00';
    }
    return str;
};

/**
 * 2017.01.07.15:00 -> 201701071500
 * @param dateStr
 * @returns {string}
 */
kmaTimeLib.convertYYYYoMMoDDoHHoMMtoYYYYMMDDHHMM = function(dateStr) {
    var str = dateStr.substr(0,4)+dateStr.substr(5,2)+dateStr.substr(8,2);
    if (dateStr.length > 10) {
        str += dateStr.substr(11,2) + dateStr.substr(14,2);
    }
    return str;
};

/**
 * 2017.01.07.15:10 -> 1510
 * @param dateStr
 * @returns {string}
 */
kmaTimeLib.convertYYYYoMMoDDoHHoMMtoHHMM = function(dateStr) {
    var str = "";
    if (dateStr.length > 10) {
        str += dateStr.substr(11,2) + dateStr.substr(14,2);
    }
    return str;
};

/**
 * 2017.01.07.15:10 -> 2017.01.07 15:10
 * @param dateStr
 * @returns {string}
 */
kmaTimeLib.convertYYYYoMMoDDoHHoMMtoYYYYoMMoDD_HHoMM = function(dateStr) {
    var str = dateStr.substr(0,4)+'.'+dateStr.substr(5,2)+'.'+dateStr.substr(8,2);
    if (dateStr.length > 10) {
        str += ' ' + dateStr.substr(11,2)+ ':' + dateStr.substr(14,2);
    }
    return str;
};

/**
 * for kma scraper
 * @param date
 * @returns {string}
 */
kmaTimeLib.convertDateToYYYYoMMoDDoHHoZZ = function (date) {
    if (date == undefined) {
        date = kmaTimeLib.toTimeZone(9);
    }

    return date.getFullYear()+
        '.'+manager.leadingZeros(date.getMonth()+1, 2)+
        '.'+manager.leadingZeros(date.getDate(), 2) +
        '.'+manager.leadingZeros(date.getHours(), 2) +
        ':00';
};

kmaTimeLib.convertDateToYYYYoMMoDDoHHoMM = function (date) {
    if (date == undefined) {
        date = kmaTimeLib.toTimeZone(9);
    }

    return date.getFullYear()+
        '.'+manager.leadingZeros(date.getMonth()+1, 2)+
        '.'+manager.leadingZeros(date.getDate(), 2) +
        '.'+manager.leadingZeros(date.getHours(), 2) +
        ':'+manager.leadingZeros(date.getMinutes(), 2);
};

kmaTimeLib.convertDateToYYYYoMMoDD_HHoZZ = function (date) {
    if (date == undefined) {
        date = kmaTimeLib.toTimeZone(9);
    }

    return date.getFullYear()+
        '.'+manager.leadingZeros(date.getMonth()+1, 2)+
        '.'+manager.leadingZeros(date.getDate(), 2) +
        ' '+manager.leadingZeros(date.getHours(), 2) +
        ':00';
};

kmaTimeLib.convertDateToYYYYoMMoDD_HHoMM = function (date) {
    if (date == undefined) {
        date = kmaTimeLib.toTimeZone(9);
    }

    return date.getFullYear()+
        '.'+manager.leadingZeros(date.getMonth()+1, 2)+
        '.'+manager.leadingZeros(date.getDate(), 2) +
        ' '+manager.leadingZeros(date.getHours(), 2) +
        ':'+manager.leadingZeros(date.getMinutes(), 2);
};

kmaTimeLib.convertDateToYYYY_MM_DD_HHoMM = function (date) {
    if (date == undefined) {
        date = kmaTimeLib.toTimeZone(9);
    }

    return date.getFullYear()+
        '-'+manager.leadingZeros(date.getMonth()+1, 2)+
        '-'+manager.leadingZeros(date.getDate(), 2) +
        ' '+manager.leadingZeros(date.getHours(), 2) +
        ':'+manager.leadingZeros(date.getMinutes(), 2);
};

kmaTimeLib.convert0Hto24H = function (obj) {
    if (obj.time === "0000") {
        var D = kmaTimeLib.convertStringToDate(obj.date);
        D.setDate(D.getDate()-1);
        //date = back one day
        //date = (parseInt(short.date)-1).toString();
        obj.time = "2400";
        obj.date = kmaTimeLib.convertDateToYYYYMMDD(D);
    }
};

kmaTimeLib.convert24Hto0H = function (obj) {
    if (obj.time === "2400") {
        var D = kmaTimeLib.convertStringToDate(obj.date);
        D.setDate(D.getDate()+1);
        //date = back one day
        //date = (parseInt(short.date)-1).toString();
        obj.time = "0000";
        obj.date = kmaTimeLib.convertDateToYYYYMMDD(D);
    }
};

kmaTimeLib.compareDateTime = function (objA, objB) {
    var self = this;
    var tempA = JSON.parse(JSON.stringify(objA));
    var tempB = JSON.parse(JSON.stringify(objB));

    self.convert0Hto24H(tempA);
    self.convert0Hto24H(tempB);

    if (tempA.date === tempB.date && tempA.time === tempB.time) {
        return true;
    }

    return false;
};

/**
 * 2017년 06월 18일 15시 00분 -> date
 * @param str
 */
kmaTimeLib.convertKoreaStr2Date = function (str) {
    var strArray = str.split(' ');
    var y = strArray[0].substr(0, 4);
    var m = strArray[1].substr(0, 2) - 1;
    var d = strArray[2].substr(0, 2);
    var h = strArray[3].substr(0, 2);
    var min = strArray[4].substr(0, 2);

    var D = new Date(y,m,d,h,min);
    return (D.getFullYear() == y && D.getMonth() == m && D.getDate() == d) ? D : undefined;
};

kmaTimeLib.leadingZeros = function(n, digits) {
    var zero = '';
    n = n.toString();

    if(n.length < digits) {
        for(var i = 0; i < digits - n.length; i++){
            zero += '0';
        }
    }
    return zero + n;
};

kmaTimeLib.getPast3DaysTime = function(curTime){
    var now = new Date(curTime.getTime());
    var tz = now.getTime() + (-72 * 3600000);
    //var tz = now.getTime() + (3 * 3600000);
    now.setTime(tz);

    return now;
};

kmaTimeLib.getPast8DaysTime = function(curTime){
    var now = new Date(curTime.getTime());
    var tz = now.getTime() + (-192 * 3600000);
    //var tz = now.getTime() + (3 * 3600000);
    now.setTime(tz);

    return now;
};

kmaTimeLib.getKoreaDateObj = function(curTime){
    return new Date(curTime.slice(0,4)+ '-' + curTime.slice(4,6) + '-' + curTime.slice(6,8) + 'T' + curTime.slice(8,10) + ':' + curTime.slice(10,12) + ':00+09:00');
};


kmaTimeLib.getKoreaTimeString = function(curTime){
    var now = new Date(curTime.getTime());
    var tz = now.getTime() + (9 * 3600000);

    now.setTime(tz);

    var result =
        kmaTimeLib.leadingZeros(now.getUTCFullYear(), 4) +
        kmaTimeLib.leadingZeros(now.getUTCMonth() + 1, 2) +
        kmaTimeLib.leadingZeros(now.getUTCDate(), 2) +
        kmaTimeLib.leadingZeros(now.getUTCHours(), 2) +
        kmaTimeLib.leadingZeros(now.getUTCMinutes(), 2);

    return result;
};

kmaTimeLib.getDiffDays = function(target, current) {
    if (!target || !current) {
        log.error("target or current is invalid");
        return 0;
    }
    if (typeof target === 'string') {
        target = new Date(target);
    }
    if (typeof current === 'string') {
        current = new Date(current);
    }

    var targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());
    var date = new Date(current.getFullYear(), current.getMonth(), current.getDate());
    return Math.ceil((targetDay - date) / (1000 * 3600 * 24));
};

module.exports = kmaTimeLib;
