/**
 * Created by aleckim on 2017. 2. 3..
 */

"use strict";

/**
 *
 * @constructor
 */
function UnitConverter() {

}

//setUnits
UnitConverter.prototype._convertTemperature = function(from, to, val) {
    if ( from == 'C') {
        if (to == 'F') {
            return parseFloat((val/(5/9)+32).toFixed(1));
        }
    }
    else if (from =='F') {
        if (to == 'C') {
            return parseFloat(((val - 32) / (9/5)).toFixed(1));
        }
    }
    log.error('Fail to convert from '+from+" to "+to+" value="+val);
    return val;
};

UnitConverter.prototype._getBeaufort = function(ms) {
    if (ms < 0.3) {
        return 0;
    }
    else if (ms < 1.5) {
        return 1;
    }
    else if (ms < 3.3) {
        return 2;
    }
    else if (ms < 5.5) {
        return 3;
    }
    else if (ms < 8.0) {
        return 4;
    }
    else if (ms < 10.8) {
        return 5;
    }
    else if (ms < 13.9) {
        return 6;
    }
    else if (ms < 17.2) {
        return 7;
    }
    else if (ms < 20.7) {
        return 8;
    }
    else if (ms < 24.5) {
        return 9;
    }
    else if (ms < 28.4) {
        return 10;
    }
    else if (ms < 32.6) {
        return 11;
    }
    else if (ms >= 32.6) {
        return 12;
    }
};

UnitConverter.prototype._convertBeaufortToMs = function(val) {
    switch (val) {
        case 0: return 0;
        case 1: return 0.3;
        case 2: return 1.5;
        case 3: return 3.3;
        case 4: return 5.5;
        case 5: return 8.0;
        case 6: return 10.8;
        case 7: return 13.9;
        case 8: return 17.2;
        case 9: return 20.7;
        case 10: return 24.5;
        case 11: return 28.4;
        case 12: return 32.6;
    }
};

UnitConverter.prototype._convertWindSpeed = function(from, to, val) {
    var self = this;

    switch(from) {
        case 'mph':
            switch (to) {
                case 'km/h':
                    return parseFloat((val * 1.609344).toFixed(1));
                    break;
                case 'm/s':
                    return parseFloat((val * 0.44704).toFixed(1));
                    break;
                case 'bft':
                    return self._getBeaufort(parseFloat((val * 0.44704).toFixed(1)));
                    break;
                case 'kt':
                    return parseFloat((val * 0.868976).toFixed(1));
                    break;
            }
            break;
        case 'km/h':
            switch (to) {
                case 'mph':
                    return parseFloat((val * 0.621371).toFixed(1));
                    break;
                case 'm/s':
                    return parseFloat((val * 0.277778).toFixed(1));
                    break;
                case 'bft':
                    return self._getBeaufort(parseFloat((val * 0.277778).toFixed(1)));
                    break;
                case 'kt':
                    return parseFloat((val * 0.539957).toFixed(1));
                    break;
            }
            break;
        case 'm/s':
            switch (to) {
                case 'mph':
                    return parseFloat((val * 2.236936).toFixed(1));
                    break;
                case 'km/h':
                    return parseFloat((val * 3.6).toFixed(1));
                    break;
                case 'bft':
                    return self._getBeaufort(val);
                    break;
                case 'kt':
                    return parseFloat((val * 1.943844).toFixed(1));
                    break;
            }
            break;
        case 'bft':
            var ms = self._convertBeaufortToMs(val);
            switch (to) {
                case 'mph':
                    return parseFloat((ms * 2.236936).toFixed(1));
                    break;
                case 'km/h':
                    return parseFloat((ms * 3.6).toFixed(1));
                    break;
                case 'm/s':
                    return ms;
                    break;
                case 'kt':
                    return parseFloat((ms * 1.943844).toFixed(1));
                    break;
            }
            break;
        case 'kt':
            switch (to) {
                case 'mph':
                    return parseFloat((val * 1.150779).toFixed(1));
                    break;
                case 'km/h':
                    return parseFloat((val * 1.852).toFixed(1));
                    break;
                case 'm/s':
                    return parseFloat((val * 0.514444).toFixed(1));
                    break;
                case 'bft':
                    return self._getBeaufort(parseFloat((val * 0.514444).toFixed(1)));
                    break;
            }
            break;
    }
};

UnitConverter.prototype._convertPressure = function(from, to, val) {
    switch (from) {
        case 'mmHg':
            switch (to) {
                case 'inHg' :
                    return parseFloat((val*0.03937).toFixed(1));
                    break;
                case 'hPa' :
                case 'mb' :
                    return parseFloat((val*1.333224).toFixed(1));
                    break;
            }
            break;
        case 'inHg':
            switch (to) {
                case 'mmHg' :
                    return parseFloat((val*25.4).toFixed(1));
                    break;
                case 'hPa' :
                case 'mb' :
                    return parseFloat((val*33.863882).toFixed(1));
                    break;
            }
            break;
        case 'hPa':
        case 'mb':
            switch (to) {
                case 'mmHg' :
                    return parseFloat((val*0.750062).toFixed(1));
                    break;
                case 'inHg' :
                    return parseFloat((val*0.02953).toFixed(1));
                    break;
                case 'hPa' :
                case 'mb' :
                    return val;
                    break;
            }
    }
};

UnitConverter.prototype._convertDistance = function(from, to, val) {
    if (from == 'm') {
        return parseFloat((val*39.370079).toFixed(1));
    }
    else if (from =='mi') {
        return parseFloat((val*0.0254).toFixed(1));
    }
};

UnitConverter.prototype._convertPrecipitation = function(from, to, val) {
    if (from == 'mm') {
        return parseFloat((val*0.03937).toFixed(1));
    }
    else if (from =='in') {
        return parseFloat((val*25.4).toFixed(1));
    }
};

UnitConverter.prototype.convertUnits = function (from, to, val) {
    var self = this;

    if (val == undefined) {
        log.error("val is undefined!!");
        return val;
    }
    if (from == to) {
        return val;
    }

    if (from == 'C' || from == 'F') {
        return self._convertTemperature(from, to, val);
    }
    if (from == 'mph' || from == 'km/h' || from == 'm/s' || from == 'bft' || from == 'kt') {
        return self._convertWindSpeed(from, to, val);
    }
    if (from == 'mmHg' || from == 'inHg' || from == 'hPa' || from == 'mb') {
        return self._convertPressure(from, to, val);
    }
    if (from == 'm' || from == 'mi') {
        return self._convertDistance(from, to, val);
    }
    if (from == 'mm' || from == 'in') {
        return self._convertPrecipitation(from, to, val);
    }

    log.error('Fail to convert from '+from+" to "+to+" value="+val);
    return val;
};

module.exports = UnitConverter;

