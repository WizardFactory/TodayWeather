/**
 *
 * Created by aleckim on 2017. 12. 08..
 */

'use strict';

var UnitConverter = require('../../lib/unitConverter');
var ControllerTown = require('../controllerTown');
var kmaTimeLib = require('../../lib/kmaTimeLib');

function ControllerWWUnits() {
    var self = this;

    this.checkQueryValidation =  function (req, res, next) {
        /**
         *
         * temperatureUnit(C,F), windSpeedUnit(mph,km/h,m/s,bft,kr), pressureUnit(mmHg,inHg,hPa,mb),
         * distanceUnit(km,mi), precipitationUnit(mm,in), airUnit(airkorea,airkorea_who,airnow,aircn)
         */
        if(!req.hasOwnProperty('query')) {
            req.query = {};
        }

        UnitConverter.getUnitList().forEach(function (value) {
            if (!req.query.hasOwnProperty(value)) {
                req.query[value] = UnitConverter.getDefaultValue(value);
            }
        });

        log.info({sId:req.sessionID, reqQuery: req.query});

        next();
    };

    this.convertUnits = function (req, res, next) {
        try {
            var current = req.result.thisTime[1];
            var currentDate = current.date;
            req.result.thisTime.forEach(function (value) {
                value['time'] = kmaTimeLib.convertDateToHHZZ(value.date);
                value['weather'] = value.desc;
                self._convertThisTimeWeather(value, req.query);
            });

            req.result.daily.forEach(function (value, index) {
                if (value.date.substr(0,10) === currentDate.substr(0,10)) {
                    current.todayIndex = index;
                }
                value.fromToday = kmaTimeLib.getDiffDays(value.date, currentDate);
                value.dayOfWeek = (new Date(value.date)).getDay();
                self._convertDailyWeather(value, req.query, currentDate);
            });

            var hourly = req.result.hourly;
            hourly.forEach(function (value, index) {
                value.fromToday = kmaTimeLib.getDiffDays(value.date, currentDate);
                if (value.date <= currentDate) {
                    if (index == hourly.length -1) {
                        value.currentIndex = true;
                    }
                    else if (currentDate <= hourly[index+1].date) {
                        value.currentIndex = true;
                    }
                }
                self._convertHourlyWeather(value, req.query, currentDate);
            });
        }
        catch (err) {
            log.error(err);
        }
        next();
    };

    this.makeSummary = function (req, res, next) {
        var ctrlTown = new ControllerTown();

        try {
            var current = req.result.thisTime[1];
            current.summary = ctrlTown.makeSummary(current, req.result.thisTime[0], req.query, res);
        }
        catch(err) {
            log.error(err);
        }
        //weatherSummary
        //airSummary
        next();
    };
}

ControllerWWUnits.prototype._convertWindDirToWdd = function (windDir) {
    switch(windDir) {
        case 0: return "N";
        case 22.5: return "NEN";
        case 45: return "NE";
        case 67.5: return "ENE";
        case 90: return "E";
        case 112.5: return "ESE";
        case 135: return "ES";
        case 157.5: return "SES";
        case 180: return "S";
        case 202.5: return "SWS";
        case 225: return "SW";
        case 247.5: return "WSW";
        case 270: return "W";
        case 292.5: return "WNW";
        case 315: return "WN";
        case 337.5: return "NWN";
        case 360: return "N";
    }
};

ControllerWWUnits.prototype._decideHumidityIcon = function(reh) {
    var tempIconName = "Humidity-";

    if (reh === 100) {
        tempIconName += "90";
    }
    else {
        tempIconName += parseInt(reh / 10) * 10;
    }
    return tempIconName;
};

