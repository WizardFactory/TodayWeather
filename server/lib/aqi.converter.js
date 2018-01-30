/**
 * Created by aleckim on 2018. 1. 22..
 */

"use strict";

const air_pollutants_breakpoints = {
    "airkorea" : {
        "pm25" : [0, 15, 50, 100, 500],     //ug/m3 (avg 24h)
        "pm10" : [0, 30, 80, 150, 600],     //ug/m3 (avg 24h)
        "o3" : [0, 0.03, 0.09, 0.15, 0.6],  //ppm   (avg 1h)
        "no2" : [0, 0.03, 0.06, 0.2, 2],    //ppm   (avg 1h)
        "co" : [0, 2, 9, 15, 50],           //ppm   (avg 1h)
        "so2" : [0, 0.02, 0.05, 0.15, 1],   //ppm   (avg 1h)
        "aqi" : [0, 50, 100, 250, 500]      //index
    },
    "airkorea_who" : {
        "pm25" : [0, 15, 25, 50, 500],      //ug/m3
        "pm10" : [0, 30, 50, 100, 600],     //ug/m3
        "o3" : [0, 0.03, 0.09, 0.15, 0.6],  //ppm
        "no2" : [0, 0.03, 0.06, 0.2, 2],    //ppm
        "co" : [0, 2, 9, 15, 50],           //ppm
        "so2" : [0, 0.02, 0.05, 0.15, 1],   //ppm
        "aqi" : [0, 50, 100, 250, 500]      //ppm
    },
    "airnow" : {
        "pm25" : [0, 12.0, 35.4, 55.4, 150.4, 250.4, 500.4],    //ug/m3 (avg 24h)
        "pm10" : [0, 54, 154, 254, 354, 424, 604],              //ug/m3 (avg 24h)
        "o3" : [0, 54, 124, 164, 204, 404, 604],                //ppb (avg 8h, 1h)
        "no2" : [0, 53, 100, 360, 649, 1249, 2049],             //ppb (avg 1h)
        "co" : [0, 4.4, 9.4, 12.4, 15.4, 30.4, 50.4],           //ppm (avg 8h)
        "so2" : [0, 35, 75, 185, 304, 604, 1004],               //ppb (avg 1h, 24h)
        "aqi" : [0, 50, 100, 150, 200, 300, 500]                //index
    },
    "aqicn": {
        "pm25" : [0, 35, 75, 115, 150, 250, 500],    //ug/m3 (avg 1h)
        "pm10" : [0, 50, 150, 250, 350, 420, 600],   //ug/m3 (avg 1h)
        "o3" : [0, 160, 200, 300, 400, 800, 1200],    //ug/m3 (avg 1h)
        "no2" : [0, 100, 200, 700, 1200, 2340, 3840], //ug/m3 (avg 1h)
        "co" : [0, 5, 10, 35, 60, 90, 150],          //ug/m3 (avg 1h)
        "so2" : [0, 150, 500, 650, 800, 1600, 2620],  //ug/m3
        "aqi" : [0, 50, 100, 150, 200, 300, 500]
    }
};

class AqiConverter {
    constructor() {
    }

    /**
     *
     * @param airUnit
     * @param code
     * @param grade
     * @returns {{min: *, max: *}}
     */
    static grade2minMaxValue(airUnit, code, grade) {
        let pollutants = air_pollutants_breakpoints[airUnit];
        var min = pollutants[code][grade-1];
        if (code === 'aqi') {
            min += 1;
        }
        else if (airUnit === 'aqicn') {
            min += 0.1;
        }
        else if (airUnit === 'airkorea' || airUnit === 'airkorea_who') {
            if (code === 'pm10' || code === 'pm25' || code === 'co') {
                min += 0.1;
            }
            else if (code === 'o3' || code === 'no2' || code === 'so2') {
                min += 0.001;
            }
            else {
                log.error('Unknown code:'+code, ' unit:'+airUnit);
            }
        }
        else if (airUnit === 'airnow') {
            if (code === 'co' || code === 'pm25')  {
                min += 0.01;
            }
            else {
                min += 0.1;
            }
        }
        else {
            log.error('Unknown code:'+code, ' unit:'+airUnit);
        }
        return {min: min, max: pollutants[code][grade]};
    }

    static ppm2ppb(value) {
        return value*1000;
    }

    /**
     * @param Mal
     *           so2 분자량 : 15.99 + 15.99 + 32.07 = 64.05
     *           no2 분자량 : 15.99 + 15.99 + 14.01 = 45.99
     *           O3 분자량 : 15.99 + 15.99 + 15.99 = 47.97
     *           CO 분자량 : 15.99 + 12.01 = 28
     * @param value
     * @returns {Number}
     * @private
     */
    static ppm2um (Mol, value) {
        var ppb = parseFloat(this.ppm2ppb(value));
        var molList = {
            so2: 64.05,
            no2: 45.99,
            o3: 47.97,
            co: 28.00
        };

        if (molList[Mol] == undefined) {
            return -1;
        }
        return Math.round(ppb * molList[Mol] / 22.4);
    }

