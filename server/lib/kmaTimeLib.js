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
    var y = str.substr(0,4),
        m = str.substr(4,2) - 1,
        d = str.substr(6,2),
        h = str.substr(8,2);
    if (h!== '') {
        h = str.substr(8,2);
    }
    else {
        h = '0';
    }
    var D = new Date(y,m,d, h);
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

kmaTimeLib.convertDateToHHMM = function(date) {
    //I don't know why one more create Date object by aleckim
    var d = new Date(date);
    var hh = '' + (d.getHours());
    if (hh.length < 2)  {hh = '0'+hh; }

    return hh+'00';
};

module.exports = kmaTimeLib;
