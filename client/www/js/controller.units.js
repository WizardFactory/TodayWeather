/**
 * Created by aleckim on 2016. 12. 19..
 */

angular.module('controller.units', [])
    .factory('Units', function(TwStorage, Util) {
        var obj = {};
        obj.temperatureUnit;
        obj.windSpeedUnit;
        obj.pressureUnit;
        obj.distanceUnit;
        obj.precipitationUnit;

        function _getDefaultUnits() {
            var units = {};
            units.temperatureUnit = "C";
            units.windSpeedUnit = "m/s";
            units.pressureUnit = "hPa";
            units.distanceUnit = "km";
            units.precipitationUnit = "mm";
            units.airUnit = "airkorea";

            console.log({region: Util.region});

            if (Util.region == 'KR') {
                //skip
            }
            else if (Util.region == 'JP') {
                units.temperatureUnit = "C";
                units.windSpeedUnit = "m/s";
                units.pressureUnit = "mmHg";
                units.distanceUnit = "km";
                units.precipitationUnit = "mm";
                units.airUnit = "airnow";
            }
            else if (Util.region == 'US') {
                units.temperatureUnit = "F";
                units.windSpeedUnit = "mph";
                units.pressureUnit = "inHg";
                units.distanceUnit = "mi";
                units.precipitationUnit = "in";
                units.airUnit = "airnow";
            }
            else if (Util.region == 'DE') {
                units.temperatureUnit = "C";
                units.windSpeedUnit = "km/h";
                units.pressureUnit = "mb";
                units.distanceUnit = "km";
                units.precipitationUnit = "mm";
                units.airUnit = "airnow";
            }
            else if (Util.region == 'CN') {
                units.temperatureUnit = "C";
                units.windSpeedUnit = "km/h";
                units.pressureUnit = "hPa";
                units.distanceUnit = "km";
                units.precipitationUnit = "mm";
                units.airUnit = "airnow";
            }
            else if (Util.region == 'TW') {
                units.temperatureUnit = "C";
                units.windSpeedUnit = "km/h";
                units.pressureUnit = "mmHg";
                units.distanceUnit = "km";
                units.precipitationUnit = "mm";
                units.airUnit = "airnow";
            }
            else {
                //set default
                units.airUnit = "airnow";
            }
            return units;
        }

        obj.getAllUnits = function () {
            var self = this;
            return {
                "temperatureUnit": self.temperatureUnit,
                "windSpeedUnit": self.windSpeedUnit,
                "pressureUnit": self.pressureUnit,
                "distanceUnit": self.distanceUnit,
                "precipitationUnit": self.precipitationUnit,
                "airUnit": self.airUnit
            };
        };

        obj.loadUnits = function () {
            console.log('load units');
            var self = this;
            var savedUnits = TwStorage.get("units");
            var defaultUnits = _getDefaultUnits();
            var isUpdated = false;

            console.log('saved units:',savedUnits);
            [
                "temperatureUnit",
                "windSpeedUnit",
                "pressureUnit",
                "distanceUnit",
                "precipitationUnit",
                "airUnit"
            ].forEach(function (value) {
                if (savedUnits && savedUnits.hasOwnProperty(value)) {
                    self[value] = savedUnits[value]
                }
                else {
                    self[value] = defaultUnits[value];
                    isUpdated = true;
                }
            });

            if (isUpdated) {
                self.saveUnits();
            }
            console.log(self.toString());
        };

        //saveUnits
        obj.saveUnits = function () {
            var self = this;

            TwStorage.set("units", self);
        };

        obj.setUnit = function (unit, value) {
            var self = this;
            console.log('set unit='+unit+' val='+value);
            if (self[unit] != value) {
                self[unit] = value;
                return true;
            }
            return false
        };

        obj.getUnit = function (unit) {
            var self = this;
            //console.log('get unit='+unit+' val='+self[unit]);
            return self[unit];
        };

        obj.getAirUnitStr = function (unit) {
            var airUnitStr = {"airkorea": "LOC_AIR_QUALITY_INDEX_KR",
                "airkorea_who": "LOC_AIR_QUALITY_INDEX_KR_WHO",
                "airnow": "LOC_AIR_QUALITY_INDEX_US",
                "aircn": "LOC_AIR_QUALITY_INDEX_CN"};
            return airUnitStr[unit];
        };

        return obj;
    })
    .controller('UnitsCtrl', function($scope, $translate, $ionicHistory, Units, Util, WeatherInfo, Push) {
        $scope.temperatureUnit = Units.temperatureUnit;
        $scope.windSpeedUnit = Units.windSpeedUnit;
        $scope.pressureUnit = Units.pressureUnit;
        $scope.distanceUnit = Units.distanceUnit;
        $scope.precipitationUnit = Units.precipitationUnit;
        $scope.airUnit = Units.airUnit;
        var update = false;

        $scope.onClose = function() {
            if(update) {
               Push.updateUnits();
            }
            //iOS에서 forecast chart 제대로 안나오는 이슈가 있어서 임시로 무조건 리드로잉한다.
            _resetUpdateTimeCities();
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
                update = true;
                //_resetUpdateTimeCities();
            }
        };

        $scope.getAirUnitStr = function (unit) {
           return Units.getAirUnitStr(unit);
        }
    });


