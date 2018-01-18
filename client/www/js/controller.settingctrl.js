angular.module('controller.settingctrl', [])
    .controller('SettingCtrl', function($scope, $rootScope, Util, Purchase, $ionicHistory, $translate,
                                        $ionicSideMenuDelegate, $ionicPopup, $location, TwStorage, radioList) {

        var menuContent = null;
        var strOkay = "OK";
        var strCancel = "Cancel";
        $translate(['LOC_OK', 'LOC_CANCEL']).then(function (translations) {
            strOkay = translations.LOC_OK;
            strCancel = translations.LOC_CANCEL;
        }, function (translationIds) {
            console.log("Fail to translate : "+JSON.stringify(translationIds));
        });

        function init() {
            if (ionic.Platform.isIOS()) {
                menuContent = angular.element(document.getElementsByClassName('menu-content')[0]);
            }

            var settingsInfo = TwStorage.get("settingsInfo");
            if (settingsInfo === null) {
                settingsInfo = {
                    startupPage: "0", //시간별날씨
                    refreshInterval: "0" //수동
                };
                TwStorage.set("settingsInfo", settingsInfo);
            }

            console.info(settingsInfo);
            $rootScope.settingsInfo = settingsInfo;
        }

        $scope.clickMenu = function (menu) {
            if (ionic.Platform.isIOS()) {
                if (menuContent !== null && menuContent.hasClass('keyboard-up')) {
                    return;
                }
            }

            if (menu === 'sendMail') {
                $ionicSideMenuDelegate.toggleLeft();
                Util.sendMail($translate);
            } else if (menu === 'openMarket') {
                $ionicSideMenuDelegate.toggleLeft();
                Util.openMarket();
            } else if (menu === 'openInfo') {
                openInfo();
            } else {
                $ionicSideMenuDelegate.toggleLeft();
                $location.path('/' + menu);
            }
        };

        /**
         * 설정에 정보 팝업으로, 늦게 로딩되어도 상관없고 호출될 가능성이 적으므로 그냥 현상태 유지.
         */
        var openInfo = function() {
            var strTitle = "TodayWeather";
            var strMsg;
            $translate(['LOC_TODAYWEATHER','LOC_WEATHER_INFORMATION', 'LOC_KOREA_METEOROLOGICAL_ADMINISTRATION', 'LOC_AQI_INFORMATION', 'LOC_KOREA_ENVIRONMENT_CORPORATION', 'LOC_IT_IS_UNAUTHENTICATED_REALTIME_DATA_THERE_MAY_BE_ERRORS']).then(function (translations) {
                strTitle = translations.LOC_TODAYWEATHER;
                strMsg = translations.LOC_WEATHER_INFORMATION + " : "  + translations.LOC_KOREA_METEOROLOGICAL_ADMINISTRATION;
                strMsg += "<br>";
                strMsg += translations.LOC_AQI_INFORMATION + " : " + translations.LOC_KOREA_ENVIRONMENT_CORPORATION;
                strMsg += "<br>";
                strMsg += translations.LOC_IT_IS_UNAUTHENTICATED_REALTIME_DATA_THERE_MAY_BE_ERRORS;
            }, function (translationIds) {
                strTitle = translationIds.LOC_TODAYWEATHER;
                strMsg = translationIds.LOC_WEATHER_INFORMATION + " : "  + translationIds.LOC_KOREA_METEOROLOGICAL_ADMINISTRATION;
                strMsg += "<br>";
                strMsg += translationIds.LOC_AQI_INFORMATION + " : " + translationIds.LOC_KOREA_ENVIRONMENT_CORPORATION;
                strMsg += "<br>";
                strMsg += translationIds.LOC_IT_IS_UNAUTHENTICATED_REALTIME_DATA_THERE_MAY_BE_ERRORS;
            }).finally(function () {
                $rootScope.showAlert(strTitle, strMsg);
            });
        };

        $scope.hasInAppPurchase = function () {
            return Purchase.hasInAppPurchase || Purchase.paidAppUrl.length > 0;
        };

        $scope.showAbout = function () {
            return Util.language.indexOf("ko") != -1;
        };

        $scope.getRegion = function () {
            return Util.region;
        };

        $rootScope.isAndroid = function () {
            return ionic.Platform.isAndroid();
        };

        $rootScope.isMenuOpen = function() {
            var isOpen = $ionicSideMenuDelegate.isOpen();

            if (ionic.Platform.isIOS()) {
                if (window.cordova && window.cordova.plugins && window.cordova.plugins.Keyboard) {
                    if (isOpen) {
                        cordova.plugins.Keyboard.hideKeyboardAccessoryBar(false);
                    } else {
                        cordova.plugins.Keyboard.hideKeyboardAccessoryBar(true);
                    }
                }
            }
            return isOpen;
        };

        $rootScope.showAlert = function(title, msg, callback) {
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

        $rootScope.showConfirm = function(title, template, callback) {
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

        $scope.settingRadio = function (name) {
            $ionicSideMenuDelegate.toggleLeft();

            var title;
            var list;
            if (name === 'startupPage') {
                title = 'LOC_STARTUP_PAGE';
                list = ['0', '1', '2'].map(function (value) {
                    return {label: $scope.getStartupPageValueStr(value), value: value};
                });
            }
            else if (name === 'refreshInterval') {
                title = 'LOC_REFRESH_INTERVAL';
                list = ['0', '30', '60', '180', '360', '720'].map(function (value) {
                    return {label: $scope.getRefreshIntervalValueStr(value), value: value};
                });
            }
            console.info(JSON.stringify({name: name, title: title, value: $rootScope.settingsInfo[name], list: list}));
            radioList.type = name;
            radioList.title = title;
            radioList.setValue($rootScope.settingsInfo[name]);
            radioList.importData(list);
            $location.path('/setting-radio');
        };

        $scope.getStartupPageValueStr = function (value) {
            //console.log('getStartupPageValueStr v='+value);
            switch(value) {
                case '0':
                    return 'LOC_HOURLY_FORECAST';
                case '1':
                    return 'LOC_DAILY_FORECAST';
                case '2':
                    return 'LOC_SAVED_LOCATIONS';
            }
            return 'N/A'
        };

        $scope.getRefreshIntervalValueStr = function (value) {
            //console.log('getRefreshIntervalValueStr v='+value);
            switch(value) {
                case '0':
                    return 'LOC_MANUAL';
                case '30':
                    return 'LOC_30_MINUTES';
                case '60':
                    return 'LOC_1_HOUR';
                case '180':
                    return 'LOC_3_HOURS';
                case '360':
                    return 'LOC_6_HOURS';
                case '720':
                    return 'LOC_12_HOURS';
            }
            return 'N/A'
        };

        init();
    });
