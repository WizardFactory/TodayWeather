angular.module('controller.tabctrl', [])
    .controller('TabCtrl', function($scope, $ionicPopup, $interval, WeatherInfo, WeatherUtil,
                                     $location, TwAds, $rootScope, Util, $translate, TwStorage, $sce, Units,
                                    $ionicLoading, $q) {
        var currentTime;
        var strError = "Error";
        var strAddLocation = "Add locations";
        var strOkay = "OK";
        var strCancel = "Cancel";
        $translate(['LOC_ERROR', 'LOC_ADD_LOCATIONS', 'LOC_OK', 'LOC_CANCEL']).then(function (translations) {
            strError = translations.LOC_ERROR;
            strAddLocation = translations.LOC_ADD_LOCATIONS;
            strOkay = translations.LOC_OK;
            strCancel = translations.LOC_CANCEL;
        }, function (translationIds) {
            console.log("Fail to translate : "+JSON.stringify(translationIds));
        });

        $scope.data = { 'autoSearch': false };

        function init() {
            if (window.cordova && window.cordova.plugins && window.cordova.plugins.diagnostic) {
                cordova.plugins.diagnostic.isLocationEnabled(function (enabled) {
                    console.log("TabCtrl location setting is " + (enabled ? "enabled" : "disabled"));
                    $scope.data.autoSearch = enabled;
                }, function (error) {
                    console.log("The following error occurred: "+error);
                });
            }

            currentTime = new Date();
            //$scope.currentTimeString = WeatherUtil.convertTimeString(currentTime); // 10월 8일(수) 12:23 AM
            //$interval(function() {
            //    var newDate = new Date();
            //    if(newDate.getMinutes() != currentTime.getMinutes()) {
            //        currentTime = newDate;
            //        $scope.currentTimeString = WeatherUtil.convertTimeString(currentTime);
            //    }
            //}, 1000);

            TwAds.init();
        }

        var lastClickTime = 0;

        $scope.doTabForecast = function(forecastType) {
            var clickTime = new Date().getTime();
            var gap = clickTime - lastClickTime;

            console.info('do tab forecast gap='+gap);
            lastClickTime = clickTime;

            if (WeatherInfo.getEnabledCityCount() === 0) {
                $scope.startPopup();
                return;
            }
            if ($location.path() === '/tab/forecast' && forecastType === 'forecast') {
                //iPhone6 debuging mode에서 6xx 나옴.
                if (gap <= 700) {
                    console.warn('skip reload event on tab!!');
                }
                else {
                    $scope.$broadcast('reloadEvent', 'tab');
                    Util.ga.trackEvent('action', 'tab', 'reload');
                }
            }
            else if ($location.path() === '/tab/dailyforecast' && forecastType === 'dailyforecast') {
                if (gap <= 700) {
                    console.warn('skip reload event on tab!!');
                }
                else {
                    $scope.$broadcast('reloadEvent', 'tab');
                    Util.ga.trackEvent('action', 'tab', 'reload');
                }
            }
            else if ($location.path() === '/tab/air' && forecastType === 'air') {
                if (gap <= 700) {
                    console.warn('skip reload event on tab!!');
                }
                else {
                    $scope.$broadcast('reloadEvent', 'tab');
                    Util.ga.trackEvent('action', 'tab', 'reload');
                }
            }
            else {
                if (window.cordova && window.cordova.plugins && window.cordova.plugins.Keyboard) {
                    if (cordova.plugins.Keyboard.isVisible) {
                        cordova.plugins.Keyboard.close();
                        setTimeout(function(){
                            if (forecastType === 'forecast') {
                                $location.path('/tab/forecast');
                            }
                            else if (forecastType === 'dailyforecast') {
                                $location.path('/tab/dailyforecast');
                            }
                            else if (forecastType === 'air') {
                                $location.path('/tab/air');
                            }
                            else {
                                $location.path('/tab/forecast');
                            }
                        }, 100);
                        return;
                    }
                }

                if (forecastType === 'forecast') {
                    $location.path('/tab/forecast');
                }
                else if (forecastType === 'dailyforecast') {
                    $location.path('/tab/dailyforecast');
                }
                else if (forecastType === 'air') {
                    $location.path('/tab/air');
                }
                else {
                    Util.ga.trackEvent('action', 'error', 'unknownForecastType');
                    $location.path('/tab/forecast');
                }
            }
        };

        $scope.doTabShare = function() {
            if (!(window.plugins && window.plugins.socialsharing)) {
                console.log('plugins socialsharing is undefined');
                return;
            }
            var cityData = WeatherInfo.getCityOfIndex(WeatherInfo.getCityIndex());
            if (cityData == undefined || cityData.location == undefined) {
                console.log('Fail to load city');
                $scope.startPopup();
                return;
            }

            var cityName;
            if (cityData.name) {
                cityName = cityData.name;
            }
            else {
                cityName = WeatherUtil.getShortenAddress(cityData.address);
            }
            var t1h = cityData.currentWeather.t1h;
            var emoji = WeatherUtil.getWeatherEmoji(cityData.currentWeather.skyIcon);
            var tmx;
            var tmn;
            var summary = $rootScope.summary;
            var shareUrl = 'http://abr.ge/mxld';
            if (cityData.currentWeather.today) {
                tmx = cityData.currentWeather.today.tmx;
                tmn = cityData.currentWeather.today.tmn;
            }

            var message = '';
            $translate(['LOC_CURRENT', 'LOC_HIGHEST', 'LOC_LOWEST', 'LOC_TODAYWEATHER']).then(function (translations) {
                message += cityName+'\n';
                message += translations.LOC_CURRENT+' '+t1h+'˚ ';
                message += emoji+'\n';
                message += translations.LOC_HIGHEST+' '+tmx+'˚, '+translations.LOC_LOWEST+' '+tmn+'˚\n';
                message += summary+'\n\n';
                message += translations.LOC_TODAYWEATHER + ' ' + shareUrl;
            }, function (translationIds) {
                message += cityName+'\n';
                message += translationIds.LOC_CURRENT+' '+t1h+'˚ ';
                message += emoji+'\n';
                message += translationIds.LOC_HIGHEST+' '+tmx+'˚, '+translationIds.LOC_LOWEST+' '+tmn+'˚\n';
                message += summary+'\n\n';
                message += translationIds.LOC_TODAYWEATHER + ' ' + shareUrl;
            }).finally(function () {
                window.plugins.socialsharing.share(message, null, null, null);
            });

            Util.ga.trackEvent('action', 'tab', 'share');
        };

        /**
         * getEnableCount가 0이면 호출되는데, #2018 이슈에서 enable city가 있는데 불리는 경우가 있어 보임
         * 기본값은 즐겨찾기 이동으로 변경하여, 사용자가 잘 못 클릭해도 현재위치가 추가되지 않게 방지
         */
        $scope.startPopup = function startPopup() {
            Util.ga.trackEvent('show', 'popup', 'startPopup');
            var strOkay;
            var strTodayWeather;
            var strUseYourCurrentLocation;
            var strFindLocationByName;

            $translate(['LOC_TODAYWEATHER', 'LOC_OK',
                'LOC_USE_YOUR_CURRENT_LOCATION', 'LOC_FIND_LOCATION_BY_NAME']).then(function (translations) {
                strTodayWeather = translations.LOC_TODAYWEATHER;
                strOkay = translations.LOC_OK;
                strUseYourCurrentLocation = translations.LOC_USE_YOUR_CURRENT_LOCATION;
                strFindLocationByName = translations.LOC_FIND_LOCATION_BY_NAME;
            }, function (translationIds) {
                console.log("Fail to translate : " + JSON.stringify(translationIds));
            }).finally(function () {
                var popup = $ionicPopup.show({
                    template: '<ion-list>' +
                    '<ion-radio ng-model="data.autoSearch" ng-value="false">'+strUseYourCurrentLocation+'</ion-radio>' +
                    '<ion-radio ng-model="data.autoSearch" ng-value="true">'+strFindLocationByName+'</ion-radio>' +
                    '</ion-list>',
                    title: strTodayWeather,
                    scope: $scope,
                    cssClass: 'ionic_popup',
                    buttons: [
                        {
                            text: strOkay,
                            type: 'button-positive',
                            onTap: function() {
                                return $scope.data.autoSearch;
                            }
                        }
                    ]
                });

                popup.then(function(res) {
                    if (res === true) { // autoSearch
                        Util.ga.trackEvent('action', 'click', 'auto search');
                        WeatherInfo.disableCity(false);
                        if ($location.path() === '/tab/forecast') {
                            $scope.$broadcast('reloadEvent', 'startPopup');
                        }
                        else {
                            $location.path('/tab/forecast');
                        }
                    } else {
                        Util.ga.trackEvent('action', 'click', 'city search');

                        if ($location.path() === '/tab/search') {
                            $scope.$broadcast('setInputFocus');
                        }
                        else {
                            $location.path('/tab/search');
                        }
                    }
                });
            });
        };

        var gLocationAuthorizationStatus;
        $scope.setLocationAuthorizationStatus = function (status) {
            gLocationAuthorizationStatus = status;
        };

        var confirmPopup;
        $scope.getConfirmPopup = function () {
           return confirmPopup;
        };

        /**
         * android 6.0이상에서 처음 현재위치 사용시에, android 현재위치 접근에 대한 popup때문에 앱 pause->resume이 됨.
         * 그래서 init와 reloadevent가 둘다 오게 되는데 retry confirm이 두개 뜨지 않게 한개 있는 경우 닫았다가 새롭게 열게 함.
         * @param title
         * @param template
         * @param type forecast, search, weather
         */
        $scope.showRetryConfirm = function showRetryConfirm(title, template, type) {
            Util.ga.trackEvent('show', 'popup', 'retryConfirm');
            if (confirmPopup) {
                confirmPopup.close();
            }

            var strClose;
            var strSearch;
            var strSetting;
            var strOpensTheAppInfoPage;

            $translate(['LOC_CLOSE', 'LOC_SEARCH', 'LOC_SETTING',
                'LOC_OPENS_THE_APP_INFO_PAGE']).then(function (translations) {
                strClose = translations.LOC_CLOSE;
                strSearch = translations.LOC_SEARCH;
                strSetting = translations.LOC_SETTING;
                strOpensTheAppInfoPage = translations.LOC_OPENS_THE_APP_INFO_PAGE;
            }, function (translationIds) {
                console.log("Fail to translate : " + JSON.stringify(translationIds));
                Util.ga.trackEvent("translate", "error", "showRetryConfirm");
            }).finally(function () {
                var buttons = [];
                if (type == 'search') {
                    buttons.push({
                        text: strClose,
                        onTap: function () {
                            return 'close';
                        }
                    });
                }

                //fail to get weather data
                if (type == 'weather') {
                    buttons.push({
                        text: strClose,
                        onTap: function () {
                            return 'close';
                        }
                    });

                    buttons.push({
                        text: strOkay,
                        type: 'button-positive',
                        onTap: function () {
                            return 'retry';
                        }
                    });

                    Util.ga.trackEvent('window', 'show', 'getWeatherPopup');
                }
                else if (ionic.Platform.isAndroid() &&
                    gLocationAuthorizationStatus == cordova.plugins.diagnostic.permissionStatus.DENIED_ALWAYS) {
                    template += '<br>';
                    template += strOpensTheAppInfoPage;

                    if (type == 'forecast') {
                        buttons.push({
                            text: strSearch,
                            onTap: function () {
                                return 'search';
                            }
                        });
                    }

                    buttons.push({
                        text: strSetting,
                        type: 'button-positive',
                        onTap: function () {
                            return 'settings';
                        }
                    });
                    Util.ga.trackEvent('window', 'show', 'deniedAlwaysPopup');
                }
                else if (gLocationAuthorizationStatus == cordova.plugins.diagnostic.permissionStatus.DENIED) {
                    if (type == 'forecast') {
                        buttons.push({
                            text: strSearch,
                            onTap: function () {
                                return 'search';
                            }
                        });
                    }

                    buttons.push({
                        text: strOkay,
                        type: 'button-positive',
                        onTap: function () {
                            return 'retry';
                        }
                    });
                    Util.ga.trackEvent('window', 'show', 'deniedPopup');
                }
                else if (Util.isLocationEnabled() == false) {
                    if (type == 'forecast') {
                        buttons.push({
                            text: strSearch,
                            onTap: function () {
                                return 'search';
                            }
                        });
                    }

                    if (ionic.Platform.isAndroid()) {
                        buttons.push({
                            text: strSetting,
                            onTap: function () {
                                return 'locationSettings';
                            }
                        });
                    }
                    else if (ionic.Platform.isIOS()) {
                        buttons.push({
                            text: strSetting,
                            type: 'button-positive',
                            onTap: function () {
                                return 'settings';
                            }
                        });

                    }

                    buttons.push({
                        text: strOkay,
                        type: 'button-positive',
                        onTap: function () {
                            return 'retry';
                        }
                    });

                    Util.ga.trackEvent('window', 'show', 'locationDisabledPopup');
                }
                else {
                    //fail to get address information
                    if (type == 'forecast') {
                        buttons.push({
                            text: strClose,
                            onTap: function () {
                                return 'close';
                            }
                        });
                    }

                    buttons.push({
                        text: strOkay,
                        type: 'button-positive',
                        onTap: function () {
                            return 'retry';
                        }
                    });

                    Util.ga.trackEvent('window', 'show', 'getAddressPopup');
                }

                confirmPopup = $ionicPopup.show({
                    title: title,
                    template: template,
                    buttons: buttons
                });

                confirmPopup
                    .then(function (res) {
                        if (res == 'retry') {
                            Util.ga.trackEvent('action', 'click', 'reloadEvent');
                            setTimeout(function () {
                                if (type == 'search') {
                                    $scope.$broadcast('searchCurrentPositionEvent');
                                }
                                else {
                                    $scope.$broadcast('reloadEvent', 'retryPopup');
                                }
                            }, 0);
                        }
                        else if (res == 'search') {
                            Util.ga.trackEvent('action', 'click', 'moveSearch');
                            WeatherInfo.disableCity(true);
                            $location.path('/tab/search');
                        }
                        else if (res == 'settings') {
                            Util.ga.trackEvent('action', 'click', 'settings');
                            setTimeout(function () {
                                cordova.plugins.diagnostic.switchToSettings(function () {
                                    console.log("Successfully switched to Settings app");
                                }, function (error) {
                                    console.log("The following error occurred: " + error);
                                });
                            }, 0);
                        }
                        else if (res == 'locationSettings') {
                            setTimeout(function () {
                                cordova.plugins.diagnostic.switchToLocationSettings();
                            }, 0);
                        }
                        else {
                            Util.ga.trackEvent('action', 'click', 'close');
                        }
                    })
                    .finally(function () {
                        console.log('called finally');
                        confirmPopup = undefined;
                    });
            });
        };

        $scope.$on('showUpdateInfo', function(event) {
            Util.ga.trackEvent('window', 'show', 'updateInfoPopup');
            var strFeedback = "";
            var strRate = "";
            var strClose = "";
            var strDisable = "";
            var lang;
            var updateInfo;
            var msg = '';
            var version = '';

            try {
                if (!Array.isArray(window.updateInfo)) {
                    throw new Error("update info is not array");
                }

                lang = Util.language.split('-')[0];

                updateInfo = window.updateInfo.find(function (value) {
                    if (value.lang === lang) {
                        return true;
                    }
                    return false;
                });

                if (updateInfo == undefined) {
                    //en
                    updateInfo = window.updateInfo[0];
                }

                console.info(updateInfo);

                if (updateInfo) {
                    if (ionic.Platform.isAndroid())  {
                        updateInfo.android.forEach(function (data) {
                            msg += data+'<br>';
                        });
                    }
                    if (ionic.Platform.isIOS()) {
                        updateInfo.ios.forEach(function (data) {
                            msg += data+'<br>';
                        });
                    }
                    //last array has greeting msg
                    updateInfo.all.forEach(function (data) {
                        msg += data+'<br>';
                    });
                }

                version = 'v'+Util.version;
            }
            catch (err) {
                Util.ga.trackException(err, false);
                return;
            }

            function setDisableUpdateInfo() {
                Util.ga.trackEvent('action', 'popup', 'disableUpdateInfo');
                TwStorage.set('disableUpdateInfo', true);
            }

            Util.ga.trackEvent('app', 'update', 'showUpdateInfoPopup');

            $translate(['LOC_FEEDBACK', 'LOC_REVIEW', 'LOC_CLOSE', 'LOC_DISABLE_UPDATE_POPUP'])
                .then(function (translations) {
                        strFeedback = translations.LOC_FEEDBACK;
                        strRate = translations.LOC_REVIEW;
                        strClose = translations.LOC_CLOSE;
                        strDisable = translations.LOC_DISABLE_UPDATE_POPUP;
                    },
                    function (translationIds) {
                        console.log("Fail to translate : "+JSON.stringify(translationIds));
                    })
                .finally(function () {

                    msg += '<div style="margin: 0 2px">' +
                        '<input type="checkbox" ng-model="data.disable">'+
                        strDisable +
                        '</div>';

                    $ionicPopup.show({
                        template: msg,
                        title: version,
                        cssClass: 'update_information_popup',
                        scope: $scope,
                        buttons: [
                            {
                                text: strFeedback,
                                onTap: function() {
                                    if ($scope.data.disable) {
                                        setDisableUpdateInfo();
                                    }
                                    Util.sendMail($translate);
                                }
                            },
                            {
                                text: strRate,
                                onTap: function() {
                                    if ($scope.data.disable) {
                                        setDisableUpdateInfo();
                                    }
                                    Util.openMarket();
                                }
                            },
                            {
                                text: strClose,
                                onTap: function() {
                                    if ($scope.data.disable) {
                                        setDisableUpdateInfo();
                                    }
                                }
                            }
                        ]
                    });
                });
        });

        /**
         * sentiment_satisfied, sentiment_neutral, ...
         * @param grade
         * @returns {*}
         */
        $scope.getSentimentIcon = function (grade) {
            var str = '&#xE814;';
            switch (grade) {
                case 1:
                    str = '&#xE813;';
                    break;
                case 2:
                    str = '&#xE812;';
                    break;
                case 3:
                    str = '&#xE811;';
                    break;
                case 4:
                    str = '&#xE814;';
                    break;
                case 5:
                    str = '&#xE814;';
                    break;
                default:
                    console.log('Fail to find grade='+grade);
            }
            return $sce.trustAsHtml(str);
        };

        $scope.dayToFullString = function(day) {
            var dayFullStr = ['LOC_SUNDAY', 'LOC_MONDAY', 'LOC_TUESDAY', 'LOC_WEDNESDAY', 'LOC_THURSDAY',
                'LOC_FRIDAY', 'LOC_SATURDAY'];
            return dayFullStr[day];
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

            //console.error("Fail to get day string day=" + day);
            //return "";
        };

        $scope.dayToString = function(day) {
            var dayStr = ['LOC_SUN', 'LOC_MON', 'LOC_TUE', 'LOC_WED', 'LOC_THU', 'LOC_FRI', 'LOC_SAT'];
            return dayStr[day];
        };

        $scope.convertMMDD = function (value) {
            if (typeof value == 'string') {
                return value.substr(4,2)+'/'+value.substr(6,2);
            }
            return value;
        };

        $scope.getCurrentAirUnitStr = function () {
            return Units.getAirUnitStr(Units.getUnit('airUnit'));
        };

        $scope.getForecastAirUnitStr = function () {
            return Units.getAirUnitStr('airkorea');
        };

        $scope.onSwipeLeft = function() {
            if (WeatherInfo.getEnabledCityCount() === 1) {
                return;
            }

            Util.ga.trackEvent('action', 'click', 'swipeleft');

            WeatherInfo.setNextCityIndex();
            loadWeatherData();
        };

        $scope.onSwipeRight = function() {
            if (WeatherInfo.getEnabledCityCount() === 1) {
                return;
            }

            Util.ga.trackEvent('action', 'click', 'swiperight');

            WeatherInfo.setPrevCityIndex();
            loadWeatherData();
        };

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
                var cityData = WeatherInfo.getCityOfIndex(WeatherInfo.getCityIndex());
                if (cityData && cityData.currentPosition === false) {
                    Util.ga.trackEvent('reload', 'skip', 'currentPosition', 0);
                    return;
                }
            } else if (sender === 'setRefreshInterval') {
                setRefreshTimer();
                return;
            }

            console.log('called by update weather event by '+sender);
            WeatherInfo.reloadCity(WeatherInfo.getCityIndex());
            loadWeatherData();
        });

        function loadWeatherData() {
            setRefreshTimer();
            $scope.$broadcast('applyEvent', 'loadWeatherData');

            var cityIndex = WeatherInfo.getCityIndex();
            if (WeatherInfo.canLoadCity(cityIndex) === true) {

                var weatherInfo = WeatherInfo.getCityOfIndex(cityIndex);
                if (!weatherInfo) {
                    Util.ga.trackEvent('weather', 'error', 'failToGetCityIndex', cityIndex);
                    return;
                }

                showLoadingIndicator();
                updateWeatherData(weatherInfo).then(function () {
                    $scope.$broadcast('applyEvent', 'updateWeatherData');
                    //data cache된 경우에라도, Loading했다는 느낌을 주기 위해서 최소 지연 시간 설정
                    setTimeout(function () {
                        console.info('hide loading indicator after update wData');
                        hideLoadingIndicator();
                    }, 500);
                }, function (msg) {
                    hideLoadingIndicator();
                    $scope.showRetryConfirm(strError, msg, 'weather');
                });

                if (weatherInfo.currentPosition === true) {
                    /**
                     * one more update when finished position is updated
                     */
                    updateCurrentPosition(weatherInfo).then(function(geoInfo) {
                        if (geoInfo) {
                            console.log("current position is updated !!");
                            try {
                                var cityInfo = WeatherInfo.getCityOfIndex(0);
                                if (cityInfo)  {
                                    var savedLocation = cityInfo.location;
                                    //처음 추가된 경우 savedLocation이 없는 경우가 있음(위젯에서 들어오는 경우)
                                    if (savedLocation) {
                                        if (geoInfo.location.lat === savedLocation.lat &&
                                            geoInfo.location.long === savedLocation.long) {
                                            console.log("already updated this location");
                                            return;
                                        }
                                        else {
                                            //current city index가 변경되어도 받아둔 데이터는 메모리에 저장해둠.
                                            savedLocation.lat = geoInfo.location.lat;
                                            savedLocation.long = geoInfo.location.long;
                                        }
                                    }
                                }

                                if (WeatherInfo.getCityIndex() != 0) {
                                    console.log("already changed to new location");
                                    return;
                                }

                            }
                            catch(err) {
                                Util.ga.trackEvent('position', 'error', 'failToParseCurrentPosition');
                                Util.ga.trackException(err, false);
                                return;
                            }

                            updateWeatherData(geoInfo).then(function () {
                                $scope.$broadcast('applyEvent', 'updateCurrentPosition');
                            }, function (msg) {
                                console.log(msg);
                            });
                        }
                        else {
                            Util.ga.trackEvent('position', 'error', 'failToGetCurrentPosition');
                        }
                    }, function(msg) {
                        if (msg) {
                            $scope.showRetryConfirm(strError, msg, 'forecast');
                        }
                        else {
                            //pass
                        }
                    });
                }

                return;
            }
            else {
                console.log("Already updated weather data so just apply");
            }
        }

        // retry popup이 없는 경우 항상 undefined여야 함.
        var isLoadingIndicator = false;

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

        var refreshTimer = null;

        function setRefreshTimer() {
            clearTimeout(refreshTimer);

            var settingsInfo = TwStorage.get("settingsInfo");
            if (settingsInfo != null && settingsInfo.refreshInterval !== "0") {
                refreshTimer = setTimeout(function () {
                    $scope.$broadcast('reloadEvent', 'refreshTimer');
                }, parseInt(settingsInfo.refreshInterval)*60*1000);
            }
        }

        function updateCurrentPosition(cityInfo) {
            var deferred = $q.defer();

            if (cityInfo.currentPosition === false) {
                deferred.resolve();
                return deferred.promise;
            }

            if (window.cordova && window.cordova.plugins && window.cordova.plugins.diagnostic) {

                if (ionic.Platform.isIOS()) {
                    if (Util.isLocationEnabled()) {
                        _getCurrentPosition(deferred, cityInfo, true, true);
                    } else if (Util.locationStatus === cordova.plugins.diagnostic.permissionStatus.NOT_REQUESTED) {
                        // location service가 off 상태로 시작한 경우에는 denied로 설정되어 있음. on 상태인 경우에 not_requested로 들어옴
                        _getCurrentPosition(deferred, cityInfo, true, undefined);
                    } else {
                        _getCurrentPosition(deferred, cityInfo, false, undefined);
                    }
                }
                else if (ionic.Platform.isAndroid()) {
                    if (Util.isLocationEnabled()) {
                        cordova.plugins.diagnostic.getLocationAuthorizationStatus(function (status) {
                            console.log('status='+status);
                            $scope.setLocationAuthorizationStatus(status);
                            if (status === cordova.plugins.diagnostic.permissionStatus.GRANTED) {
                                _getCurrentPosition(deferred, cityInfo, true, true);
                            } else if (status === cordova.plugins.diagnostic.permissionStatus.DENIED_ALWAYS) {
                                _getCurrentPosition(deferred, cityInfo, true, false);
                            } else if (status === cordova.plugins.diagnostic.permissionStatus.NOT_REQUESTED
                                || status === cordova.plugins.diagnostic.permissionStatus.DENIED) {
                                _getCurrentPosition(deferred, cityInfo, true, undefined);
                            }
                        }, function (error) {
                            console.error("Error getting for location authorization status: " + error);
                        });
                    } else {
                        _getCurrentPosition(deferred, cityInfo, false, undefined);
                    }
                }
            }
            else {
                _getCurrentPosition(deferred, cityInfo, true, true);
            }

            return deferred.promise;
        }

        function _getCurrentPosition(deferred, cityInfo, isLocationEnabled, isLocationAuthorized) {
            var msg;
            Util.ga.trackEvent('position', 'status', 'enabled', isLocationEnabled?1:0);
            Util.ga.trackEvent('position', 'status', 'authorized', isLocationAuthorized?1:0);
            if (isLocationEnabled === true) {
                if (isLocationAuthorized === true) {
                    WeatherUtil.getCurrentPosition().then(function (data) {
                        Util.ga.trackEvent('position', 'done', data.provider);

                        var location = WeatherUtil.geolocationNormalize({lat: data.coords.latitude, long: data.coords.longitude});
                        deferred.resolve({location:location});
                    }, function (errMsg) {
                        if (errMsg === 'alreadyCalled') {
                            Util.ga.trackEvent('position', 'warning', 'already called');
                            return deferred.reject();
                        }

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
                if (cityInfo.address === null && cityInfo.location === null) { // 현재 위치 정보가 없는 경우 에러 팝업 표시
                    if (window.cordova && cordova.plugins.locationAccuracy) {
                        cordova.plugins.locationAccuracy.request(
                            function (success) {
                                console.log(success);
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

        function updateWeatherData(geoInfo) {
            var deferred = $q.defer();
            var startTime = new Date().getTime();
            var logLabel = geoInfo.address || geoInfo.name;

            if (!logLabel) {
               logLabel = JSON.stringify(geoInfo.location);
            }

            WeatherUtil.getWeatherByGeoInfo(geoInfo).then(function (weatherData) {
                var endTime = new Date().getTime();
                Util.ga.trackTiming('weather', endTime - startTime, 'get', 'info');
                Util.ga.trackEvent('weather', 'get', logLabel +
                    '(' + WeatherInfo.getCityIndex() + ')', endTime - startTime);

                var city = WeatherUtil.convertWeatherData(weatherData);
                if (city == undefined) {
                    deferred.reject(strFailToGetWeatherInfo);
                    return;
                }
                WeatherInfo.updateCity(WeatherInfo.getCityIndex(), city);
                deferred.resolve();
            }, function (error) {
                var endTime = new Date().getTime();
                Util.ga.trackTiming('weather', endTime - startTime, 'error', 'info');
                if (error instanceof Error) {
                    Util.ga.trackEvent('weather', 'error', logLabel +
                        '(' + WeatherInfo.getCityIndex() + ', message:' + error.message + ', code:' + error.code + ')', endTime - startTime);
                } else {
                    Util.ga.trackEvent('weather', 'error', logLabel +
                        '(' + WeatherInfo.getCityIndex() + ', ' + error + ')', endTime - startTime);
                }

                deferred.reject(strFailToGetWeatherInfo);
            });

            return deferred.promise;
        }

        $scope.clickEvent = function (item) {
            if (item === 'units') {
                $location.path('/units');
            }
        };

        $scope.$on('$destroy',function(){
            clearTimeout(refreshTimer);
        });

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
            'LOC_FAIL_TO_GET_WEATHER_INFO', 'LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI'])
            .then(function (translations) {
                    strError = translations.LOC_ERROR;
                    strAddLocation = translations.LOC_ADD_LOCATIONS;
                    strClose = translations.LOC_CLOSE;
                    strRetry = translations.LOC_RETRY;
                    strFailToGetAddressInfo = translations.LOC_FAIL_TO_GET_LOCATION_INFORMATION;
                    strFailToGetCurrentPosition = translations.LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION;
                    strFailToGetWeatherInfo = translations.LOC_FAIL_TO_GET_WEATHER_INFO;
                    strPleaseTurnOnLocationWiFi = translations.LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI;
                    $scope.strHour = translations.LOC_HOUR;
                },
                function (translationIds) {
                    console.log("Fail to translate : " + JSON.stringify(translationIds));
                })
            .finally(function () {
                init();
            });
    });
