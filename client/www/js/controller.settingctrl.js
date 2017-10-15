angular.module('controller.settingctrl', [])
    .controller('SettingCtrl', function($scope, $rootScope, Util, Purchase, $ionicHistory, $translate,
                                        $ionicSideMenuDelegate, $ionicPopup) {

        var strOkay = "OK";
        var strCancel = "Cancel";
        $translate(['LOC_OK', 'LOC_CANCEL']).then(function (translations) {
            strOkay = translations.LOC_OK;
            strCancel = translations.LOC_CANCEL;
        }, function (translationIds) {
            console.log("Fail to translate : "+JSON.stringify(translationIds));
        });

        function init() {
            $scope.refreshInterval = localStorage.getItem("refreshInterval");
            if ($scope.refreshInterval === null) {
                $scope.refreshInterval = "0"; //수동
            }
        }

        $scope.setRefreshInterval = function(refreshInterval) {
            localStorage.setItem("refreshInterval", refreshInterval);
            $rootScope.$broadcast('reloadEvent', 'setRefreshInterval');
        };

        $scope.sendMail = function() {
            var to = twClientConfig.mailTo;
            var subject = 'Send feedback';
            var body = '\n====================\nApp Version : ' + Util.version + '\nUUID : ' + window.device.uuid
                + '\nUA : ' + ionic.Platform.ua + '\n====================\n';

            $translate('LOC_SEND_FEEDBACK').then(function (translations) {
                subject = translations;
            }, function (translationIds) {
                subject = translationIds;
            }).finally(function () {
                window.location.href = 'mailto:' + to + '?subject=' + subject + '&body=' + encodeURIComponent(body);
            });

            Util.ga.trackEvent('action', 'click', 'send mail');
        };

        $scope.openMarket = function() {
            var src = "";
            if (ionic.Platform.isIOS()) {
                src = twClientConfig.iOSStoreUrl;
            }
            else if (ionic.Platform.isAndroid()) {
                src = twClientConfig.androidStoreUrl;
            }
            else {
                src = twClientConfig.etcUrl;
            }

            console.log('market='+src);

            if (window.cordova && cordova.InAppBrowser) {
                cordova.InAppBrowser.open(src, "_system");
                Util.ga.trackEvent('action', 'click', 'open market');
            }
            else {
                Util.ga.trackEvent("inappbrowser", "error", "loadPlugin");
                var options = {
                    location: "yes",
                    clearcache: "yes",
                    toolbar: "no"
                };
                window.open(src, "_blank", options);
            }
        };

        /**
         * 설정에 정보 팝업으로, 늦게 로딩되어도 상관없고 호출될 가능성이 적으므로 그냥 현상태 유지.
         */
        $scope.openInfo = function() {
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
            return $ionicSideMenuDelegate.isOpen();
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
