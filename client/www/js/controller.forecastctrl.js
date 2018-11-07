angular.module('controller.forecastctrl', [])
    .controller('ForecastCtrl', function ($scope, WeatherInfo, WeatherUtil, Util, Purchase, $stateParams,
                                          $rootScope, $location, $ionicHistory, $translate, Units, Push, TwStorage) {
        var colWidth;

        $scope.showDetailWeather = false;
        if ($location.path() === '/tab/dailyforecast') {
            $scope.forecastType = "mid"; //mid, detail(aqi)
        }
        else if (clientConfig.package === 'todayAir') {
            $scope.forecastType = "weather"; //mid, detail(aqi)
        }
        else {
            $scope.forecastType = "short"; //mid, detail(aqi)
        }

        if ($scope.forecastType === 'mid' || $scope.forecastType === 'weather' ) {
            $scope.hasDustForecast = function () {
                if ($scope.dailyAqiForecast) {
                    return true;
                }
                if (!Array.isArray($scope.dayChart) || $scope.dayChart[0] == undefined) {
                    Util.ga.trackException(new Error('invalid day chart in has dust forecast'), false);
                    return false;
                }
                for (var i=$scope.dayChart[0].values.length-1; i>=0; i--) {
                    var day = $scope.dayChart[0].values[i];
                    if (day.fromToday == 0) {
                        return !!day.hasOwnProperty('dustForecast');

                    }
                }
                return false;
            };

            $scope.checkDailyDetailWeather = function (day) {
               return !!(day.fromToday == -1 || day.fromToday == 0 || day.fromToday == 1);

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
                if ($scope.currentWeather && $scope.currentWeather.today) {
                    var todayIndex = $scope.currentWeather.today.index;
                    if (todayIndex == undefined) {
                        console.log("today index is undefined, daily list has not today data");
                        return false;
                    }
                    if ( !Array.isArray($scope.dayChart) || 
                        $scope.dayChart[0] == undefined ) 
                    {
                        Util.ga.trackException(new Error('invalid day chart on has property in three days'), false);
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
                }
                return false;
            }
        }

        if ($scope.forecastType === 'short' || $scope.forecastType === 'weather') {
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
             * @param value
             * @param index
             * @returns {number}
             */
            $scope.getDayPosition = function(value, index) {
                if (value.time > 0) {
                    index -= 1;
                }
                return colWidth/2 + index*colWidth;
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

        function init() {
            //identifyUser();
            $ionicHistory.clearHistory();
            $scope.initSize();

            var headerE = angular.element(document.querySelector('[md-page-header]'));
            headerE.css('min-height', $scope.headerHeight+'px');

            colWidth = Math.min($scope.bodyWidth / 7, 60);
            $scope.smallImageSize = colWidth - colWidth * 0.2 * 2;
            
            $scope.expand = TwStorage.get("expandShortChart");
            if ($scope.expand === null) {
                $scope.expand = false; // 기본값은 short-detail-chart가 숨겨진 상태
            }

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
                Util.ga.trackEvent('city', 'error', 'No enabled cities');
                $scope.startPopup();
                return;
            }
            $scope.cityCount = WeatherInfo.getEnabledCityCount();

            applyWeatherData();
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

            console.log("pty="+pty+" rn1="+rn1+" r06="+r06+" s06="+s06+" all="+all);

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
            if (displayItemCount == undefined || displayItemCount == 0) {
                displayItemCount = 3;
            }
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
         * todo: 연산결과를 사용하는 것은 맞는 것으로 보이나, 수정필요.
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

            var res = displayItemCount & 4;
            if (res) {
                val += $scope.smallImageSize;
            }
            else {
                val += $scope.smallImageSize/2;
            }
            res = displayItemCount & 2;
            if (res) {
                //pop - body1
                val += 15;
            }
            res = displayItemCount & 1;
            if (res) {
                //rns - caption
                val += 13;
            }
            return val;
        }

        $scope.getMidTableHeight = getMidTableHeight;

        $scope.showHourlyAqiForecast = function () {
           if ($scope.hourlyAqiForecast && $scope.hourlyAqiForecast.length > 1)  {
               return true;
           }
           return false;
        };

        function applyWeatherData() {
            var dayTable;
            var cityIndex;
            var cityData;
            var shortenAddress = "";

            console.log('apply weather data');

            try {
                cityIndex = WeatherInfo.getCityIndex();
                cityData = WeatherInfo.getCityOfIndex(cityIndex);
                if (cityData === null || 
                    cityData.address === null ||
                    !Array.isArray(cityData.dayChart) ||
                    cityData.dayChart[0] == undefined) 
                {
                    Util.ga.trackException(new Error('fail to getCityOfIndex'), false);
                    return;
                }

                $scope.hasPush = Push.hasPushInfo(cityIndex);
                $scope.currentPosition = cityData.currentPosition;

                shortenAddress = cityData.name || WeatherUtil.getShortenAddress(cityData.address);
                console.log(shortenAddress);

                $scope.address = shortenAddress;

                if (cityData.source) {
                    $scope.source = cityData.source;
                }
                if ($rootScope.settingsInfo.theme == 'photo') {
                    $scope.photo = cityData.photo;
                }

                dayTable = cityData.dayChart[0].values;

                $scope.timeWidth = colWidth * cityData.timeTable.length;
                $scope.dayWidth = (colWidth * dayTable.length < $scope.bodyWidth) ? $scope.bodyWidth : colWidth * dayTable.length;

                $scope.currentWeather = cityData.currentWeather;

                $scope.hourlyAqiForecast = undefined;
                $scope.dailyAqiForecast = undefined;
                $scope.airForecastPubdate = undefined;
                $scope.airForecastSource = undefined;

                var airInfo;
                if (cityData.airInfoList) {
                    airInfo = cityData.airInfoList[0];
                }
                else if (cityData.airInfoList) {
                    airInfo = cityData.airInfo;
                }

                if (airInfo && airInfo.pollutants && airInfo.pollutants.aqi) {

                    $scope.airForecastPubdate = airInfo.forecastPubDate;
                    $scope.airForecastSource = airInfo.forecastSource;
                    var latestAirInfo =  airInfo.last || cityData.currentWeather.arpltn;
                    if (airInfo.pollutants.aqi.hourly) {
                        $scope.hourlyAqiForecast = airInfo.pollutants.aqi.hourly.filter(function (obj) {
                            return obj.date >= latestAirInfo.dataTime;
                        }).slice(0, 4);
                    }
                    if (airInfo.pollutants.aqi.daily) {
                        if ($scope.bodyWidth < 360) {
                            $scope.dailyAqiForecast = airInfo.pollutants.aqi.daily.slice(0,4);
                        }
                        else {
                            $scope.dailyAqiForecast = airInfo.pollutants.aqi.daily;
                        }
                    }
                }

                $scope.updateTime = (function () {
                    try {
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
                                    return tmpDate.substr(0, 4) + "-" + tmpDate.substr(4, 2) + "-" + tmpDate.substr(6, 2) +
                                        " " + cityData.currentWeather.time + ":00";
                                }
                            }
                        }
                    }
                    catch (err) {
                        //#2028 이슈 재 발생시 데이터 확인한다.
                        if (cityData && cityData.currentWeather) {
                            var errMsg = JSON.stringify({
                                stnDateTime: cityData.currentWeather.stnDateTime,
                                date: cityData.currentWeather.date,
                                time: cityData.currentWeather.time
                            });
                            Util.ga.trackEvent('weather', 'error', errMsg);
                        }
                        Util.ga.trackException(err, false);
                        return "";
                    }
                })();

                // To share weather information for apple watch.
                // AppleWatch.setWeatherData(cityData);

                var contentHeight = $scope.headerHeight - 44 - 5; // headerBar height = 44px, bottom padding = 5px
                if (ionic.Platform.isIOS()) {
                    contentHeight -= 20; // statusBar height = 20px
                }
                if ($scope.forecastType === 'short' || $scope.forecastType === 'weather' ) {
                    //var chartShortHeight = getShortTableHeight(cityData.timeChart[1].displayItemCount) + contentHeight;
                    var chartShortHeight = getShortTableHeight(cityData.timeChart[1].displayItemCount) + $scope.bigFontSize * 2;
                    $scope.chartShortHeight = chartShortHeight < 300 ? chartShortHeight : 300;
                    // margin(12px) + image + text(15px) + image + text(15px) + margin(12px)
                    $scope.chartShortDetailHeight = 12 * 2 + $scope.smallImageSize * 2 + 15 * 2;
                }
                if ($scope.forecastType === 'mid' || $scope.forecastType === 'weather' ) {
                    //var chartMidHeight = getMidTableHeight(cityData.dayChart[0].displayItemCount) + contentHeight * 0.7;
                    var chartMidHeight = getMidTableHeight(cityData.dayChart[0].displayItemCount) + $scope.bigFontSize * 1.5;
                    $scope.chartMidHeight = chartMidHeight < 300 ? chartMidHeight : 300;
                }

                $scope.showDetailWeather = true;
                if ($scope.currentWeather.summaryWeather) {
                    $scope.summary = $scope.currentWeather.summaryWeather;
                }
                else {
                    $scope.summary = $scope.currentWeather.summary;
                }
                if ($scope.currentWeather.summaryAir) {
                    $scope.summaryAir = $scope.currentWeather.summaryAir;
                }
                else {
                    delete $scope.summaryAir;
                }

                _diffTodayYesterday($scope.currentWeather, $scope.currentWeather.yesterday);
                if ($scope.forecastType === 'short' || $scope.forecastType === 'weather') {
                    $scope.timeTable = cityData.timeTable;
                    $scope.timeChart = cityData.timeChart;
                }
                if ($scope.forecastType === 'mid' || $scope.forecastType === 'weather') {
                    $scope.dayChart = cityData.dayChart;
                }
            }
            catch(err) {
                Util.ga.trackEvent('weather', 'error', err.toString());
                Util.ga.trackException(err, false);
                return;
            }

            //많은 이슈가 있음. https://github.com/WizardFactory/TodayWeather/issues/1777
            setTimeout(function () {
                var el = document.getElementById('chartShortScroll');
                if (el) {
                    el.scrollLeft = getTodayPosition('short');
                }
                else {
                    //console.error('chart scroll is null');
                }

                el = document.getElementById('chartMidScroll');
                if (el) {
                    el.scrollLeft = getTodayPosition('mid');
                }
                else {
                    //console.error('chart scroll is null');
                }
            }, 300);
        }

        function getTodayPosition(chartType) {
            var index = 0;
            var i;

            if (chartType === 'short') {
                if ($scope.timeChart == undefined || $scope.timeChart.length <= 1) {
                    console.log("time chart is undefined");
                    return 0;
                }

                if ($scope.timeChart[1].length*colWidth < $scope.tabletWidth) {
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
            else if (chartType === 'mid') {
                //large tablet
                if ($scope.bodyWidth >= $scope.tabletWidth) {
                    return 0;
                }
                if (!Array.isArray($scope.dayChart) || 
                    $scope.dayChart[0] == undefined) 
                {
                    Util.ga.trackException(new Error('Invalid day chart on get today position'), false);
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

        /**
         * 타지역 비교시 필요함.
         * @param current
         * @param yesterday
         * @private
         */
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

        $scope.getPrecipUnit = function () {
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

        $scope.switchToLocationSettings = function () {
            Util.ga.trackEvent('action', 'click', 'toggleLocationEnable');

            if (Util.isLocationEnabled() == false && cordova && cordova.plugins.diagnostic) {
                if (ionic.Platform.isAndroid()) {
                    cordova.plugins.diagnostic.switchToLocationSettings();
                }
                else if (ionic.Platform.isIOS()) {
                    cordova.plugins.diagnostic.switchToSettings(function () {
                        console.log("Successfully switched to Settings app");
                    }, function (error) {
                        console.log("The following error occurred: " + error);
                    });
                }
                WeatherInfo.reloadCity(WeatherInfo.getCityIndex());
            }
        };

        $scope.clickExpander = function () {
            $scope.expand = !$scope.expand;
            TwStorage.set("expandShortChart", $scope.expand);
        };

        $scope.$on('applyEvent', function(event, sender) {
            Util.ga.trackEvent('apply', 'sender', sender);
            applyWeatherData();
        });

        $scope.$on('loadWeatherPhotosEvent', function(event, sender) {
            Util.ga.trackEvent('loadWeatherPhotos', 'sender', sender);

            try {
                if ($rootScope.settingsInfo.theme == 'photo') {
                    var cityIndex = WeatherInfo.getCityIndex();
                    var cityData = WeatherInfo.getCityOfIndex(cityIndex);
                    if (cityData === null || cityData.address === null || cityData.dayChart == null) {
                        Util.ga.trackEvent('weather', 'error', 'fail to getCityOfIndex', cityIndex);
                        Util.ga.trackException(new Error('fail to getCityOfIndex'), false);
                        return;
                    }

                    $scope.photo = cityData.photo;
                }
            }
            catch(err) {
                Util.ga.trackEvent('weather', 'error', err.toString());
                Util.ga.trackException(err, false);
                return;
            }
        });

        var strOkay = "OK";
        $translate(['LOC_OK'])
            .then(function (translations) {
                    strOkay = translations.LOC_OK;
                },
                function (translationIds) {
                    console.log("Fail to translate : " + JSON.stringify(translationIds));
                })
            .finally(function () {
                init();
            });
    });
