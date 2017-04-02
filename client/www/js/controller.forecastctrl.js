angular.module('controller.forecastctrl', [])
    .controller('ForecastCtrl', function ($scope, $rootScope, $ionicScrollDelegate,
                                          $ionicNavBarDelegate, $q, $http, $timeout, WeatherInfo, WeatherUtil, Util,
                                          Purchase, $stateParams, $location, $ionicHistory, $sce, $ionicLoading,
                                          $ionicPopup, $translate, Units) {
        var TABLET_WIDTH = 720;
        var ASPECT_RATIO_16_9 = 1.7;
        var bodyWidth;
        var bodyHeight;
        var colWidth;
        var cityData = null;

        $scope.showDetailWeather = false;
        if ($location.path() === '/tab/dailyforecast') {
            $scope.forecastType = "mid"; //mid, detail(aqi)
        }
        else {
            $scope.forecastType = "short"; //mid, detail(aqi)
        }

        var shortenAddress = "";

        $scope.imgPath = Util.imgPath;

        if ($scope.forecastType == 'mid') {
            $scope.dayToString = function(day) {
                var dayStr = ['LOC_SUN', 'LOC_MON', 'LOC_TUE', 'LOC_WED', 'LOC_THU', 'LOC_FRI', 'LOC_SAT'];
                return dayStr[day];
            };

            $scope.dayToFullString = function(day) {
                var dayFullStr = ['LOC_SUNDAY', 'LOC_MONDAY', 'LOC_TUESDAY', 'LOC_WEDNESDAY', 'LOC_THURSDAY',
                    'LOC_FRIDAY', 'LOC_SATURDAY'];
                return dayFullStr[day];
            };

            $scope.hasDustForecast = function () {
                if ($scope.dayChart == undefined) {
                    return false;
                }
                for (var i=$scope.dayChart[0].values.length-1; i>=0; i--) {
                    var day = $scope.dayChart[0].values[i];
                    if (day.fromToday == 0) {
                        if (day.hasOwnProperty('dustForecast')) {
                            return true;
                        }
                        return false;
                    }
                }
                return false;
            };

            $scope.checkDailyDetailWeather = function (day) {
               if (day.fromToday == -1 || day.fromToday == 0 || day.fromToday == 1)  {
                   return true;
               }
                return false;
            };

            /**
             * it's false whean preperty is 0 or undefined
             * @param obj
             * @param propertyNameList
             * @private
             */
            function _hasProperty(obj, propertyNameList) {
                for (var i=propertyNameList.length-1; i>=0; i--)  {
                    if (obj[propertyNameList[i]]) {
                        return true;
                    }
                }
                return false;
            }

            $scope.hasPropertyInThreeDays = function(propertyNameList) {
                var todayIndex = $scope.currentWeather.today.index;
                if (todayIndex == undefined) {
                    console.log("today index is undefined, daily list has not today data");
                    return false;
                }

                var dayTable = $scope.dayChart[0].values;
                if (dayTable) {
                    if (_hasProperty(dayTable[todayIndex], propertyNameList)) {
                        return true;
                    }
                    if (todayIndex > 0) {
                        var yesterday = dayTable[todayIndex-1];
                        if (_hasProperty(yesterday, propertyNameList)) {
                            return true;
                        }
                    }
                    if (todayIndex < dayTable.length-1) {
                        var tomorrow = dayTable[todayIndex+1];
                        if (_hasProperty(tomorrow, propertyNameList)) {
                            return true;
                        }
                    }
                }
                return false;
            }
        }

        if ($scope.forecastType == 'short') {
            var preDayInHourlyTable;
            $scope.isNextDay = function(weatherData, index) {
                if (weatherData.time == 24 && index == 0) {
                    return false;
                }
                if (preDayInHourlyTable == undefined) {
                    preDayInHourlyTable = weatherData.date;
                    return true;
                }
                else if (preDayInHourlyTable != weatherData.date) {
                    preDayInHourlyTable = weatherData.date;
                    return true;
                }
                return false;
            };

            /**
             * 위치가 정확하지는 않지만, 모레와 과거에 대한 데이터가 가변일때 제대로 표시됨.
             * 24시 표기에서는 index를 한칸 당김.
             * @param index
             * @returns {number}
             */
            $scope.getDayPosition = function(value, index) {
                if (value.time > 0) {
                    index -= 1;
                }
                return $scope.colWidth/2 + index*colWidth;
            };
        }

        $scope.openUrl = function (src) {
            if (window.cordova && cordova.InAppBrowser) {
                cordova.InAppBrowser.open(src, "_system");
                Util.ga.trackEvent('action', 'click', 'open weather source');
            }
            else {
                var options = {
                    location: "yes",
                    clearcache: "yes",
                    toolbar: "no"
                };
                window.open(src, "_blank", options);
            }
        };

        $scope.getDayString = function (day) {
            var dayFromTodayStr =['LOC_A_COUPLE_OF_DAYS_AGO', 'LOC_THE_DAY_BEFORE_YESTERDAY', 'LOC_YESTERDAY',
                'LOC_TODAY', 'LOC_TOMORROW', 'LOC_THE_DAY_AFTER_TOMORROW', 'LOC_TWO_DAYS_AFTER_TOMORROW',
                'LOC_FROM_TODAY'];
            if (-3 <= day && day <= 3) {
                return dayFromTodayStr[day + 3];
            }
            else {
                //이 케이스 아직 없음.
                return dayFromTodayStr[dayFromTodayStr.length-1];
            }
            console.error("Fail to get day string day=" + day);
            return "";
        };

        $scope.getSentimentIcon = function (grade) {
           switch (grade) {
               case 1:
                   return 'ic_sentiment_satisfied_white_24px.svg';
               case 2:
                   return 'ic_sentiment_neutral_white_24px.svg';
               case 3:
                   return 'ic_sentiment_dissatisfied_white_24px.svg';
               case 4:
                   return 'ic_sentiment_very_dissatisfied_white_24px.svg';
               case 5:
                   return 'ic_sentiment_very_dissatisfied_white_24px.svg';
               default:
                   console.log('Fail to find grade='+grade);
           }
            return 'ic_sentiment_very_dissatisfied_white_24px.svg';
        };

        $scope.getSentimentStr = function(grade) {
            var airGradeStr = ['LOC_GOOD', 'LOC_MODERATE', 'LOC_UNHEALTHY_FOR_SENSITIVE_GROUPS', 'LOC_UNHEALTHY', 'LOC_VERY_UNHEALTHY', 'LOC_HAZARDOUS'];
            if (grade >= 3) {
                grade++;
            }
            return airGradeStr[grade-1];
        };

        $scope.getLowHighGradeStr = function (grade) {
           var lowHighGradeStr = ['LOC_LOW', 'LOC_NORMAL', 'LOC_HIGH', 'LOC_VERY_HIGH', 'LOC_HAZARD'];
            return lowHighGradeStr[grade];
        };

        $scope.getAttentionWarningGradeStr = function (grade) {
            var awGradeStr = ['LOC_ATTENTION', 'LOC_CAUTION', 'LOC_WARNING', 'LOC_HAZARD'];
            return awGradeStr[grade];
        };

        /**
         * controllerKmaStnWeather._makeWeatherType , $scope.getWeatherStr, self._description2weatherType 와 sync 맞추어야 함
         * @param current
         * @returns {*}
         */
        $scope.getWeatherStr = function (current) {
            if (current.weatherType == undefined) {
                if (!(current.weather == undefined)) {
                    return current.weather;
                }
                return "";
            }

            /**
             * 순서가 server의 _description2weatherType, _makeWeatherType와 동일해야 함.
             * @type {string[]}
             */
            var weatherTypeStr = ['LOC_CLEAR', 'LOC_PARTLY_CLOUDY', 'LOC_MOSTLY_CLOUDY', 'LOC_CLOUDY', 'LOC_MIST',
                'LOC_HAZE', 'LOC_FOG', 'LOC_THIN_FOG', 'LOC_DENSE_FOG', 'LOC_FOG_STOPPED',

                'LOC_FOG', 'LOC_PARTLY_FOG', 'LOC_YELLOW_DUST', 'LOC_RAIN', 'LOC_LIGHT_DRIZZLE',
                'LOC_DRIZZLE', 'LOC_HEAVY_DRIZZLE', 'LOC_DRIZZLE_STOPPED', 'LOC_LIGHT_RAIN_AT_TIMES', 'LOC_LIGHT_RAIN',

                'LOC_RAIN_AT_TIMES', 'LOC_RAIN', 'LOC_HEAVY_RAIN_AT_TIMES', 'LOC_HEAVY_RAIN', 'LOC_LIGHT_SHOWERS',
                'LOC_SHOWERS', 'LOC_HEAVY_SHOWERS', 'LOC_SHOWERS_STOPPED', 'LOC_RAIN_STOPPED', 'LOC_LIGHT_SLEET',

                'LOC_HEAVY_SLEET', 'LOC_SLEET_STOPPED', 'LOC_LIGHT_SNOW_AT_TIMES', 'LOC_LIGHT_SNOW', 'LOC_SNOW_AT_TIMES',
                'LOC_SNOW', 'LOC_HEAVY_SNOW_AT_TIMES', 'LOC_HEAVY_SNOW', 'LOC_LIGHT_SNOW_SHOWERS', 'LOC_HEAVY_SNOW_SHOWERS',

                'LOC_SNOW_SHOWERS_STOPPED', 'LOC_SNOW_STOPPED', 'LOC_LIGHT_SNOW_PELLETS', 'LOC_HEAVY_SNOW_PELLETS', 'LOC_LIGHT_SNOW_STORM',
                'LOC_SNOW_STORM', 'LOC_HEAVY_SNOW_STORM', 'LOC_POWDER_SNOW', 'LOC_WATER_SPOUT', 'LOC_HAIL',

                'LOC_THUNDERSHOWERS', 'LOC_THUNDERSHOWERS_HAIL', 'LOC_THUNDERSHOWERS_RAIN_SNOW', 'LOC_THUNDERSHOWERS_STOPPED_RAIN', 'LOC_THUNDERSHOWERS_STOPPED_SNOW',
                'LOC_LIGHTNING', 'LOC_BOLT_FROM_THE_BLUE', 'LOC_BOLT_STOPPED', 'LOC_ICE_PELLETS', 'LOC_BREEZY',
                'LOC_HUMID', 'LOC_WINDY', 'LOC_DRY', 'LOC_VERY_STRONG_WIND', 'LOC_SLEET'];
            return weatherTypeStr[current.weatherType];
        };

        var regionSize;
        var regionSumSize;
        var bigDigitSize;
        //var bigTempPointSize;
        var bigSkyStateSize;
        //var smallTimeSize;
        var smallImageSize;
        //var smallDigitSize;
        var headerRatio = 0.4;
        var contentRatio = 0.6;
        var showAqi = false;

        /* The height of a toolbar by default in Angular Material */
        var legacyToolbarH = 58;
        var startHeight;
        var headerE;
        var picture;
        var alphaBar;
        var pBigDigit;
        var imgBigSkyStateSize;

        // retry popup이 없는 경우 항상 undefined여야 함.
        var isLoadingIndicator = false;
        var strError = "Error";
        var strAddLocation = "Add locations";
        var strClose = "Close";
        var strRetry = "Retry";
        var strFailToGetAddressInfo = "Fail to get location information";
        var strFailToGetCurrentPosition = "Fail to find your current location";
        var strFailToGetWeatherInfo = "Fail to get weather info.";
        var strPleaseTurnOnLocationWiFi = "Please turn on location and Wi-FI";
        $scope.strHour = "h";

        $translate(['LOC_ERROR', 'LOC_ADD_LOCATIONS', 'LOC_HOUR', 'LOC_CLOSE', 'LOC_RETRY',
            'LOC_FAIL_TO_GET_LOCATION_INFORMATION', 'LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION',
            'LOC_FAIL_TO_GET_WEATHER_INFO', 'LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI']).then(function (translations) {
            strError = translations.LOC_ERROR;
            strAddLocation = translations.LOC_ADD_LOCATIONS;
            strClose = translations.LOC_CLOSE;
            strRetry = translations.LOC_RETRY;
            strFailToGetAddressInfo = translations.LOC_FAIL_TO_GET_LOCATION_INFORMATION;
            strFailToGetCurrentPosition = translations.LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION;
            strFailToGetWeatherInfo = translations.LOC_FAIL_TO_GET_WEATHER_INFO;
            strPleaseTurnOnLocationWiFi = translations.LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI;
            $scope.strHour = translations.LOC_HOUR;
        }, function (translationIds) {
            console.log("Fail to translate : " + JSON.stringify(translationIds));
        });

        function init() {
            //identifyUser();
            $ionicHistory.clearHistory();

            if (window.screen.height) {
                bodyHeight = window.screen.height;
                bodyWidth = window.screen.width;
            }
            else if (window.innerHeight) {
                //crosswalk에서 늦게 올라옴.
                bodyHeight = window.innerHeight;
                bodyWidth = window.innerWidth;
            }
            else if (window.outerHeight) {
                //ios에서는 outer가 없음.
                bodyHeight = window.outerHeight;
                bodyWidth = window.outerWidth;
            }
            else {
                console.log("Fail to get window width, height");
                bodyHeight = 640;
                bodyWidth = 360;
            }

            colWidth = bodyWidth/7;
            if (colWidth > 60) {
                colWidth = 60;
            }
            $scope.colWidth = colWidth;

            if (bodyWidth >= TABLET_WIDTH && bodyWidth < bodyHeight) {
                headerRatio = 0.4;
                contentRatio = 0.6;
            }
            else if (bodyHeight >= 730) {
                //note5, nexus5x, iphone 5+
                if (ionic.Platform.isIOS()) {
                    headerRatio = 0.40;
                    contentRatio = 0.60;
                }
                else {
                    headerRatio = 0.32;
                    contentRatio = 0.68;
                }
            }
            else {
                headerRatio = 0.32;
                contentRatio = 0.68;
            }

            /* The height of a toolbar by default in Angular Material */
            legacyToolbarH = 58;
            startHeight = bodyHeight * headerRatio;
            headerE         = angular.element(document.querySelector('[md-page-header]'));
            picture        = angular.element(document.querySelector('[md-header-picture]'));
            alphaBar        = angular.element(document.getElementById('alphaBar'));

            //console.log(headerE);
            //console.log(picture);
            //console.log("startHeight=", startHeight);

            headerE.css('height', startHeight+'px');
            picture.css('height', startHeight+'px');
            //빠르게 변경될때, header가 disable-user-behavior class가 추가되면서 화면이 올라가는 문제
            $scope.headerHeight = startHeight;

            var padding = 1;
            var smallPadding = 1;

            //iphone 4 480-20(status bar)
            if ((bodyHeight === 460 || bodyHeight === 480) && bodyWidth === 320) {
                padding = 1.125;
                smallPadding = 1.1;
            }
            //iphone 5 568-20(status bar)
            if ((bodyHeight === 548 || bodyHeight === 568) && bodyWidth === 320) {
                smallPadding = 1.1;
            }

            if (bodyHeight >= 640) {
                //대부분의 android와 iPhone6부터 aqi보여줌.
                showAqi = true;
            }
            else if (Purchase.accountLevel != Purchase.ACCOUNT_LEVEL_FREE
                && bodyHeight / bodyWidth >= ASPECT_RATIO_16_9) {
                //free이상의 유저이며, 16:9 이상 비율은 aqi보여줌.
                showAqi = true;
            }

            var mainHeight = bodyHeight - 100;

            //var topTimeSize = mainHeight * 0.026;
            //$scope.topTimeSize = topTimeSize<16.8?topTimeSize:16.8;

            regionSize = mainHeight * 0.0306 * padding; //0.051
            regionSize = regionSize<33.04?regionSize:33.04;
            $scope.regionSize = regionSize;

            regionSumSize = mainHeight * 0.0336 * padding; //0.047
            regionSumSize = regionSumSize<30.45?regionSumSize:30.45;
            $scope.regionSumSize = regionSumSize;

            bigDigitSize = mainHeight * 0.12264 * padding; //0.2193
            bigDigitSize = bigDigitSize<142.1?bigDigitSize:142.1;
            $scope.bigDigitSize = bigDigitSize;

            //bigTempPointSize = mainHeight * 0.03384 * padding; //0.0423
            //bigTempPointSize = bigTempPointSize<27.4?bigTempPointSize:27.4;

            bigSkyStateSize = mainHeight * 0.11264 * padding; //0.1408
            bigSkyStateSize = bigSkyStateSize<91.2?bigSkyStateSize:91.2;
            $scope.bigSkyStateSize = bigSkyStateSize;

            //smallTimeSize = mainHeight * 0.0299 * smallPadding;
            //smallTimeSize = smallTimeSize<19.37?smallTimeSize:19.37;

            smallImageSize = mainHeight * 0.0512 * smallPadding;
            smallImageSize = smallImageSize<33.17?smallImageSize:33.17;
            $scope.smallImageSize = smallImageSize;

            //smallDigitSize = mainHeight * 0.0320 * smallPadding;
            //smallDigitSize = smallDigitSize<20.73?smallDigitSize:20.73;

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
            if (WeatherInfo.getEnabledCityCount() === 0) {
                $scope.startPopup();
                return;
            }
            $scope.cityCount = WeatherInfo.getEnabledCityCount();

            applyWeatherData();
            loadWeatherData();
        }

        /**
         * 실제 강우량과, 예보 강우량을 구분하는데 all인 경우 두개 모두 표시
         * @param pty
         * @param rn1
         * @param r06
         * @param s06
         * @param all
         * @returns {string}
         * @private
         */
        function _makeRainSnowFallValueStr(pty, rn1, r06, s06, all) {
            var ret = "";
            var frcst = 0;
            var rsf = 0;

            if (rn1 != undefined && rn1 > 0) {
                rsf = rn1>=10?Math.round(rn1):rn1;
                return rsf;
            }
            else if (s06 != undefined && s06 > 0) {
                frcst = s06>=10?Math.round(s06):s06;
                return frcst;
            }
            else if (r06 != undefined && r06 > 0) {
                frcst = r06>=10?Math.round(r06):r06;
                return frcst;
            }

            //if (rn1 != undefined && rn1 > 0) {
            //    if ((r06 != undefined || s06 != undefined) && all) {
            //        ret += rsf+'/'+frcst;
            //    }
            //    else {
            //        ret += rsf;
            //    }
            //    return ret;
            //}
            //else if ((r06 != undefined && r06 > 0) || (r06 != undefined && s06 > 0)) {
            //    if (rn1 != undefined && all) {
            //        ret += rsf+'/'+frcst;
            //    }
            //    else {
            //        ret += frcst;
            //    }
            //    return ret;
            //}
            //if (pty > 0) {
            //   ret = "0";
            //}
            return ret;
        }

        $scope.getRainSnowFallSymbol = function (value) {
            if (value.rn1 > 0) {
               if (value.pty == 3)  {
                   return "snow";
               }
                else {
                   return "rain";
               }
            }
            else if (value.s06 > 0) {
                return "snow";
            }
            else if (value.r06 > 0) {
                return "rain";
            }
            else {
                return "rain";
            }
        };

        $scope.getRainSnowFall = function (value) {
            var ret = _makeRainSnowFallValueStr(value.pty, value.rn1, value.r06, value.s06);
            if (ret == "") {
                ret = "0";
            }
            return ret;
        };

        /**
         * display item을 count하여 table pixel을 구함.
         * 0.9.1까지 displayItemCount가 없음.
         * @param displayItemCount
         * @returns {number}
         */
        function getShortTableHeight(displayItemCount) {
            var val = 0;
            if (displayItemCount >= 1) {
                //sky
                val += $scope.smallImageSize;
            }
            if (displayItemCount >= 2) {
                //pop body1
                val += 15;
            }
            if (displayItemCount >= 3) {
                //rn1 - caption
                val += 13;
            }
            return val;
        }

        $scope.getShortTableHeight = getShortTableHeight;

        /**
         * display item을 count하여 table pixel을 구함.
         * @param displayItemCount
         * @returns {number}
         */
        function getMidTableHeight(displayItemCount) {
            var val = 17; //day  - subheading
            if (displayItemCount == undefined || displayItemCount == 0) {
                displayItemCount = 7;
            }
            //최소한 한개의 이미지는 존재함.
            val += $scope.smallImageSize;

            if (displayItemCount & 4) {
                val += $scope.smallImageSize;
            }
            else {
                val += $scope.smallImageSize/2;
            }
            if (displayItemCount & 2) {
                //pop - body1
                val += 15;
            }
            if (displayItemCount & 1) {
                //rns - caption
                val += 13;
            }
            return val;
        }

        $scope.getMidTableHeight = getMidTableHeight;

        function applyWeatherData() {
            var dayTable;

            console.log('apply weather data');
            cityData = WeatherInfo.getCityOfIndex(WeatherInfo.getCityIndex());
            if (cityData === null || cityData.address === null) {
                console.log("fail to getCityOfIndex");
                return;
            }

            if (cityData.source) {
                $scope.source = cityData.source;
            }

            dayTable = cityData.dayChart[0].values;

            $scope.timeWidth = colWidth * cityData.timeTable.length;
            $scope.dayWidth = colWidth * dayTable.length;

            if (cityData.name) {
                shortenAddress = cityData.name;
            }
            else {
                shortenAddress = WeatherUtil.getShortenAddress(cityData.address);
            }

            $scope.address = shortenAddress;
            console.log(shortenAddress);
            $scope.currentWeather = cityData.currentWeather;

            $scope.currentPosition = cityData.currentPosition;

            $scope.updateTime = (function () {
               if (cityData.currentWeather) {
                   if (cityData.currentWeather.stnDateTime) {
                       return cityData.currentWeather.stnDateTime;
                   }
                   else {
                       var tmpDate = cityData.currentWeather.date;
                       if (tmpDate instanceof Date) {
                           return tmpDate.toDateString();
                       }
                       else {
                           return tmpDate.substr(0,4)+"-"+tmpDate.substr(4,2)+"-" +tmpDate.substr(6,2) +
                               " " + cityData.currentWeather.time + ":00";
                       }
                   }
               }
            })();

            // To share weather information for apple watch.
            // AppleWatch.setWeatherData(cityData);

            var mainHeight = bodyHeight * contentRatio;
            var padding = 0;

            //의미상으로 배너 여부이므로, TwAds.enabledAds가 맞지만 loading이 느려, account level로 함.
            //광고 제거 버전했을 때, AQI가 보이게 padding맞춤. 나머지 14px는 chart에서 사용됨.
            if (Purchase.accountLevel == Purchase.ACCOUNT_LEVEL_FREE) {
                padding += 36;
            }

            if (bodyHeight === 480) {
                //iphone4
                padding -= 32;
            }
            else if (ionic.Platform.isAndroid()) {
                //status bar
                padding += 24;
                if (bodyHeight <= 512) {
                    //view2 4:3
                    padding -= 32;
                }
            }

            if($scope.forecastType == 'short') {
                if (showAqi) {
                    padding += 36;
                }
                var chartShortHeight = mainHeight - (143 + padding);
                $scope.chartShortHeight = chartShortHeight < 300 ? chartShortHeight : 300;
            }
            else {
                //오전 오후를 상하에서 좌우로 변경시에 적용 가능
                //if (showAqi && dayTable.length >= 8 && dayTable[cityData.currentWeather.today.index].dustForecast) {
                //    padding+=36;
                //}
                var chartMidHeight = mainHeight - (136+padding);
                $scope.chartMidHeight = chartMidHeight < 300 ? chartMidHeight : 300;
            }
            /**
             * loading을 분산시켜서 탭 전환을 빠르게 보이도록 함.
             */
            setTimeout(function () {
                $scope.showDetailWeather = true;
                _diffTodayYesterday($scope.currentWeather, $scope.currentWeather.yesterday);
                _makeSummary($scope.currentWeather, $scope.currentWeather.yesterday);
                if($scope.forecastType == 'short') {
                    $scope.timeTable = cityData.timeTable;
                    $scope.timeChart = cityData.timeChart;

                    // ios에서 ionic native scroll 사용시에 화면이 제대로 안그려지는 경우가 있어서 animation 필수.
                    // ios에서 scroll 할때 scroll freeze되는 현상 있음.
                    // iOS 10.2.1에서 animation 없어도 화면이 제대로 안그려지는 이슈 발생하지 않음.
                    if (ionic.Platform.isAndroid()) {
                        $ionicScrollDelegate.$getByHandle("timeChart").scrollTo(getTodayPosition(), 0, false);
                    } else {
                        $ionicScrollDelegate.$getByHandle("timeChart").scrollTo(getTodayPosition(), 0, false);
                        //$ionicScrollDelegate.$getByHandle("timeChart").scrollTo(getTodayPosition(), 0, true);
                    }
                }
                else {
                    $scope.dayChart = cityData.dayChart;

                    /**
                     * iOS에서 short -> mid 로 변경할때, animation이 없으면 매끄럽게 스크롤되지 않음.
                     */
                    if (ionic.Platform.isAndroid()) {
                        $ionicScrollDelegate.$getByHandle("weeklyChart").scrollTo(getTodayPosition(), 0, false);
                        $ionicScrollDelegate.$getByHandle("weeklyTable").scrollTo(300, 0, false);
                    } else {
                        $ionicScrollDelegate.$getByHandle("weeklyChart").scrollTo(getTodayPosition(), 0, true);
                        $ionicScrollDelegate.$getByHandle("weeklyTable").scrollTo(300, 0, true);
                    }
                }
            }, 0);
        }

        function showLoadingIndicator() {
            $ionicLoading.show().then(function() {
                // retry 시에 show 후에 바로 hide를 할 때 hide의 resolve가 먼저 처리되어 LoadingIndicator가 보여지는 경우가 있음
                // 실제로 show가 되면 상태를 체크하여 hide를 다시 요청함
                if (isLoadingIndicator == false) {
                    $ionicLoading.hide();
                }
            });
            isLoadingIndicator = true;
        }

        function hideLoadingIndicator() {
            $ionicLoading.hide();
            isLoadingIndicator = false;
        }


        function loadWeatherData() {
            if (cityData.address === null || WeatherInfo.canLoadCity(WeatherInfo.getCityIndex()) === true) {
                showLoadingIndicator();

                updateCurrentPosition().then(function() {
                    updateWeatherData().then(function () {
                        hideLoadingIndicator();
                    }, function (msg) {
                        hideLoadingIndicator();
                        $scope.showRetryConfirm(strError, msg, 'forecast');
                    });
                }, function(msg) {
                    hideLoadingIndicator();
                    if (msg !== null) {
                        $scope.showRetryConfirm(strError, msg, 'forecast');
                    }
                    else {
                        //pass for reload
                    }
                });
                return;
            }

            hideLoadingIndicator();
        }

        function updateCurrentPosition() {
            var deferred = $q.defer();

            if (cityData.currentPosition === false) {
                deferred.resolve();
                return deferred.promise;
            }

            if (window.cordova && window.cordova.plugins && window.cordova.plugins.diagnostic) {

                if (ionic.Platform.isIOS()) {
                    if (Util.isLocationEnabled()) {
                        _getCurrentPosition(deferred, true, true);
                    } else if (Util.locationStatus === cordova.plugins.diagnostic.permissionStatus.NOT_REQUESTED) {
                        // location service가 off 상태로 시작한 경우에는 denied로 설정되어 있음. on 상태인 경우에 not_requested로 들어옴
                        _getCurrentPosition(deferred, true, undefined);
                    } else {
                        _getCurrentPosition(deferred, false, undefined);
                    }
                }
                else if (ionic.Platform.isAndroid()) {
                    if (Util.isLocationEnabled()) {
                        cordova.plugins.diagnostic.getLocationAuthorizationStatus(function (status) {
                            console.log('status='+status);
                            $scope.setLocationAuthorizationStatus(status);
                            if (status === cordova.plugins.diagnostic.permissionStatus.GRANTED) {
                                _getCurrentPosition(deferred, true, true);
                            } else if (status === cordova.plugins.diagnostic.permissionStatus.DENIED_ALWAYS) {
                                _getCurrentPosition(deferred, true, false);
                            } else if (status === cordova.plugins.diagnostic.permissionStatus.NOT_REQUESTED
                                || status === cordova.plugins.diagnostic.permissionStatus.DENIED) {
                                _getCurrentPosition(deferred, true, undefined);
                            }
                        }, function (error) {
                            console.error("Error getting for location authorization status: " + error);
                        });
                    } else {
                        _getCurrentPosition(deferred, false, undefined);
                    }
                }
            }
            else {
                _getCurrentPosition(deferred, true, true);
            }

            return deferred.promise;
        }

        function _getCurrentPosition(deferred, isLocationEnabled, isLocationAuthorized) {
            var msg;
            Util.ga.trackEvent('position', 'status', 'enabled', isLocationEnabled?1:0);
            Util.ga.trackEvent('position', 'status', 'authorized', isLocationAuthorized?1:0);
            if (isLocationEnabled === true) {
                if (isLocationAuthorized === true) {
                    WeatherUtil.getCurrentPosition().then(function (coords) {
                        WeatherUtil.getGeoInfoFromGeolocation(coords.latitude, coords.longitude).then(function (geoInfo) {
                            cityData.name = geoInfo.name;
                            cityData.country = geoInfo.country;
                            cityData.address = geoInfo.address;
                            //device location을 사용하기 위해서는 아래 코드 사용하면 됨.
                            //cityData.location = WeatherUtil.geolocationNormalize({"lat": coords.latitude, "long": coords.longitude});
                            cityData.location = geoInfo.location;
                            WeatherInfo.updateCity(WeatherInfo.getCityIndex(), cityData);
                            deferred.resolve();
                        }, function () {
                            deferred.reject(strFailToGetAddressInfo);
                        });
                    }, function () {
                        Util.ga.trackEvent('position', 'error', 'all');
                        msg = strFailToGetCurrentPosition;
                        if (ionic.Platform.isAndroid()) {
                            msg += "<br>" + strPleaseTurnOnLocationWiFi;
                        }
                        deferred.reject(msg);
                    });
                }
                else if (isLocationAuthorized === false) {
                    msg = $translate.instant("LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED");
                    deferred.reject(msg);
                }
                else if (isLocationAuthorized === undefined) {
                    hideLoadingIndicator();
                    if (window.cordova && window.cordova.plugins && window.cordova.plugins.diagnostic) {
                        // ios : 앱을 사용하는 동안 '오늘날씨'에서 사용자의 위치에 접근하도록 허용하겠습니까?
                        // android : 오늘날씨의 다음 작업을 허용하시겠습니까? 이 기기의 위치에 액세스하기
                        cordova.plugins.diagnostic.requestLocationAuthorization(function (status) {
                            // ios에서는 registerLocationStateChangeHandler에서 locationStatus가 변경되고 reload 이벤트가 발생함
                            if (ionic.Platform.isAndroid()) {
                                $scope.setLocationAuthorizationStatus(status);
                                if (status === cordova.plugins.diagnostic.permissionStatus.DENIED) {
                                    msg = $translate.instant("LOC_PERMISSION_REQUEST_DENIED_PLEASE_SEARCH_BY_LOCATION_NAME_OR_RETRY");
                                    deferred.reject(msg);
                                }
                                else {
                                    console.log('status='+status+ ' by request location authorization and reload by resume');
                                    deferred.reject(null);
                                }
                            }
                            else {
                                //메세지 없이 통과시키고, reload by locationOn.
                                deferred.reject(null);
                            }
                        }, function (error) {
                            Util.ga.trackEvent('position', 'error', 'request location authorization');
                            Util.ga.trackException(error, false);
                            deferred.reject(null);
                        }, cordova.plugins.diagnostic.locationAuthorizationMode.WHEN_IN_USE);
                    }
                    else {
                        /**
                         * 이미 체크하고 함수에 들어오기 때문에 발생할 수 없음.
                         */
                        Util.ga.trackEvent('plugin', 'error', 'loadDiagnostic');
                        deferred.reject(null);
                    }
                }
            }
            else if (isLocationEnabled === false) {
                if (cityData.address === null && cityData.location === null) { // 현재 위치 정보가 없는 경우 에러 팝업 표시
                    if (window.cordova && cordova.plugins.locationAccuracy) {
                        cordova.plugins.locationAccuracy.request(
                            function (success) {
                                Util.ga.trackEvent("position", "status", "successUserAgreed");
                                //메세지 없이 통과시키고, reload by locationOn.
                                deferred.reject(null);
                            },
                            function (error) {
                                Util.ga.trackEvent("position", "error", error.message);
                                msg = $translate.instant("LOC_PLEASE_TURN_ON_LOCATION_SERVICES_TO_FIND_YOUR_CURRENT_LOCATION");
                                deferred.reject(msg);
                            },
                            cordova.plugins.locationAccuracy.REQUEST_PRIORITY_HIGH_ACCURACY);
                    }
                    else {
                        Util.ga.trackEvent("plugin", "error", "loadLocationAccuracy");
                        msg = $translate.instant("LOC_PLEASE_TURN_ON_LOCATION_SERVICES_TO_FIND_YOUR_CURRENT_LOCATION");
                        deferred.reject(msg);
                    }
                }
                else { // 위치 서비스가 꺼져있으면 저장된 위치로 날씨 업데이트
                    deferred.resolve();
                }
            }
        }

        function updateWeatherData() {
            var deferred = $q.defer();
            var startTime = new Date().getTime();

            WeatherUtil.getWorldWeatherInfo(cityData).then(function (weatherData) {
                var endTime = new Date().getTime();
                Util.ga.trackTiming('weather', endTime - startTime, 'get', 'info');
                Util.ga.trackEvent('weather', 'get', WeatherUtil.getShortenAddress(cityData.address) +
                    '(' + WeatherInfo.getCityIndex() + ')', endTime - startTime);

                var city = WeatherUtil.convertWeatherData(weatherData);
                if (city == undefined) {
                    deferred.reject(strFailToGetWeatherInfo);
                    return;
                }
                WeatherInfo.updateCity(WeatherInfo.getCityIndex(), city);
                applyWeatherData();
                deferred.resolve();
            }, function (error) {
                var endTime = new Date().getTime();
                Util.ga.trackTiming('weather', endTime - startTime, 'error', 'info');
                if (error instanceof Error) {
                    Util.ga.trackEvent('weather', 'error', WeatherUtil.getShortenAddress(cityData.address) +
                        '(' + WeatherInfo.getCityIndex() + ', message:' + error.message + ', code:' + error.code + ')', endTime - startTime);
                } else {
                    Util.ga.trackEvent('weather', 'error', WeatherUtil.getShortenAddress(cityData.address) +
                        '(' + WeatherInfo.getCityIndex() + ', ' + error + ')', endTime - startTime);
                }

                deferred.reject(strFailToGetWeatherInfo);
            });

            return deferred.promise;
        }

        function getTodayPosition() {
            var index = 0;
            var i;

            if ($scope.forecastType === 'short') {
                if ($scope.timeChart == undefined || $scope.timeChart.length <= 1) {
                    console.log("time chart is undefined");
                    return 0;
                }

                if ($scope.timeChart[1].length*colWidth < TABLET_WIDTH) {
                    return 0;
                }

                index = $scope.timeChart[1].currentIndex;

                if (index >= 1) {
                    index = index-1;
                }
                else {
                    index = 0;
                }

                return colWidth*index;
            }
            else if ($scope.forecastType === 'mid') {

                //large tablet
                if (bodyWidth >= TABLET_WIDTH) {
                    return 0;
                }
                var dayTable = $scope.dayChart[0].values;
                if (dayTable == undefined) {
                    console.log("day table is undefined");
                    return 0;
                }
                else {
                    if ($scope.currentWeather && $scope.currentWeather.today &&
                        !($scope.currentWeather.today.index == undefined)) {
                        index = $scope.currentWeather.today.index;
                    }
                    else {
                        for (i = dayTable.length-1; i >= 0; i--) {
                            if (dayTable[i].fromToday == 0) {
                                index = i;
                                break;
                            }
                        }
                    }
                }
                //today is 3th.
                if (index >= 2) {
                    index = index-2;
                }
                else {
                    index = 0;
                }

                return colWidth*index;
            }
            return colWidth*index;
        }

        $scope.onSwipeLeft = function() {
            if (WeatherInfo.getEnabledCityCount() === 1) {
                return;
            }

            WeatherInfo.setNextCityIndex();
            applyWeatherData();
            loadWeatherData();
        };

        $scope.onSwipeRight = function() {
            if (WeatherInfo.getEnabledCityCount() === 1) {
                return;
            }

            WeatherInfo.setPrevCityIndex();
            applyWeatherData();
            loadWeatherData();
        };

        $scope.convertMMDD = function (value) {
            return value.substr(4,2)+'/'+value.substr(6,2);
        };

        function _diffTodayYesterday(current, yesterday) {
            var strSameAsYesterday = "Same as yesterday";
            var strThanYesterday = "%s˚ than yesterday";

            $translate(['LOC_SAME_AS_YESTERDAY', 'LOC_THAN_YESTERDAY']).then(function (translations) {
                strSameAsYesterday = translations.LOC_SAME_AS_YESTERDAY;
                strThanYesterday = translations.LOC_THAN_YESTERDAY;
            }, function (translationIds) {
                console.log("Fail to translate : " + JSON.stringify(translationIds));
            }).finally(function () {
                var str = "";
                if (current.t1h !== undefined && yesterday && yesterday.t1h !== undefined) {
                    var diffTemp = current.t1h - yesterday.t1h;
                    if (Units.getUnit("temperatureUnit") == 'F') {
                       diffTemp = Math.round(diffTemp);
                    }
                    else {
                        diffTemp = parseFloat(diffTemp.toFixed(1));
                    }
                    if (diffTemp == 0) {
                        str += strSameAsYesterday;
                    }
                    else {
                        var tempStr;
                        if (diffTemp > 0) {
                            tempStr = '+' + diffTemp;
                        }
                        else {
                            tempStr = '' + diffTemp;
                        }
                        str += sprintf(strThanYesterday, tempStr);
                    }
                }
                $scope.diffTempStr = str;
            });
        }

        function _convertKmaWsdToStr(windGrade)  {
            switch (windGrade) {
                case 0: return "";
                case 1: return "LOC_LIGHT_WIND";
                case 2: return "LOC_MODERATE_WIND";
                case 3: return "LOC_STRONG_WIND";
                case 4: return "LOC_VERY_STRONG_WIND";
            }
            return "";
        }

        function _makeSummary(current, yesterday) {
            var deferred = $q.defer();
            var translations;
            $translate(['LOC_PM10', 'LOC_PM25', 'LOC_AQI', 'LOC_DISCOMFORT_INDEX', 'LOC_FEELS_LIKE',
                'LOC_UV', 'LOC_FOOD_POISONING', 'LOC_RAINFALL', 'LOC_SNOWFALL', 'LOC_PRECIPITATION'
            ]).then(function (trans) {
                translations = trans;
            }, function (translationIds) {
                translations = translationIds;
            }).finally(function () {
                var str = "";
                var item;
                var itemList = [];
                var diffTemp;
                var tmpGrade;

                if (current.t1h !== undefined && yesterday && yesterday.t1h !== undefined) {
                    diffTemp = Math.round(current.t1h) - Math.round(yesterday.t1h);
                    str = $scope.diffTempStr;
                    item = {str: str, grade: Math.abs(diffTemp)};
                    itemList.push(item);
                }

                if (!(current.weatherType == undefined)) {
                    tmpGrade = 1;
                    if (current.weatherType > 3) {
                        tmpGrade = 3;
                    }
                    item = {str: $translate.instant($scope.getWeatherStr(current)), grade: tmpGrade};
                    itemList.push(item);
                }

                if (current.arpltn) {
                    var arpltn = current.arpltn;
                    var locStr = translations.LOC_AQI;
                    tmpGrade = arpltn.khaiGrade;
                    if (tmpGrade < arpltn.pm25Grade) {
                        locStr = translations.LOC_PM25;
                        tmpGrade = arpltn.pm25Grade;
                    }
                    if (tmpGrade < arpltn.pm10Grade) {
                        locStr = translations.LOC_PM10;
                        tmpGrade = arpltn.pm10Grade;
                    }

                    str = locStr + " " + $translate.instant($scope.getSentimentStr(tmpGrade));
                    item = {str: str, grade: tmpGrade};
                    itemList.push(item);
                }

                if (current.rn1 && current.pty) {
                    switch (current.pty) {
                        case 1:
                            current.ptyStr = translations.LOC_RAINFALL;
                            break;
                        case 2:
                            current.ptyStr = translations.LOC_PRECIPITATION;
                            break;
                        case 3:
                            current.ptyStr = translations.LOC_SNOWFALL;
                            break;
                        default :
                            current.ptyStr = "";
                    }
                    current.rn1Str = current.rn1 + Units.getUnit("precipitationUnit");
                    item = {str: current.ptyStr + " " + current.rn1Str, grade: current.rn1+3};
                    itemList.push(item);
                }

                if (current.dsplsGrade && current.dsplsGrade && current.t1h >= 20) {
                    tmpGrade = current.dsplsGrade;
                    str = translations.LOC_DISCOMFORT_INDEX + " ";
                    str += $translate.instant($scope.getLowHighGradeStr(tmpGrade));
                    item = {str:str, grade: tmpGrade};
                    itemList.push(item);
                }

                if (current.sensorytem && current.sensorytem !== current.t1h) {
                    diffTemp = Math.round(current.sensorytem - current.t1h);
                    str = translations.LOC_FEELS_LIKE + " " + $scope.getTemp(current.sensorytem) +"˚";
                    item = {str :str, grade: Math.abs(diffTemp)};
                    itemList.push(item);
                }

                if (current.ultrvGrade && Number(current.time) < 1800) {
                    tmpGrade = current.ultrvGrade;
                    str = translations.LOC_UV + " ";
                    str += $translate.instant($scope.getLowHighGradeStr(tmpGrade));
                    item = {str: str, grade: tmpGrade+1};
                    itemList.push(item);
                }

                if (current.wsdGrade) {
                    str = $translate.instant(_convertKmaWsdToStr(current.wsdGrade));
                    item = {str:str, grade: current.wsdGrade+1};
                    itemList.push(item);
                }

                if (current.fsnGrade) {
                    var tmpGrade = current.fsnGrade;
                    str = translations.LOC_FOOD_POISONING + " ";
                    str += $translate.instant($scope.getAttentionWarningGradeStr(tmpGrade));
                    item = {str: str, grade: tmpGrade+1};
                    itemList.push(item);
                }

                //감기

                itemList.sort(function (a, b) {
                    if(a.grade > b.grade){
                        return -1;
                    }
                    if(a.grade < b.grade){
                        return 1;
                    }
                    return 0;
                });


                str = itemList[0].str;
                if (itemList.length > 1) {
                    str += ", "+itemList[1].str;
                }

                $rootScope.summary = str;
                deferred.resolve(str);
            });

            return deferred.promise;
        }

        $scope.$on('reloadEvent', function(event, sender) {
            Util.ga.trackEvent('reload', 'sender', sender);

            if ($scope.getConfirmPopup()) {
                Util.ga.trackEvent('reload', 'skip', 'popup', 1);
                return;
            }

            if (sender === 'resume') {
                if (WeatherInfo.canLoadCity(WeatherInfo.getCityIndex()) === false) {
                    Util.ga.trackEvent('reload', 'warn', 'load city', 0);
                    return;
                }
            } else if (sender === 'locationOn') {
                if (cityData.currentPosition === false) {
                    Util.ga.trackEvent('reload', 'skip', 'currentPosition', 0);
                    return;
                }
            }
            else {
                if (cityData == null) {
                   applyWeatherData();
                }
            }

            console.log('called by update weather event');
            WeatherInfo.reloadCity(WeatherInfo.getCityIndex());
            loadWeatherData();
        });

        $scope.headerScroll = function drawShadow() {
            var rect = $ionicScrollDelegate.$getByHandle("body").getScrollPosition();
            if (!(rect == undefined) && rect.hasOwnProperty('top') && rect.top > 0) {
                alphaBar.css('box-shadow','0px 1px 5px 0 rgba(0, 0, 0, 0.26)');
            }
            else {
                alphaBar.css('box-shadow','initial');
            }
        };

        $scope.getTempUnit = function () {
           return Units.getUnit('temperatureUnit');
        };

        $scope.getWindSpdUnit = function () {
            return Units.getUnit('windSpeedUnit');
        };

        $scope.getPressUnit = function () {
            return Units.getUnit('pressureUnit');
        };

        $scope.getDistanceUnit = function () {
            return Units.getUnit('distanceUnit');
        };

        $scope.getPrecipUnit = function (data) {
            //var val = Units.getUnit('precipitationUnit');
            //if (val == 'mm') {
            //    if (data.pty == 3) {
            //       return 'cm';
            //    }
            //    else {
            //        return 'mm';
            //    }
            //}
            return Units.getUnit('precipitationUnit');
        };

        /**
         *
         * @param temp
         * @returns {*}
         */
        $scope.getTemp = function (temp) {
            if (temp == undefined) {
                return '';
            }

            if (Units.getUnit('temperatureUnit') == 'F') {
                return Math.round(temp);
            }
            else {
                return temp;
            }
        };

        init();
    });
