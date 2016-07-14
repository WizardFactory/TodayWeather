/**
 * Created by User on 2015-11-08.
 */

Date.prototype.format = (function(f){
    if(!this.valueOf()) return " ";

    var d = this;
    var reg = /(yyyy|MM|dd|HH|mm|ss)/gi;
    return f.replace(reg, function($1){
        switch($1){
            case "yyyy":return d.getFullYear();
            case "MM":return (d.getMonth()+1).zf(2);
            case "dd": return d.getDate().zf(2);
            case "HH": return d.getHours().zf(2);
            case "mm": return d.getMinutes().zf(2);
            case "ss": return d.getSeconds().zf(2);
            default : return $1;
        }
    });
});

String.prototype.string = function(len){var s = '', i = 0; while (i++ < len) { s += this; } return s;};
String.prototype.zf = function(len){return "0".string(len - this.length) + this;};
Number.prototype.zf = function(len){return this.toString().zf(len);};

function DateUtil(){}

DateUtil.prototype.getNextTime = function (date, time, next){
    var d = new Date();
    var result = { date: '', time: '' };
    var temp = '';
    d.setFullYear(date.slice(0, 4));
    d.setMonth(date.slice(4, 6) - 1);
    d.setDate(date.slice(6, 8));
    d.setHours(time.slice(0, 2));
    d.setMinutes(time.slice(2, 4));
    d.setHours(d.getHours() + next);
    temp = d.format('yyyyMMddHHmm');
    result.date = temp.slice(0, 8);
    result.time = temp.slice(8, 12);
    return result;
};

DateUtil.prototype.getNextDate = function(date, time, next){
    var d = new Date();
    var result = {date: '', time: ''};
    var temp = '';
    d.setFullYear(date.slice(0, 4));
    d.setMonth(date.slice(4, 6) - 1);
    d.setDate(date.slice(6, 8));
    d.setDate(d.getDate() + next);
    d.setHours(time.slice(0, 2));
    d.setMinutes(time.slice(2, 4));
    temp = d.format('yyyyMMddHHmm');
    result.date = temp.slice(0, 8);
    result.time = temp.slice(8, 12);
    return result;
}

module.exports = DateUtil;