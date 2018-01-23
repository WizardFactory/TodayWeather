angular.module('controller.air', [])
    .controller('AirCtrl', function ($scope, $stateParams, $sce, WeatherInfo, WeatherUtil, Units, Util) {

        var TABLET_WIDTH = 640;

        var cityData;
        var aqiCode;
        var airUnit;

        var aqiStandard = {
                "airkorea": {
                    "color": ['blue', 'green', '#FFD600', 'red'],
                    "str": ['LOC_GOOD', 'LOC_MODERATE', 'LOC_UNHEALTHY', 'LOC_VERY_UNHEALTHY'],
                    "value": {
                        "pm25" : [0, 15, 50, 100, 500],     //ug/m3 (avg 24h)
                        "pm10" : [0, 30, 80, 150, 600],     //ug/m3 (avg 24h)
                        "o3" : [0, 0.03, 0.09, 0.15, 0.6],  //ppm   (avg 1h)
                        "no2" : [0, 0.03, 0.06, 0.2, 2],    //ppm   (avg 1h)
                        "co" : [0, 2, 9, 15, 50],           //ppm   (avg 1h)
                        "so2" : [0, 0.02, 0.05, 0.15, 1],   //ppm   (avg 1h)
                        "aqi" : [0, 50, 100, 250, 500]      //index
                    }
                },
                "airkorea_who": {
                    "color": ['blue', 'green', '#FFD600', 'red'],
                    "str": ['LOC_GOOD', 'LOC_MODERATE', 'LOC_UNHEALTHY', 'LOC_VERY_UNHEALTHY'],
                    "value": {
                        "pm25" : [0, 15, 25, 50, 500],      //ug/m3
                        "pm10" : [0, 30, 50, 100, 600],     //ug/m3
                        "o3" : [0, 0.03, 0.09, 0.15, 0.6],  //ppm
                        "no2" : [0, 0.03, 0.06, 0.2, 2],    //ppm
                        "co" : [0, 2, 9, 15, 50],           //ppm
                        "so2" : [0, 0.02, 0.05, 0.15, 1],   //ppm
                        "aqi" : [0, 50, 100, 250, 500]      //ppm
                    }
                },
                "airnow": {
                    "color": ['green', '#FFD600', 'orange', 'red', 'purple', 'maroon'],
                    "str": ['LOC_GOOD', 'LOC_MODERATE', 'LOC_UNHEALTHY_FOR_SENSITIVE_GROUPS',
                        'LOC_UNHEALTHY', 'LOC_VERY_UNHEALTHY', 'LOC_HAZARDOUS'],
                    "value": {
                        "pm25" : [0, 12.0, 35.4, 55.4, 150.4, 250.4, 500.4],    //ug/m3 (avg 24h)
                        "pm10" : [0, 54, 154, 254, 354, 424, 604],              //ug/m3 (avg 24h)
                        "o3" : [0, 54, 124, 164, 204, 404, 604],                //ppb (avg 8h, 1h)
                        "no2" : [0, 53, 100, 360, 649, 1249, 2049],             //ppb (avg 1h)
                        "co" : [0, 4.4, 9.4, 12.4, 15.4, 30.4, 50.4],           //ppm (avg 8h)
                        "so2" : [0, 35, 75, 185, 304, 604, 1004],               //ppb (avg 1h, 24h)
                        "aqi" : [0, 50, 100, 150, 200, 300, 500]                //index
                    }
                },
                "aqicn": {
                    "color": ['green', '#FFD600', 'orange', 'red', 'purple', 'maroon'],
                    "str": ['LOC_GOOD', 'LOC_MODERATE', 'LOC_UNHEALTHY_FOR_SENSITIVE_GROUPS',
                        'LOC_UNHEALTHY', 'LOC_VERY_UNHEALTHY', 'LOC_HAZARDOUS'],
                    "value": {
                        "pm25" : [0, 35, 75, 115, 150, 250, 500],    //ug/m3 (avg 1h)
                        "pm10" : [0, 50, 150, 250, 350, 420, 600],   //ug/m3 (avg 1h)
                        "o3" : [0, 160, 200, 300, 400, 800, 1200],    //ug/m3 (avg 1h)
                        "no2" : [0, 100, 200, 700, 1200, 2340, 3840], //ug/m3 (avg 1h)
                        "co" : [0, 5, 10, 35, 60, 90, 150],          //ug/m3 (avg 1h)
                        "so2" : [0, 150, 500, 650, 800, 1600, 2620],  //ug/m3
                        "aqi" : [0, 50, 100, 150, 200, 300, 500]
                    }
                }
            };

        $scope.getAqiStnWidth = function (len) {
            var w;
            var r;
            try {
                w = angular.element(document.getElementById("aqistd")).prop('offsetWidth');
                r = (w-len*2)/len;
            }
            catch (err) {
                Util.ga.trackException(err, false);
            }
            return r;
        };

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
                    startV = $scope.aqiStandard[grade-2].value;
                }
                else {
                    startV = 0;
                }
                endV = $scope.aqiStandard[grade-1].value;

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

        /**
         * 데이터가 없는 경우 아무것도 그리지 않음.
         * @param grade
         * @returns {string}
         */
        $scope.grade2Color = function (grade) {
            var color = 'white';
            try {
                if (!$scope.hasOwnProperty('aqiStandard') || grade == undefined) {
                    return color;
                }
                if (grade > $scope.aqiStandard.length) {
                    Util.ga.trackEvent('air', 'error', 'invalidGradeAtGrade2Color', grade);
                    grade = $scope.aqiStandard.length;
                }
                color = $scope.aqiStandard[grade-1].color;
            }
            catch (err) {
                Util.ga.trackException(err, false);
            }
            return color;
        };

        /**
         * 데이터가 없는 경우 검은 아이콘 표시
         * @param grade
         * @returns {string}
         */
        $scope.mainGrade2Color = function (grade) {
            var color = '';
            try {
                if (!$scope.hasOwnProperty('aqiStandard') || grade == undefined) {
                    return color;
                }
                if (grade > $scope.aqiStandard.length) {
                    Util.ga.trackEvent('air', 'error', 'invalidGradeAtMainGrade2Color', grade);
                    grade = $scope.aqiStandard.length;
                }
                color = $scope.aqiStandard[grade-1].color;
            }
            catch (err) {
                Util.ga.trackException(err, false);
            }
            return color;
        };

        $scope.airkoreaGrade2Color = function (grade) {
            var color = '';
            try {
                var airkoreaColor = aqiStandard.airkorea.color;
                if (grade > airkoreaColor.length) {
                    Util.ga.trackEvent('air', 'error', 'invalidGradeAtAirekoreaGrade2Color', grade);
                    grade = airkoreaColor.length;
                }
                color = airkoreaColor[grade-1];
            }
            catch (err) {
                Util.ga.trackException(err, false);
            }
            return color;
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

        function _getAQIList(airInfo) {
            var list = [];
            try {
                ['pm25', 'pm10', 'o3', 'no2', 'co', 'so2', 'aqi'].forEach(function (propertyName) {
                    if (airInfo.hasOwnProperty(propertyName+'Value')) {
                        var obj = {};
                        obj.name = _getAQIname(propertyName);
                        obj.value = airInfo[propertyName+'Value'];
                        obj.grade = airInfo[propertyName+'Grade'];
                        obj.str = airInfo[propertyName+'Str'];
                        obj.code = propertyName;
                        list.push(obj);
                    }
                });
            }
            catch (err) {
                Util.ga.trackException(err, false);
            }
            return list;
        }

        function _setUnit() {
            try {
                airUnit = Units.getUnit('airUnit');
                Util.ga.trackEvent('air', 'setUnit', airUnit);

                var length = aqiStandard[airUnit].color.length;
                var list = [];
                for (var i=0; i<length; i++) {
                    var obj = {
                        "color": aqiStandard[airUnit].color[i],
                        "str": aqiStandard[airUnit].str[i],
                        "value": aqiStandard[airUnit].value[aqiCode][i+1]
                    };
                    list.push(obj);
                }

                $scope.aqiStandard = list;
                console.info($scope.aqiStandard);
            }
            catch (err) {
                Util.ga.trackException(err, false);
            }
        }

        function _setMainAqiCode(code) {
            Util.ga.trackEvent('air', 'setMainAqiCode', code);
            aqiCode = code;
            $scope.airCodeName = _getAQIname(aqiCode);
            $scope.dayForecastStandard = aqiStandard.airkorea.color;
        }

        function _applyWeatherData(data) {
            cityData = data;
            try {
                Util.ga.trackEvent('air', 'applyWeatherData');
                var airInfo =  cityData.currentWeather.arpltn;
                if (airInfo[aqiCode+'Value'] == undefined) {
                    //skip current aqicode
                    var newAqiCode = ['pm25', 'pm10', 'o3', 'no2', 'co', 'so2', 'aqi'].find(function (propertyName) {
                        return airInfo[propertyName+'Value'] != undefined;
                    });
                    _setMainAqiCode(newAqiCode);
                }

                $scope.airInfo = airInfo;
                $scope.airCodeValue = $scope.airInfo[aqiCode+'Value'];
                $scope.airCodeGrade = $scope.airInfo[aqiCode+'Grade'];
                $scope.airCodeStr = $scope.airInfo[aqiCode+'Str'];

                $scope.aqiList = _getAQIList($scope.airInfo);
                console.log($scope.aqiList);
                $scope.cityCount = WeatherInfo.getEnabledCityCount();
                $scope.dayForecast = _getDustForecast(cityData.dayChart[0].values);
                console.log($scope.dayForecast);

                $scope.address = cityData.name || WeatherUtil.getShortenAddress(cityData.address);
                console.log($scope.address);

                if (cityData.hasOwnProperty('air_forecast')) {
                    var airForecast = cityData.air_forecast.find(function (value) {
                        var code = value.code.toLowerCase();
                        if (aqiCode === code) {
                            return true;
                        }
                        return false;
                    });
                    if (airForecast) {
                        $scope.forecastPubdate = airForecast.pubDate;
                        $scope.hourlyForecast = _getHourlyForecast(cityData.currentWeather.dateObj, airForecast.hourly);
                        console.info({code:airForecast.code, pubDate:$scope.forecastPubdate});
                        console.log(JSON.stringify($scope.hourlyForecast));
                    }
                    else {
                        $scope.hourlyForecast = [];
                        $scope.forecastPubdate = "";
                    }
                }
                else {
                    $scope.hourlyForecast = [];
                    $scope.forecastPubdate = "";
                }
            }
            catch(err) {
                Util.ga.trackException(err, false);
            }
        }

        function init() {
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
                _setMainAqiCode('pm25');
            }

            _setUnit();

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
            _setUnit();
            var data = WeatherInfo.getCityOfIndex(WeatherInfo.getCityIndex());
            _applyWeatherData(data);
        };

        $scope.$on('applyEvent', function(event, sender) {
            Util.ga.trackEvent('event', 'apply', sender);
            var data = WeatherInfo.getCityOfIndex(WeatherInfo.getCityIndex());
            _applyWeatherData(data);
        });

        init();
    });
