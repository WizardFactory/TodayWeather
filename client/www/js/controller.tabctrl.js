angular.module('controller.tabctrl', [])
    .controller('TabCtrl', function($scope, $ionicPopup, $interval, WeatherInfo, WeatherUtil,
                                     $location, TwAds, $rootScope, Util, $translate, TwStorage) {
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
                }
                Util.ga.trackEvent('action', 'tab', 'reload');
            }
            else {
                if (window.cordova && window.cordova.plugins && window.cordova.plugins.Keyboard) {
                    if (cordova.plugins.Keyboard.isVisible) {
                        cordova.plugins.Keyboard.close();
                        setTimeout(function(){
                            if (forecastType === 'forecast') {
                                $location.path('/tab/forecast');
                            }
                            else {
                                $location.path('/tab/dailyforecast');
                            }
                        }, 100);
                        return;
                    }
                }

                if (forecastType === 'forecast') {
                    $location.path('/tab/forecast');
                }
                else {
                    $location.path('/tab/dailyforecast');
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

        $scope.startPopup = function startPopup() {
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
                    '<ion-radio ng-model="data.autoSearch" ng-value="true">'+strUseYourCurrentLocation+'</ion-radio>' +
                    '<ion-radio ng-model="data.autoSearch" ng-value="false">'+strFindLocationByName+'</ion-radio>' +
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

        init();
    });
