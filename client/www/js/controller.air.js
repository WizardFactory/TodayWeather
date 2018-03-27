angular.module('controller.air', [])
    .controller('AirCtrl', function ($scope, $stateParams, $sce, WeatherInfo, WeatherUtil, Units, Util,
                                     $ionicScrollDelegate, $ionicHistory, Push) {

        var TABLET_WIDTH = 640;
        var cityData;
        var aqiCode;
        var bodyWidth;

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
            var AQISTD_MARGIN = 2;

            try {
                w = angular.element(document.getElementById("aqistd")).prop('offsetWidth');
                var label_w = angular.element(document.getElementById("aqistd-label")).prop('offsetWidth') || LABEL_WIDTH;
                count = $scope.aqiStandard.length;
                gradeW = w/count+AQISTD_MARGIN;
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
                x -= (label_w/2);
                if (x<0) {
                    x = 0;
                }
                if (x > w-label_w) {
                    x = w-label_w;
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
                ['aqi', 'pm25', 'pm10', 'o3', 'no2', 'co', 'so2'].forEach(function (propertyName) {
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
            if (code === 'aqi') {
                $scope.mainName = 'LOC_AIR_STATUS';
            }
            else {
                $scope.mainName = $scope.airCodeName;
            }
        }

        function _applyWeatherData() {
            try {
                var cityIndex = WeatherInfo.getCityIndex();
                var cityData = WeatherInfo.getCityOfIndex(cityIndex);

                Util.ga.trackEvent('air', 'applyWeatherData');
                var latestAirInfo = cityData.airInfo.last || cityData.currentWeather.arpltn;
                if ((latestAirInfo.hasOwnProperty(aqiCode+'Value') && latestAirInfo[aqiCode+'Value'] == undefined)
                    && (cityData.airInfo.hasOwnProperty('pollutants') && cityData.airInfo.pollutants[aqiCode] == undefined)) {
                    //skip current aqicode
                    var newAqiCode = ['pm25', 'pm10', 'o3', 'no2', 'co', 'so2', 'aqi'].find(function (propertyName) {
                        return (latestAirInfo[propertyName+'Value'] != undefined ||
                            cityData.airInfo.pollutants[aqiCode] != undefined);
                    });
                    _setMainAqiCode(newAqiCode);
                }

                $scope.hasPush = Push.hasPushInfo(cityIndex);
                $scope.currentPosition = cityData.currentPosition;
                $scope.airInfo = latestAirInfo;
                $scope.airCodeGrade = latestAirInfo[aqiCode+'Grade'];
                $scope.airCodeValue = latestAirInfo[aqiCode+'Value'] || '-';
                $scope.airCodeStr = latestAirInfo[aqiCode+'Str'];
                if (aqiCode === 'aqi') {
                    $scope.mainInfo = $scope.airCodeStr || '-';
                    $scope.airCodeStr = '';
                }
                else {
                    $scope.mainInfo = $scope.airCodeValue || '-';
                }

                $scope.airCodeActionGuide = latestAirInfo[aqiCode+'ActionGuide'];

                console.log($scope.aqiList);
                $scope.cityCount = WeatherInfo.getEnabledCityCount();

                $scope.dayForecast = undefined;
                $scope.airChart = undefined;

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
                            var index = pollutant.hourly.findIndex(function (obj) {
                                return obj.date >= latestAirInfo.dataTime;
                            });

                            if (index === pollutant.hourly.length-1) {
                                console.log('There are not hourly forecast');
                                $scope.hourlyChartTitle = "LOC_HOURLY_AQI_INFORMATION";
                            }
                            else {
                                $scope.hourlyChartTitle = "LOC_HOURLY_AQI_FORECAST";
                            }

                            // 과거 11개 + 현재 + 미래 12개 표시
                            $scope.airChart = {
                                data: new Array(24),
                                maxValue: $scope.aqiMaxValue[aqiCode]
                            };
                            for (var i = 0; i < 24; i++) {
                                $scope.airChart.data[i] = pollutant.hourly[index - 12 + i];
                                if ($scope.airChart.data[i] == undefined) {
                                    var date = new Date(pollutant.hourly[index].date);
                                    date.setHours(date.getHours() - 12 + i);
                                    var pad = function(num) {
                                        var s = '0' + num;
                                        return s.substr(s.length - 2);
                                    };

                                    $scope.airChart.data[i] = new Object({
                                        date: [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-') + ' '
                                                + [pad(date.getHours()), pad(date.getMinutes())].join(':')
                                    });
                                }
                            }

                            console.info({code:pollutant.code, pubDate:$scope.forecastPubdate});
                            //console.log(JSON.stringify($scope.airChart));

                            if (Array.isArray(pollutant.daily)) {
                                if (bodyWidth < 360) {
                                    $scope.dayForecast = pollutant.daily.slice(0,4);
                                }
                                else {
                                    $scope.dayForecast = pollutant.daily;
                                }
                            }
                        }
                    }
                }
                else {
                    $scope.aqiList = _getAQIList($scope.airInfo);
                }

                $scope.chartAirHeight = 100;
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
            _applyWeatherData();
        }

        $scope.setMainAqiCode = function(code) {
            Util.ga.trackEvent('air', 'action', 'setMainAqiCodeByUser');
            _setMainAqiCode(code);
            _applyWeatherData();
            $ionicScrollDelegate.scrollTop();
        };

        $scope.$on('applyEvent', function(event, sender) {
            Util.ga.trackEvent('event', 'apply', sender);
            _applyWeatherData();
        });

        init();
    });
