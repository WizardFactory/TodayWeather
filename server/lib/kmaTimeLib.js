/**
 * Created by aleckim on 2016. 2. 13..
 */

var kmaTimeLib = {};

/**
 *
 * @param str
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
        min = str.substr(10,2);

    if (h == '') {
        h = '0';
    }
    if (min == '') {
        min = '0';
    }
    var D = new Date(y,m,d,h,min);
    return (D.getFullYear() == y && D.getMonth() == m && D.getDate() == d) ? D : undefined;
};

/**
 *
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

kmaTimeLib.convertDateToHHZZ = function(date) {
    //I don't know why one more create Date object by aleckim
    var d = new Date(date);
    var hh = '' + (d.getHours());
    if (hh.length < 2)  {hh = '0'+hh; }

    return hh+'00';
};

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
 * return format YYYY-MM-DD
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

kmaTimeLib.convertYYYYMMDDtoYYYY_MM_DD = function (dateStr) {
    return dateStr.substr(0,4)+'-'+dateStr.substr(4,2)+'-'+dateStr.substr(6,2);
};

kmaTimeLib.convertYYYY_MM_DDtoYYYYMMDD = function (dateStr) {
    return dateStr.substr(0,4)+dateStr.substr(5,2)+dateStr.substr(8,2);
};

kmaTimeLib.convertYYYYMMDDHHMMtoYYYYoMMoDDoHHoMM = function(dateStr) {
    var str = dateStr.substr(0,4)+'.'+dateStr.substr(4,2)+'.'+dateStr.substr(6,2);
    if (dateStr.length > 8) {
        str += '.' + dateStr.substr(8,2) + ':' + dateStr.substr(10,2);
    }
    return str;
};

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
 * 2017년 06월 18일 15시 00분
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

module.exports = kmaTimeLib;