ControllerWWUnits.prototype._convertThisTimeWeather = function (wData, query) {
    var unitConverter = new UnitConverter();

    var toTempUnit = query.temperatureUnit;
    var toPrecipUnit = query.precipitationUnit;
    var toWindUnit = query.windSpeedUnit;
    var toPressUnit = query.pressureUnit;
    var toDistUnit = query.distanceUnit;

    wData['pty'] = wData.precType || 0;

    if (toTempUnit === 'C') {
        wData['t1h'] = wData.temp_c;
        wData['sensorytem'] = wData.ftemp_c;
    }
    else if (toTempUnit === 'F') {
        wData['t1h'] = wData.temp_f;
        wData['sensorytem'] = wData.ftemp_f;
    }
    if (!wData.hasOwnProperty('humid')) {
        log.error('Invalid humid '+JSON.stringify(wData));
    }
    wData['reh'] = wData.humid || 0;
    wData['humidityIcon'] = this._decideHumidityIcon(wData.reh);

    if (wData.hasOwnProperty('precip')) {
        wData['rn1'] = unitConverter.convertUnits(UnitConverter.getDefaultValue('precipitationUnit'), toPrecipUnit, wData.precip);
    }
    wData['wsd'] = unitConverter.convertUnits(UnitConverter.getDefaultValue('windSpeedUnit'), toWindUnit, wData.windSpd_ms);
    wData['hPa'] = unitConverter.convertUnits(UnitConverter.getDefaultValue('pressureUnit'), toPressUnit, wData.press);
    wData['visibility'] = unitConverter.convertUnits(UnitConverter.getDefaultValue('distanceUnit'), toDistUnit, wData.vis);
    wData['stnDateTime'] = wData.date;
    wData['wdd'] = this._convertWindDirToWdd(wData.windDir);
    wData['dateObj'] = wData.date;
    wData['date'] = kmaTimeLib.convertDateToYYYYMMDD(wData.date);
};

ControllerWWUnits.prototype._convertDailyWeather = function (wData, query, currentDate) {
    var unitConverter = new UnitConverter();

    var toTempUnit = query.temperatureUnit;
    var toPrecipUnit = query.precipitationUnit;
    var toWindUnit = query.windSpeedUnit;
    var toPressUnit = query.pressureUnit;
    var toDistUnit = query.distanceUnit;

    if (toTempUnit === 'C') {
        wData['tmx'] = wData.tempMax_c;
        wData['tmn'] = wData.tempMin_c;
    }
    else if (toTempUnit === 'F') {
        wData['tmx'] = wData.tempMax_f;
        wData['tmn'] = wData.tempMin_f;
    }

    wData['pty'] = wData.precType || 0;
    wData['pop'] = wData.precProb || 0;
    wData['skyAm'] = wData['skyPm'] = wData.skyIcon;

    if (!wData.hasOwnProperty('humid')) {
        log.error('Invalid humdid '+JSON.stringify(wData));
    }
    wData['reh'] = wData.humid || 0;
    wData['humidityIcon'] = this._decideHumidityIcon(wData.reh);

    if (wData.hasOwnProperty('precip')) {
        if (wData.date <= currentDate) {
            wData['rn1'] = unitConverter.convertUnits(UnitConverter.getDefaultValue('precipitationUnit'), toPrecipUnit, wData.precip);
            wData.rn1 = parseFloat(wData.rn1.toFixed(1));
        }
        else {
            if (wData.precType === 1) {
                wData['r06'] = unitConverter.convertUnits(UnitConverter.getDefaultValue('precipitationUnit'), toPrecipUnit, wData.precip);
                wData.r06 = parseFloat(wData.r06.toFixed(1));
            }
            else if (wData.precType === 2) {
                wData['r06'] = unitConverter.convertUnits(UnitConverter.getDefaultValue('precipitationUnit'), toPrecipUnit, wData.precip);
                wData.r06 = parseFloat(wData.r06.toFixed(1));
                wData['s06'] = unitConverter.convertUnits(UnitConverter.getDefaultValue('precipitationUnit'), toPrecipUnit, wData.precip);
                wData.s06 = parseFloat(wData.s06.toFixed(1));
            }
            else if (wData.precType === 3) {
                wData['s06'] = unitConverter.convertUnits(UnitConverter.getDefaultValue('precipitationUnit'), toPrecipUnit, wData.precip);
                wData.s06 = parseFloat(wData.s06.toFixed(1));
            }
        }
    }

    wData['wsd'] = unitConverter.convertUnits(UnitConverter.getDefaultValue('windSpeedUnit'), toWindUnit, wData.windSpd_ms);
    wData['hPa'] = unitConverter.convertUnits(UnitConverter.getDefaultValue('pressureUnit'), toPressUnit, wData.press);
    wData['visibility'] = unitConverter.convertUnits(UnitConverter.getDefaultValue('distanceUnit'), toDistUnit, wData.vis);
    wData['wdd'] = this._convertWindDirToWdd(wData.windDir);
    wData['dateObj'] = wData.date;
    wData['date'] = kmaTimeLib.convertDateToYYYYMMDD(wData.date);
};