    static value2grade(airUnit, code, v) {
        var unit;

        unit = air_pollutants_breakpoints[airUnit][code];

        if (code === 'o3' || code === 'no2' || code === 'so2') {
            if (airUnit === 'airnow') {
                v = this.ppm2ppb(v);
            }
            else if (airUnit == 'aqicn') {
                v = this.ppm2um(code, v);
                if (isNaN(v) || v < 0) {
                    v = 0;
                }
            }
        }
        else if (code === 'co') {
            if (airUnit == 'aqicn') {
                v = this.ppm2um(code, v);
                if (isNaN(v) || v < 0) {
                    v = 0;
                }
            }
        }

        if (unit == undefined) {
            log.error(airUnit, code, v);
        }

        if (v < unit[0]) {
            return -1;
        }
        else if (v <= unit[1]) {
            return 1;
        }
        else if (v <= unit[2]) {
            return 2;
        }
        else if (v <= unit[3]) {
            return 3;
        }
        else if (v > unit[3]) {
            if (unit.length > 4) {
                if (v <= unit[4]) {
                    return 4;
                }
                else if(v <= unit[5]) {
                    return 5;
                }
                else if(v > unit[5]) {
                    return 6;
                }
            }

            return 4;
        }
        return -1;
    }

    static value2index(airUnit, code, value) {
        if (code === 'aqi' || code === 'khai') {
            log.error("You can not calculator about aqi or khai");
            return value;
        }

        var unit = air_pollutants_breakpoints[airUnit][code];
        var aqiUnit = air_pollutants_breakpoints[[airUnit]].aqi;

        // log.info('code: '+code+', unit: '+unit+' value: '+value);
        // log.info('code: aqi, unit: '+aqiUnit);
        var grade = this.value2grade(airUnit, code, value);
        // log.info('code: '+code+', grade:'+grade);

        if (code === 'o3' || code === 'no2' || code === 'so2') {
            if (airUnit === 'airnow') {
                value = value * 1000;   // ppm -> ppb
                log.debug('value: '+value+'ppb');
            }
            else if (airUnit == 'aqicn') {
                value = this.ppm2um(code, value);
                if (isNaN(value) || value < 0) {
                    value = 0;
                }
                log.debug('value: '+value+'ug/m3');
            }
        }
        else if (code === 'co') {
            if (airUnit == 'aqicn') {
                value = this.ppm2um(code, value) * 1000;
                if (isNaN(value) || value < 0) {
                    value = 0;
                }
                log.debug('value: '+value+'ug/m3');
            }
        }

        return Math.round((aqiUnit[grade]-aqiUnit[grade-1])/(unit[grade] - unit[grade-1])*(value - unit[grade-1]) + aqiUnit[grade-1]);
    }
}

function _getAirKoreaActionGudie(grade, ts) {
    switch (grade) {
        case 1:
            return ts.__("LOC_NO_WORRIES_ABOUT_OUTDOOR_ACTIVITIES");
        case 2:
            return ts.__("LOC_SENSITIVE_PEOPLE_SHOULD_BE_CAREFUL");
        case 3:
            return ts.__("LOC_WEAR_A_DUST_MASK_WHEN_YOU_GO_OUT");
        case 4:
            return ts.__("LOC_DO_NOT_GO_OUT");
    }
}

function _getAirNowActionGudie(grade, ts) {
    switch (grade) {
        case 1:
            return ts.__("LOC_NO_WORRIES_ABOUT_OUTDOOR_ACTIVITIES");
        case 2:
            return ts.__("LOC_SENSITIVE_PEOPLE_SHOULD_BE_CAREFUL");
        case 3:
            return ts.__("LOC_SENSITIVE_PEOPLE_WEAR_DUST_MASK");
        case 4:
            return ts.__("LOC_WEAR_A_DUST_MASK_WHEN_YOU_GO_OUT");
        case 5:
            return ts.__("LOC_DO_NOT_GO_OUT_ON_SENSITIVE_PEOPLE");
        case 6:
            return ts.__("LOC_DO_NOT_GO_OUT");
    }
}

AqiConverter.getActionGuide = function (airUnit, grade, translate) {
    var ts = translate == undefined?global:translate;

    if (airUnit === 'aqicn' || airUnit === 'airnow') {
        return _getAirNowActionGudie(grade, ts);
    }
    else {
        return _getAirKoreaActionGudie(grade, ts);
    }
    return "";
};

module.exports = AqiConverter;
