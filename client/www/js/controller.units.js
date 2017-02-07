/**
 * Created by aleckim on 2016. 12. 19..
 */

angular.module('controller.units', [])
    .factory('Units', function(Util) {
        var obj = {};
        obj.temperatureUnit;
        obj.windSpeedUnit;
        obj.pressureUnit;
        obj.distanceUnit;
        obj.precipitationUnit;

        function _getDefaultUnits() {
            var obj = {};
            obj.temperatureUnit = "C";
            obj.windSpeedUnit = "m/s";
            obj.pressureUnit = "hPa";
            obj.distanceUnit = "km";
            obj.precipitationUnit = "mm";
            return obj;
        }

        function _initUnits() {
            obj = _getDefaultUnits();

            if (Util.region == 'KR') {
                //skip
            }
            else if (Util.region == 'JP') {
                obj.temperatureUnit = "C";
                obj.windSpeedUnit = "m/s";
                obj.pressureUnit = "mmHg";
                obj.distanceUnit = "km";
                obj.precipitationUnit = "mm";
            }
            else if (Util.region == 'US') {
                obj.temperatureUnit = "F";
                obj.windSpeedUnit = "mph";
                obj.pressureUnit = "inHg";
                obj.distanceUnit = "mi";
                obj.precipitationUnit = "in";
            }
            else if (Util.region == 'DE') {
                obj.temperatureUnit = "C";
                obj.windSpeedUnit = "km/h";
                obj.pressureUnit = "mb";
                obj.distanceUnit = "km";
                obj.precipitationUnit = "mm";
            }
            else if (Util.region == 'CN') {
                obj.temperatureUnit = "C";
                obj.windSpeedUnit = "km/h";
                obj.pressureUnit = "hPa";
                obj.distanceUnit = "km";
                obj.precipitationUnit = "mm";
            }
            else if (Util.region == 'TW') {
                obj.temperatureUnit = "C";
                obj.windSpeedUnit = "km/h";
                obj.pressureUnit = "mmHg";
                obj.distanceUnit = "km";
                obj.precipitationUnit = "mm";
            }
            else {
               //set default
            }
        }

        obj.getDefaultUnits = function () {
            return _getDefaultUnits();
        };

        obj.getAllUnits = function () {
            return {
                "temperatureUnit": obj.temperatureUnit,
                "windSpeedUnit": obj.windSpeedUnit,
                "pressureUnit": obj.pressureUnit,
                "distanceUnit": obj.distanceUnit,
                "precipitationUnit": obj.precipitationUnit
            };
        };

        obj.loadUnits = function () {
            var units;
            var key;
            if (window.plugins == undefined || plugins.appPreferences == undefined) {
                console.log('appPreferences is undefined, so load local st');
                units = JSON.parse(localStorage.getItem("units"));
                if (units == undefined) {
                    _initUnits();
                    obj.saveUnits();
                }
                else {
                    for (key in units) {
                        obj[key] = units[key];
                    }
                }
                return;
            }

            var suitePrefs = plugins.appPreferences.suite(Util.suiteName);
            suitePrefs.fetch(function (value) {
                console.log("fetch preference Success: " + value);
                //callback(undefined, value);
                units = JSON.parse(value);
                if (units == undefined) {
                    _initUnits();
                    obj.saveUnits();
                }
                else {
                    for (key in units) {
                        obj[key] = units[key];
                    }
                }
            }, function (error) {
                console.log("fetch preference Error: " + error);
                _initUnits();
                obj.saveUnits();
            }, 'units');
        };

        //saveUnits
        obj.saveUnits = function () {
            if (window.plugins == undefined || plugins.appPreferences == undefined) {
                console.log('appPreferences is undefined, so save local st');
                localStorage.setItem("units", JSON.stringify(obj));
                return;
            }
            var suitePrefs = plugins.appPreferences.suite(Util.suiteName);
            suitePrefs.store(function (value) {
                console.log("save preference Success: " + value);
            }, function (error) {
                console.log("save preference Error: " + error);
            }, 'units', JSON.stringify(obj));
        };

        obj.setUnit = function (unit, value) {
            console.log('set unit='+unit+' val='+value);
            if (obj[unit] != value) {
                obj[unit] = value;
                return true;
            }
            return false
        };

        obj.getUnit = function (unit) {
            //console.log('get unit='+unit+' val='+obj[unit]);
            return obj[unit];
        };

        //setUnits
        function _convertTemperature(from, to, val)  {
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
            console.log('Fail to convert from '+from+" to "+to+" value="+val);
            return val;
        }

        function _getBeaufort(ms) {
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
        }

        function _convertBeaufortToMs(val) {
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
        }

        function _convertWindSpeed(from, to, val) {
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
                            return _getBeaufort(parseFloat((val * 0.44704).toFixed(1)));
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
                            return _getBeaufort(parseFloat((val * 0.277778).toFixed(1)));
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
                            return _getBeaufort(val);
                            break;
                        case 'kt':
                            return parseFloat((val * 1.943844).toFixed(1));
                            break;
                    }
                    break;
                case 'bft':
                    var ms = _convertBeaufortToMs(val);
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
                            return _getBeaufort(parseFloat((val * 0.514444).toFixed(1)));
                            break;
                    }
                    break;
            }
        }

        function _convertPressure(from, to, val) {
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
        }

        function _convertDistance(from, to, val) {
            if (from == 'km') {
                return parseFloat((val*0.621371).toFixed(1));
            }
            else if (from =='mi') {
                return parseFloat((val*1.609344).toFixed(1));
            }
        }

        function _convertPrecipitation(from, to, val) {
            if (from == 'mm') {
                return parseFloat((val*0.03937).toFixed(2));
            }
            else if (from =='in') {
                return parseFloat((val*25.4).toFixed(1));
            }
        }

        obj.convertUnits = function (from, to, val) {
            if (val == undefined) {
                //console.log("val is undefined!!");
                return val;
            }
            if (from == to) {
                return val;
            }

            if (from == 'C' || from == 'F') {
                return _convertTemperature(from, to, val);
            }
            if (from == 'mph' || from == 'km/h' || from == 'm/s' || from == 'bft' || from == 'kt') {
                return _convertWindSpeed(from, to, val);
            }
            if (from == 'mmHg' || from == 'inHg' || from == 'hPa' || from == 'mb') {
                return _convertPressure(from, to, val);
            }
            if (from == 'km' || from == 'mi') {
                return _convertDistance(from, to, val);
            }
            if (from == 'mm' || from == 'in') {
                return _convertPrecipitation(from, to, val);
            }

            console.log('Fail to convert from '+from+" to "+to+" value="+val);
            return val;
        };

        return obj;
    })
    .controller('UnitsCtrl', function($scope, $translate, $ionicHistory, Units, Util, WeatherInfo) {
        $scope.temperatureUnit = Units.temperatureUnit;
        $scope.windSpeedUnit = Units.windSpeedUnit;
        $scope.pressureUnit = Units.pressureUnit;
        $scope.distanceUnit = Units.distanceUnit;
        $scope.precipitationUnit = Units.precipitationUnit;

        $scope.onClose = function() {
            console.log('close');
            Util.ga.trackEvent('action', 'click', 'units back');
            //convertUnits
            $ionicHistory.goBack();
        };

        function _resetUpdateTimeCities() {
            console.log('reset update time');
            for (var i = 0; i < WeatherInfo.getCityCount(); i += 1) {
                WeatherInfo.reloadCity(i);
            }
        }

        $scope.setUnit = function (unit, value) {
            if (Units.setUnit(unit, value)) {
                Units.saveUnits();
                _resetUpdateTimeCities();
            }
        };
    });


