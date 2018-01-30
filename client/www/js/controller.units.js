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
                "aqicn": "LOC_AIR_QUALITY_INDEX_CN"};
            return airUnitStr[unit];
        };

        obj.getSelectList = function (name) {
            switch (name) {
                case 'temperatureUnit':
                    return [{label: 'C', value:'C'},
                        {label: 'F', value: 'F'}];
                case 'windSpeedUnit':
                    return [{label: 'mph', value: 'mph'},
                        {label: 'km/h', value: 'km/h'},
                        {label: 'm/s', value: 'm/s'},
                        {label: 'beaufort', value: 'bft'},
                        {label: 'knotes', value: 'kt'}];
                case  'pressureUnit':
                    return [{label: 'mmHg', value: 'mmHg'},
                        {label: 'inHg', value: 'inHg'},
                        {label: 'mbar', value: 'mb'},
                        {label: 'hPa', value: 'hPa'}];
                case 'distanceUnit':
                    return [{label: 'km', value: 'km'},
                        {label: 'miles', value: 'mi'}];
                case 'precipitationUnit':
                    return [{label: 'mm', value: 'mm'},
                        {label: 'inch', value: 'in'}];
                case 'airUnit':
                    return [{label: this.getAirUnitStr('airnow'), value: 'airnow'},
                        {label: this.getAirUnitStr('aqicn'), value: 'aqicn'},
                        {label: this.getAirUnitStr('airkorea'), value: 'airkorea'},
                        {label: this.getAirUnitStr('airkorea_who'), value: 'airkorea_who'}];
                default:
                    return [];
            }
        };

        return obj;
    })
    .controller('UnitsCtrl', function($scope, $translate, $ionicHistory, Units, Util, Push, $location, radioList) {

        $scope.$on('$ionicView.enter', function() {
            var units = [];
            var data = Units.getAllUnits();
            for (var name in data) {
                units.push({name: name, value: data[name]});
            }
            $scope.units = units;
        });

        $scope.onClose = function() {
            Util.ga.trackEvent('action', 'click', 'units back');
            $ionicHistory.goBack();
        };

        $scope.getUnitNameStr = function (name) {
            switch (name) {
                case 'temperatureUnit':
                    return 'LOC_TEMPERATURE_UNIT';
                case 'windSpeedUnit':
                    return 'LOC_WIND_SPEED_UNIT';
                case  'pressureUnit':
                    return 'LOC_PRESSURE_UNIT';
                case 'distanceUnit':
                    return 'LOC_DISTANCE_UNIT';
                case 'precipitationUnit':
                    return 'LOC_PRECIPITATION';
                case 'airUnit':
                    return 'LOC_AIR_QUALITY_INDEX_UNIT';
                default:
                    return '';
            }
        };

        $scope.getUnitValueStr = function (unit) {
            if (unit.name === 'airUnit') {
                return Units.getAirUnitStr(unit.value);
            }
            else {
                switch (unit.value) {
                    case 'kt':
                        return 'knotes';
                    case 'bft':
                        return 'beaufort';
                    case 'mb':
                        return 'mbar';
                    case 'mi':
                        return 'miles';
                    case 'in':
                        return 'inches';
                    default:
                        return unit.value;
                }
            }
        };

        $scope.settingRadio = function (unit) {
            radioList.type = unit.name;
            radioList.title = $scope.getUnitNameStr(unit.name);
            radioList.setValue(unit.value);
            radioList.importData(Units.getSelectList(unit.name));
            $location.path('/setting-radio');
        };
    });


