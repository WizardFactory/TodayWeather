angular.module('controller.settingctrl', [])
    .controller('SettingCtrl', function($scope, $http, Util, Purchase, $ionicHistory, $translate, twStorage) {
        function init() {
            $ionicHistory.clearHistory();

            if (ionic.Platform.isAndroid()) {
                //get interval time;
                $scope.updateInterval = "0";
                $scope.widgetOpacity = "69";

                twStorage.get(
                    function (value) {
                        if (value == null || value == '') {
                            value = "0"
                        }
                        $scope.updateInterval = ""+value;
                        console.log("get update interval Success: " + value);
                    },
                    function (err) {
                        Util.ga.trackEvent('storage', 'error', 'getUpdateInterval');
                        Util.ga.trackException(err, false);
                    },
                    'updateInterval');

                twStorage.get(
                    function (value) {
                        if (value == null || value == '') {
                            value = "69"
                        }
                        $scope.widgetOpacity = ""+value;
                        console.log("get widget opacity Success: " + value);
                    },
                    function (err) {
                        Util.ga.trackEvent('storage', 'error', 'getWidgetOpacity');
                        Util.ga.trackException(err, false);
                    },
                    'widgetOpacity');
            }
        }

        $scope.version = Util.version;

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
                $scope.showAlert(strTitle, strMsg);
            });
        };

        $scope.isAndroid = function () {
            return ionic.Platform.isAndroid();
        };

        $scope.changeWidgetOpacity = function (val) {
            console.log("widget opacity ="+ val);

            twStorage.set(
                function (result) {
                    console.log("widget opacity save " + result);
                },
                function (err) {
                    Util.ga.trackEvent('storage', 'error', 'setWidgetOpacity');
                    Util.ga.trackException(err, false);
                },
                'widgetOpacity', +val);
        };

        $scope.changeUpdateInterval = function (val) {
            console.log("update interval ="+ val);

            twStorage.set(
                function (result) {
                    console.log("update interval save " + result);
                },
                function (err) {
                    Util.ga.trackEvent('storage', 'error', 'setUpdateInterval');
                    Util.ga.trackException(err, false);
                },
                'updateInterval', +val);
        };

        $scope.hasInAppPurchase = function () {
            return Purchase.hasInAppPurchase || Purchase.paidAppUrl.length > 0;
        };

        $scope.showAbout = function () {
            if (Util.language.indexOf("ko") != -1) {
                return true;
            }
            else {
                return false;
            }
        };

        init();
    });
