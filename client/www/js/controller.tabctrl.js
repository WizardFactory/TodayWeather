angular.module('controller.tabctrl', [])
    .controller('TabCtrl', function($scope, $ionicPopup, $interval, WeatherInfo, WeatherUtil,
                                     $location, TwAds, $rootScope, Util, $translate) {
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
            TwAds.setLayout(TwAds.enableAds == undefined? TwAds.requestEnable:TwAds.enableAds);
        }

        $scope.doTabSetting = function() {
            if (WeatherInfo.getEnabledCityCount() === 0) {
                $scope.startPopup();
                return;
            }
            $location.path('/tab/setting');
        };

        $scope.doTabForecast = function(forecastType) {
            if (WeatherInfo.getEnabledCityCount() === 0) {
                $scope.startPopup();
                return;
            }
            if ($location.path() === '/tab/forecast' && forecastType === 'forecast') {
                $scope.$broadcast('reloadEvent');
                Util.ga.trackEvent('action', 'tab', 'reload');
            }
            else if ($location.path() === '/tab/dailyforecast' && forecastType === 'dailyforecast') {
                $scope.$broadcast('reloadEvent');
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
            if (!twClientConfig.debug && window.AirBridgePlugin) {
                AirBridgePlugin.goal("weathershare");
            }
        };

        $scope.showAlert = function(title, msg, callback) {
            var alertPopup = $ionicPopup.alert({
                title: title,
                template: msg,
                okText: strOkay
            });
            alertPopup.then(function() {
                console.log("alertPopup close");
                if (callback != undefined) {
                    callback();
                }
            });
        };

        $scope.showConfirm = function(title, template, callback) {
            var confirmPopup = $ionicPopup.confirm({
                title: title,
                template: template,
                okText: strOkay,
                cancelText: strCancel
            });
            confirmPopup.then(function (res) {
                if (res) {
                    console.log("You are sure");
                } else {
                    console.log("You are not sure");
                }
                callback(res);
            });
        };

        $scope.contentHeight = function() {
            if ($rootScope.contentBottom === undefined) {
                $rootScope.contentBottom = 0;
            }
            if ($rootScope.tabsTop === undefined) {
                $rootScope.tabsTop = 0;
            }
            return $rootScope.contentBottom - $rootScope.tabsTop;
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
                            $scope.$broadcast('reloadEvent');
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
         * @param callback
         */
        $scope.showRetryConfirm = function showRetryConfirm(title, template, ctrl) {
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
                if (ctrl == 'search') {
                    buttons.push({
                        text: strClose,
                        onTap: function () {
                            return 'close';
                        }
                    });
                }

                if (gLocationAuthorizationStatus == cordova.plugins.diagnostic.permissionStatus.DENIED_ALWAYS) {
                    template += '<br>';
                    template += strOpensTheAppInfoPage;

                    if (ctrl == 'forecast') {
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
                    if (ctrl == 'forecast') {
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
                else {
                    if (ctrl == 'forecast') {
                        buttons.push({
                            text: strSearch,
                            onTap: function () {
                                return 'search';
                            }
                        });
                    }

                    buttons.push({
                        text: strSetting,
                        onTap: function () {
                            return 'locationSettings';
                        }
                    });

                    buttons.push({
                        text: strOkay,
                        type: 'button-positive',
                        onTap: function () {
                            return 'retry';
                        }
                    });

                    Util.ga.trackEvent('window', 'show', 'retryPopup');
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
                                if (ctrl == 'search') {
                                    $scope.$broadcast('searchCurrentPositionEvent');
                                }
                                else {
                                    $scope.$broadcast('reloadEvent');
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
                                cordova.plugins.diagnostic.switchToLocationSettings(function () {
                                    console.log("Successfully switched to location settings app");
                                }, function (error) {
                                    console.log("The following error occurred: " + error);
                                });
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

        init();
    });
