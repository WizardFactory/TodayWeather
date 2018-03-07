angular.module('controller.air', [])
    .controller('AirCtrl', function ($scope, $stateParams, $sce, WeatherInfo, WeatherUtil, Units, Util,
                                     $ionicScrollDelegate, $ionicHistory) {

        var TABLET_WIDTH = 640;
        var cityData;
        var aqiCode;

        $scope.getLabelPosition = function (grade, val) {
            var w;
            var count;
            var gradeW;
            var startV;
            var endV;
            var diff;
            var gradeD;
            var x;
            var LABEL_WIDTH = 52;

            try {
                w = angular.element(document.getElementById("aqistd")).prop('offsetWidth');
                count = $scope.aqiStandard.length;
                gradeW = w/count;
                if (grade >= 2) {
                    startV = $scope.aqiStandard[grade-2].value[aqiCode];
                }
                else {
                    startV = 0;
                }
                endV = $scope.aqiStandard[grade-1].value[aqiCode];

                diff = (val - startV)/(endV-startV);
                gradeD = diff*gradeW;
                x = gradeW*(grade-1) + gradeD;
                x -= (LABEL_WIDTH/2);
                if (x<0) {
                    x = 0;
                }
                if (x > w-LABEL_WIDTH) {
                    x = w-LABEL_WIDTH;
                }
            }
            catch (err) {
                Util.ga.trackException(err, false);
                x=0;
            }
            return x;
        };

        $scope.getAirCodeUnit = function (code) {
            switch (code) {
                case 'pm25':
                    return '㎍/㎥';
                case 'pm10':
                    return '㎍/㎥';
                case 'o3':
                    return 'ppm';
                case 'no2':
                    return 'ppm';
                case 'co':
                    return 'ppm';
                case 'so2':
                    return 'ppm';
                case 'aqi':
                    return '';
            }
            return "";
        };

        function _getDustForecast(dayWeatherList) {
            var objList;

            try {
                objList = dayWeatherList.filter(function (obj) {
                    return obj.fromToday >= 0 && obj.hasOwnProperty('dustForecast');
                });

                //change new object
                objList = JSON.parse(JSON.stringify(objList));

                //pm2.5, pm10, o3
                objList.forEach(function (obj) {
                    for (var key in obj.dustForecast) {
                        if (key.indexOf(aqiCode) >= 0) {
                            if (key.indexOf('Grade') >= 0) {
                                console.log('copy '+key+ ' to grade');
                                obj.grade  = obj.dustForecast[key]
                            }
                            else if (key.indexOf('Str') >= 0) {
                                console.log('copy '+key+ ' to str');
                                obj.str  = obj.dustForecast[key]
                            }
                        }
                    }
                });

                objList = objList.filter(function (obj) {
                    return obj.hasOwnProperty('grade');
                });
            }
            catch(err) {
                Util.ga.trackException(err, false);
            }
            return objList;
        }

        function _getHourlyForecast(current, hourlyList) {
            var list;
            try {
                list = hourlyList.filter(function (obj) {
                    return obj.date > current;
                });
                list = list.map(function (obj) {
                    obj.time = parseInt(obj.date.substr(11,2));
                    return obj;
                });
            }
            catch (err) {
                Util.ga.trackException(err, false);
            }
            return list;
        }

        function _getAQIname(propertyName) {
            switch (propertyName) {
                case 'pm25':
                    return 'LOC_PM25';
                case 'pm10':
                    return 'LOC_PM10';
                case 'o3':
                    return 'LOC_O3';
                case 'no2':
                    return 'LOC_NO2';
                case 'co':
                    return 'LOC_CO';
                case 'so2':
                    return 'LOC_SO2';
                case 'aqi':
                    return 'LOC_AQI';
            }
            return "";
        }

        function _getAQIList(airInfo, pollutants) {
            var list = [];
            try {
                ['pm25', 'pm10', 'o3', 'no2', 'co', 'so2', 'aqi'].forEach(function (propertyName) {
                    var obj = {};
                    if (airInfo.hasOwnProperty(propertyName+'Value')) {
                        obj.name = _getAQIname(propertyName);
                        obj.value = airInfo[propertyName+'Value'];
                        obj.grade = airInfo[propertyName+'Grade'];
                        obj.str = airInfo[propertyName+'Str'];
                        obj.code = propertyName;
                        list.push(obj);
                    }
                    else if (pollutants && pollutants.hasOwnProperty(propertyName)) {
                        obj.name = _getAQIname(propertyName);
                        obj.code = propertyName;
                        obj.value = '-';
                        list.push(obj);
                    }
                });
            }
            catch (err) {
                Util.ga.trackException(err, false);
            }
            return list;
        }

        function _setMainAqiCode(code) {
            Util.ga.trackEvent('air', 'setMainAqiCode', code);
            $scope.aqiCode = aqiCode = code;
            $scope.airCodeName = _getAQIname(aqiCode);
        }

        function _applyWeatherData(data) {
            cityData = data;
            try {
                Util.ga.trackEvent('air', 'applyWeatherData');
                var latestAirInfo =  cityData.airInfo.last || cityData.currentWeather.arpltn;
                if (latestAirInfo[aqiCode+'Value'] == undefined && cityData.airInfo.pollutants[aqiCode] == undefined) {
                    //skip current aqicode
                    var newAqiCode = ['pm25', 'pm10', 'o3', 'no2', 'co', 'so2', 'aqi'].find(function (propertyName) {
                        return (latestAirInfo[propertyName+'Value'] != undefined ||
                            cityData.airInfo.pollutants[aqiCode] != undefined);
                    });
                    _setMainAqiCode(newAqiCode);
                }

                $scope.currentPosition = cityData.currentPosition;
                $scope.airInfo = latestAirInfo;
                $scope.airCodeValue = latestAirInfo[aqiCode+'Value'] || '-';
                $scope.airCodeGrade = latestAirInfo[aqiCode+'Grade'];
                $scope.airCodeStr = latestAirInfo[aqiCode+'Str'];
                $scope.airCodeActionGuide = latestAirInfo[aqiCode+'ActionGuide'];

                console.log($scope.aqiList);
                $scope.cityCount = WeatherInfo.getEnabledCityCount();

                console.log($scope.dayForecast);

                $scope.address = cityData.name || WeatherUtil.getShortenAddress(cityData.address);
                console.log($scope.address);

                if (cityData.hasOwnProperty('airInfo')) {
                    var airInfo = cityData.airInfo;
                    $scope.forecastPubdate = airInfo.forecastPubDate;
                    $scope.forecastSource = airInfo.forecastSource;
                    $scope.aqiList = _getAQIList($scope.airInfo, cityData.airInfo.pollutants);

                    if (airInfo.hasOwnProperty('pollutants')) {
                        var pollutant = airInfo.pollutants[aqiCode];

                        if (pollutant) {
                            $scope.hourlyForecast = pollutant.hourly.filter(function (obj) {
                                return obj.date >= latestAirInfo.dataTime;
                            });
                            console.info({code:pollutant.code, pubDate:$scope.forecastPubdate});
                            //console.log(JSON.stringify($scope.hourlyForecast));

                            $scope.dayForecast = pollutant.daily;
                        }
                    }
                }
                else {
                    $scope.aqiList = _getAQIList($scope.airInfo);
                }
            }
            catch(err) {
                Util.ga.trackException(err, false);
            }
        }

        function init() {
            $ionicHistory.clearHistory();

            var fav = parseInt($stateParams.fav);
            if (!isNaN(fav)) {
                if (fav === 0) {
                    var city = WeatherInfo.getCityOfIndex(0);
                    if (city !== null && !city.disable) {
                        WeatherInfo.setCityIndex(fav);
                    }
                } else {
                    WeatherInfo.setCityIndex(fav);
                }
            }

            var code = $stateParams.code;
            if (code) {
                _setMainAqiCode(code);
            }
            else {
                _setMainAqiCode('aqi');
            }

            if (WeatherInfo.getEnabledCityCount() === 0) {
                Util.ga.trackEvent('city', 'error', 'No enabled cities');
                return;
            }

            var bodyWidth;

            if (window.screen.height) {
                bodyWidth = window.screen.width;
            }
            else if (window.innerHeight) {
                //crosswalk에서 늦게 올라옴.
                bodyWidth = window.innerWidth;
            }
            else if (window.outerHeight) {
                //ios에서는 outer가 없음.
                bodyWidth = window.outerWidth;
            }
            else {
                console.log("Fail to get window width, height");
                bodyWidth = 360;
            }

            if (bodyWidth > TABLET_WIDTH) {
                bodyWidth = TABLET_WIDTH;
            }

            $scope.headerHeight = bodyWidth*(3/4) - (44+41); //HEADER + BOTTOM/2

            var data = WeatherInfo.getCityOfIndex(WeatherInfo.getCityIndex());
            _applyWeatherData(data);
        }

        $scope.setMainAqiCode = function(code) {
            Util.ga.trackEvent('air', 'action', 'setMainAqiCodeByUser');
            _setMainAqiCode(code);
            var data = WeatherInfo.getCityOfIndex(WeatherInfo.getCityIndex());
            _applyWeatherData(data);
            $ionicScrollDelegate.scrollTop();
        };

        $scope.$on('applyEvent', function(event, sender) {
            Util.ga.trackEvent('event', 'apply', sender);
            var data = WeatherInfo.getCityOfIndex(WeatherInfo.getCityIndex());
            _applyWeatherData(data);
        });

        init();
    });
