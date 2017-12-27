angular.module('controller.settingctrl', [])
    .controller('SettingCtrl', function($scope, $rootScope, Util, Purchase, $ionicHistory, $translate,
                                        $ionicSideMenuDelegate, $ionicPopup, $location, TwStorage) {

        var menuContent = null;
        var settingsInfo = null;
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

            settingsInfo = TwStorage.get("settingsInfo");
            if (settingsInfo === null) {
                settingsInfo = {
                    startupPage: "0", //시간별날씨
                    refreshInterval: "0" //수동
                };
                TwStorage.set("settingsInfo", settingsInfo);
            }
            $scope.startupPage = settingsInfo.startupPage;
            $scope.refreshInterval = settingsInfo.refreshInterval;
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

        $scope.setStartupPage = function(startupPage) {
            settingsInfo.startupPage = startupPage;
            TwStorage.set("settingsInfo", settingsInfo);
        };

        $scope.setRefreshInterval = function(refreshInterval) {
            settingsInfo.refreshInterval = refreshInterval;
            TwStorage.set("settingsInfo", settingsInfo);
            $rootScope.$broadcast('reloadEvent', 'setRefreshInterval');
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

        init();
    });
