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
        "aqi" : [0, 50, 100, 250, 500]      //index
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
        "co" : [0, 5, 10, 35, 60, 90, 150],          //mg/m3 (avg 1h)
        "so2" : [0, 150, 500, 650, 800, 1600, 2620],  //ug/m3
        "aqi" : [0, 50, 100, 150, 200, 300, 500]
    }
};


const airnowUnit = {
    pm25:{
        good : {Clo:0, Chi:12.0, Ilo:0, Ihi:50},
        moderate : {Clo:12.1, Chi:35.4, Ilo:51, Ihi:100},
        unhealthy_sensitive : {Clo:35.5, Chi:55.4, Ilo:101, Ihi:150},
        unhealthy : {Clo:55.5, Chi:150.4, Ilo:151, Ihi:200},
        very_unhealthy:{Clo:150.5, Chi:250.4, Ilo:201, Ihi:300},
        hazardous:{Clo:250.5, Chi:350.4, Ilo:301, Ihi:400},
        extra_hazardous:{Clo:350.5, Chi:500.4, Ilo:401, Ihi:500}
    },
    pm10:{
        good : {Clo:0, Chi:54, Ilo:0, Ihi:50},
        moderate : {Clo:55, Chi:154, Ilo:51, Ihi:100},
        unhealthy_sensitive : {Clo:155, Chi:254, Ilo:101, Ihi:150},
        unhealthy : {Clo:255, Chi:354, Ilo:151, Ihi:200},
        very_unhealthy:{Clo:355, Chi:424, Ilo:201, Ihi:300},
        hazardous:{Clo:425, Chi:504, Ilo:301, Ihi:400},
        extra_hazardous:{Clo:505, Chi:604, Ilo:401, Ihi:500}
    },
    o3:{
        good : {Clo:0, Chi:54, Ilo:0, Ihi:50},
        moderate : {Clo:55, Chi:70, Ilo:51, Ihi:100},
        unhealthy_sensitive : {Clo:71, Chi:85, Ilo:101, Ihi:150},
        unhealthy : {Clo:86, Chi:105, Ilo:151, Ihi:200},
        very_unhealthy:{Clo:106, Chi:200, Ilo:201, Ihi:300},
        hazardous:{Clo:201, Chi:504, Ilo:301, Ihi:400},
        extra_hazardous:{Clo:505, Chi:604, Ilo:401, Ihi:500}
    },
    co:{
        good : {Clo:0, Chi:4.4, Ilo:0, Ihi:50},
        moderate : {Clo:4.5, Chi:9.4, Ilo:51, Ihi:100},
        unhealthy_sensitive : {Clo:9.5, Chi:12.4, Ilo:101, Ihi:150},
        unhealthy : {Clo:12.5, Chi:15.4, Ilo:151, Ihi:200},
        very_unhealthy:{Clo:15.5, Chi:30.4, Ilo:201, Ihi:300},
        hazardous:{Clo:30.5, Chi:40.4, Ilo:301, Ihi:400},
        extra_hazardous:{Clo:40.5, Chi:50.4, Ilo:401, Ihi:500}
    },
    no2:{
        good : {Clo:0, Chi:53, Ilo:0, Ihi:50},
        moderate : {Clo:54, Chi:100, Ilo:51, Ihi:100},
        unhealthy_sensitive : {Clo:101, Chi:360, Ilo:101, Ihi:150},
        unhealthy : {Clo:361, Chi:649, Ilo:151, Ihi:200},
        very_unhealthy:{Clo:650, Chi:1249, Ilo:201, Ihi:300},
        hazardous:{Clo:1250, Chi:1649, Ilo:301, Ihi:400},
        extra_hazardous:{Clo:1650, Chi:2049, Ilo:401, Ihi:500}
    },
    so2:{
        good : {Clo:0, Chi:35, Ilo:0, Ihi:50},
        moderate : {Clo:36, Chi:75, Ilo:51, Ihi:100},
        unhealthy_sensitive : {Clo:76, Chi:185, Ilo:101, Ihi:150},
        unhealthy : {Clo:186, Chi:304, Ilo:151, Ihi:200},
        very_unhealthy:{Clo:305, Chi:604, Ilo:201, Ihi:300},
        hazardous:{Clo:605, Chi:1004, Ilo:301, Ihi:400},
        extra_hazardous:{Clo:605, Chi:1004, Ilo:401, Ihi:500}
    }
};
/* This is China's table, currently it's not necessary to use because aqicn follows airnow data and table.
const aqicnUnit = {
    pm25:{
        good : {BPlo:0, BPhi:35, Ilo:0, Ihi:50},
        moderate : {BPlo:35, BPhi:75, Ilo:51, Ihi:100},
        unhealthy_sensitive : {BPlo:75, BPhi:115, Ilo:101, Ihi:150},
        unhealthy : {BPlo:115, BPhi:150, Ilo:151, Ihi:200},
        very_unhealthy:{BPlo:150, BPhi:250, Ilo:201, Ihi:300},
        hazardous:{BPlo:250, BPhi:350, Ilo:301, Ihi:400},
        extra_hazardous:{BPlo:350, BPhi:500, Ilo:401, Ihi:500}
    },
    pm10:{
        good : {BPlo:0, BPhi:50, Ilo:0, Ihi:50},
        moderate : {BPlo:50, BPhi:150, Ilo:51, Ihi:100},
        unhealthy_sensitive : {BPlo:150, BPhi:250, Ilo:101, Ihi:150},
        unhealthy : {BPlo:250, BPhi:350, Ilo:151, Ihi:200},
        very_unhealthy:{BPlo:350, BPhi:420, Ilo:201, Ihi:300},
        hazardous:{BPlo:420, BPhi:500, Ilo:301, Ihi:400},
        extra_hazardous:{BPlo:500, BPhi:600, Ilo:401, Ihi:500}
    },
    o3:{
        good : {BPlo:0, BPhi:160, Ilo:0, Ihi:50},
        moderate : {BPlo:160, BPhi:200, Ilo:51, Ihi:100},
        unhealthy_sensitive : {BPlo:200, BPhi:300, Ilo:101, Ihi:150},
        unhealthy : {BPlo:300, BPhi:400, Ilo:151, Ihi:200},
        very_unhealthy:{BPlo:400, BPhi:800, Ilo:201, Ihi:300},
        hazardous:{BPlo:800, BPhi:1000, Ilo:301, Ihi:400},
        extra_hazardous:{BPlo:1000, BPhi:1200, Ilo:401, Ihi:500}
    },
    co:{
        good : {BPlo:0, BPhi:5, Ilo:0, Ihi:50},
        moderate : {BPlo:5, BPhi:10, Ilo:51, Ihi:100},
        unhealthy_sensitive : {BPlo:10, BPhi:35, Ilo:101, Ihi:150},
        unhealthy : {BPlo:35, BPhi:60, Ilo:151, Ihi:200},
        very_unhealthy:{BPlo:60, BPhi:90, Ilo:201, Ihi:300},
        hazardous:{BPlo:90, BPhi:120, Ilo:301, Ihi:400},
        extra_hazardous:{BPlo:120, BPhi:150, Ilo:401, Ihi:500}
    },
    no2:{
        good : {BPlo:0, BPhi:100, Ilo:0, Ihi:50},
        moderate : {BPlo:100, BPhi:200, Ilo:51, Ihi:100},
        unhealthy_sensitive : {BPlo:200, BPhi:700, Ilo:101, Ihi:150},
        unhealthy : {BPlo:700, BPhi:1200, Ilo:151, Ihi:200},
        very_unhealthy:{BPlo:1200, BPhi:2340, Ilo:201, Ihi:300},
        hazardous:{BPlo:2340, BPhi:3090, Ilo:301, Ihi:400},
        extra_hazardous:{BPlo:3090, BPhi:3840, Ilo:401, Ihi:500}
    },
    so2:{
        good : {BPlo:0, BPhi:150, Ilo:0, Ihi:50},
        moderate : {BPlo:150, BPhi:500, Ilo:51, Ihi:100},
        unhealthy_sensitive : {BPlo:500, BPhi:650, Ilo:101, Ihi:150},
        unhealthy : {BPlo:650, BPhi:800, Ilo:151, Ihi:200},
        very_unhealthy:{BPlo:800, BPhi:1600, Ilo:201, Ihi:300},
        hazardous:{BPlo:1600, BPhi:2100, Ilo:301, Ihi:400},
        extra_hazardous:{BPlo:2100, BPhi:2620, Ilo:401, Ihi:500}
    }
};
*/

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
        return {min: pollutants[code][grade-1], max: pollutants[code][grade]};
    }

    static ppm2ppb(value) {
        return value*1000;
    }
    static ppb2ppm(value){
        return parseFloat((value / 1000).toFixed(3));
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
                v = this.ppm2um(code, v) / 1000;
                if (isNaN(v) || v < 0) {
                    v = 0;
                }
            }
        }

        if (unit == undefined) {
            log.error(airUnit, code, v);
            return -1;
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
                value = this.ppm2um(code, value) / 1000;
                if (isNaN(value) || value < 0) {
                    value = 0;
                }
                log.debug('value: '+value+'ug/m3');
            }
        }

        return Math.round((aqiUnit[grade]-aqiUnit[grade-1])/(unit[grade] - unit[grade-1])*(value - unit[grade-1]) + aqiUnit[grade-1]);
    }

    /**
     *  This function is for extracting value from aqicn's data
     * @param type
     * @param Cp
     * @returns {*}
     */
    static  extractValue(type, Cp){
        var unit = {};
        var value = parseFloat(Cp);

        if(airnowUnit[type] === undefined){
            log.warn('extractValueFromAqicn : There is no unit value from aqicn : ', type);
            return -1;
        }

        if(value <= parseFloat(airnowUnit[type].good.Ihi)){
            unit = airnowUnit[type].good;
        }else if(value <= parseFloat(airnowUnit[type].moderate.Ihi)){
            unit = airnowUnit[type].moderate;
        }else if(value <= parseFloat(airnowUnit[type].unhealthy_sensitive.Ihi)){
            unit = airnowUnit[type].unhealthy_sensitive;
        }else if(value <= parseFloat(airnowUnit[type].unhealthy.Ihi)){
            unit = airnowUnit[type].unhealthy;
        }else if(value <= parseFloat(airnowUnit[type].very_unhealthy.Ihi)){
            unit = airnowUnit[type].very_unhealthy;
        }else if(value <= parseFloat(airnowUnit[type].hazardous.Ihi)){
            unit = airnowUnit[type].hazardous;
        }else{
            unit = airnowUnit[type].extra_hazardous;
        }


        var result = (value - unit.Ilo) * (unit.Chi - unit.Clo) / (unit.Ihi - unit.Ilo) + unit.Clo;
        if(type === 'pm10' || type === 'pm25'){
            result = Math.round(result);
        }else{
            result = parseFloat(result.toFixed(3));
        }
        log.info('Extra type: ', type, 'Value :', result, ' index : ', Cp);
        return result;
    }

    /**
     *
     * @param airUnit
     * @param code
     * @param index
     */
    static index2Grade(airUnit, index){
        if(index === undefined) {
            log.warn('_getAqiGrade : invalid parameter');
            return -1;
        }

        var aqi = parseInt(index);
        var aqiUnit = air_pollutants_breakpoints[[airUnit]].aqi;
        if (aqiUnit === undefined) {
            log.error(airUnit, code, v);
            return -1;
        }

        if (aqi < aqiUnit[0]) {
            return -1;
        }
        else if (aqi <= aqiUnit[1]) {
            return 1;
        }
        else if (aqi <= aqiUnit[2]) {
            return 2;
        }
        else if (aqi <= aqiUnit[3]) {
            return 3;
        }
        else if (aqi > aqiUnit[3]) {
            if (aqiUnit.length > 4) {
                if (aqi <= aqiUnit[4]) {
                    return 4;
                }
                else if(aqi <= aqiUnit[5]) {
                    return 5;
                }
                else if(aqi > aqiUnit[5]) {
                    return 6;
                }
            }

            return 4;
        }
        return -1;
    }
}

module.exports = AqiConverter;