ControllerWWUnits.prototype._convertHourlyWeather = function (wData, query, currentDate) {
    var unitConverter = new UnitConverter();

    var toTempUnit = query.temperatureUnit;
    var toPrecipUnit = query.precipitationUnit;
    var toWindUnit = query.windSpeedUnit;
    var toPressUnit = query.pressureUnit;
    var toDistUnit = query.distanceUnit;

    if (toTempUnit === 'C') {
        wData['t3h'] = wData.temp_c;
        wData['sensorytem'] = wData.ftemp_c;
    }
    else if (toTempUnit === 'F') {
        wData['t3h'] = wData.temp_f;
        wData['sensorytem'] = wData.ftemp_f;
    }

    wData['pty'] = wData.precType || 0;
    wData['pop'] = wData.precProb || 0;
    wData['wsd'] = unitConverter.convertUnits(UnitConverter.getDefaultValue('windSpeedUnit'), toWindUnit, wData.windSpd_ms);
    if (!wData.hasOwnProperty('humid')) {
        log.error('Invalid humdid '+JSON.stringify(wData));
    }
    wData['reh'] = wData.humid || 0;
    wData['humidityIcon'] = this._decideHumidityIcon(wData.reh);

    wData['cloud'] = wData['cloud'] || 0;

    if (wData.hasOwnProperty('precip')) {
        if (wData.date <= currentDate ) {
            wData['rn1'] = unitConverter.convertUnits(UnitConverter.getDefaultValue('precipitationUnit'), toPrecipUnit, wData.precip);
            wData.rn1 = parseFloat(wData.rn1.toFixed(1));
        }
        else {
            if (wData.precType === 1) {
                wData['r06'] = unitConverter.convertUnits(UnitConverter.getDefaultValue('precipitationUnit'), toPrecipUnit, wData.precip);
                wData.r06 = parseFloat(wData.r06.toFixed(1));
            }
            else if (wData.precType === 2) {
                wData['r06'] = unitConverter.convertUnits(UnitConverter.getDefaultValue('precipitationUnit'), toPrecipUnit, wData.precip);
                wData.r06 = parseFloat(wData.r06.toFixed(1));
                wData['s06'] = unitConverter.convertUnits(UnitConverter.getDefaultValue('precipitationUnit'), toPrecipUnit, wData.precip);
                wData.s06 = parseFloat(wData.s06.toFixed(1));
            }
            else if (wData.precType === 3) {
                wData['s06'] = unitConverter.convertUnits(UnitConverter.getDefaultValue('precipitationUnit'), toPrecipUnit, wData.precip);
                wData.s06 = parseFloat(wData.s06.toFixed(1));
            }
        }
    }

    wData['hPa'] = unitConverter.convertUnits(UnitConverter.getDefaultValue('pressureUnit'), toPressUnit, wData.press);
    wData['visibility'] = unitConverter.convertUnits(UnitConverter.getDefaultValue('distanceUnit'), toDistUnit, wData.vis);
    wData['dateObj'] = wData.date;
    wData['time'] = kmaTimeLib.convertDateToHHZZ(wData.date);
    wData['date'] = kmaTimeLib.convertDateToYYYYMMDD(wData.date);
};

module.exports = ControllerWWUnits;
