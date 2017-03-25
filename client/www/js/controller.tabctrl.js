angular.module('controller.tabctrl', [])
    .controller('TabCtrl', function($scope, $ionicPlatform, $ionicPopup, $interval, WeatherInfo, WeatherUtil,
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

        function init() {
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

        $scope.doTabForecast = function(forecastType) {
            if (WeatherInfo.getEnabledCityCount() === 0) {
                $scope.showAlert(strError, strAddLocation);
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
                $scope.showAlert(strError, strAddLocation);
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

        init();
    });
