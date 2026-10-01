angular.module('controller.settingctrl', [])
    .controller('SettingCtrl', function($scope, $rootScope, Util, $ionicHistory, $translate,
                                        $ionicSideMenuDelegate, $ionicPopup, $location, TwStorage, radioList, Monetization) {

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
            }
            else if (menu === 'openMarket') {
                $ionicSideMenuDelegate.toggleLeft();
                Util.openMarket();
            }
            else if (menu === 'openInfo') {
                openInfo();
            }
            else if (menu === 'nullschool') {
                Util.ga.trackEvent('action', 'click', 'open nullschool');
                var src = "https://earth.nullschool.net/#current/wind/surface/level/orthographic=-233.36,38.96,3000";
                if (window.cordova && cordova.InAppBrowser) {
                    cordova.InAppBrowser.open(src, "_system");
                }
                else {
                    var options = {
                        location: "yes",
                        clearcache: "yes",
                        toolbar: "no"
                    };
                    window.open(src, "_blank", options);
                }
            }
            else {
                $ionicSideMenuDelegate.toggleLeft();
                $location.path('/' + menu);
            }
        };

        $scope.analyticsChoice = function() { return Monetization.getCollectionChoice(); };
        $scope.chooseAnalytics = function() {
            var keys = ['LOC_ANALYTICS_CHOICE', 'LOC_ANALYTICS_DETAIL', 'LOC_ANALYTICS_ALLOW', 'LOC_ANALYTICS_DENY'];
            $translate(keys).then(function(t) {
                return $ionicPopup.show({title: t.LOC_ANALYTICS_CHOICE, template: t.LOC_ANALYTICS_DETAIL,
                    buttons: [
                        {text: t.LOC_ANALYTICS_DENY, onTap: function() { return false; }},
                        {text: t.LOC_ANALYTICS_ALLOW, onTap: function() { return true; }}
                    ]});
            }).then(function(value) {
                if (typeof value !== 'boolean') { return; } // Back/dismiss is not consent.
                Monetization.setCollectionEnabled(value, function(ok) {
                    $scope.$evalAsync(function() {
                        if (!ok) {
                            $translate('LOC_PRIVACY_SAVE_FAILED').then(function(message) {
                                $rootScope.showAlert('TodayWeather', message);
                            });
                        }
                    });
                });
            });
        };
        $scope.openPolicy = function(kind) {
            var lang = Util.language === 'ko' || Util.language === 'ja' ? Util.language : 'en';
            var suffix = lang === 'ko' ? '' : '.' + lang;
            var url = 'https://todayweather.ai/mobile/' + kind + suffix + '.html';
            if (window.cordova && cordova.InAppBrowser) { cordova.InAppBrowser.open(url, '_system'); }
            else { window.open(url, '_blank'); }
        };
        $scope.openAdPrivacy = function() {
            var plugin = window.cordova && cordova.plugins && cordova.plugins.emiAdmobPlugin;
            if (!plugin || !plugin.showPrivacyOptionsForm) { return; }
            plugin.showPrivacyOptionsForm(function() {}, function() {
                console.warn({component: 'privacy', operation: 'ad_choices', cause: 'ump_error',
                    action: 'retain_choice', result: 'form_unavailable'});
                $translate('LOC_AD_PRIVACY_UNAVAILABLE').then(function(message) {
                    $rootScope.showAlert('TodayWeather', message);
                });
            });
        };

        /**
         * 설정에 정보 팝업으로, 늦게 로딩되어도 상관없고 호출될 가능성이 적으므로 그냥 현상태 유지.
         */
        var openInfo = function() {
            var strTitle = "TodayWeather";
            var strMsg;
            $translate([$rootScope.title,'LOC_WEATHER_INFORMATION', 'LOC_KOREA_METEOROLOGICAL_ADMINISTRATION', 'LOC_AQI_INFORMATION', 'LOC_KOREA_ENVIRONMENT_CORPORATION', 'LOC_IT_IS_UNAUTHENTICATED_REALTIME_DATA_THERE_MAY_BE_ERRORS']).then(function (translations) {
                strTitle = translations[$rootScope.title];
                strMsg = translations.LOC_WEATHER_INFORMATION + " : "  + translations.LOC_KOREA_METEOROLOGICAL_ADMINISTRATION;
                strMsg += "<br>";
                strMsg += translations.LOC_AQI_INFORMATION + " : " + translations.LOC_KOREA_ENVIRONMENT_CORPORATION;
                strMsg += "<br>";
                strMsg += translations.LOC_IT_IS_UNAUTHENTICATED_REALTIME_DATA_THERE_MAY_BE_ERRORS;
            }, function (translationIds) {
                strTitle = translationIds[$rootScope.title];
                strMsg = translationIds.LOC_WEATHER_INFORMATION + " : "  + translationIds.LOC_KOREA_METEOROLOGICAL_ADMINISTRATION;
                strMsg += "<br>";
                strMsg += translationIds.LOC_AQI_INFORMATION + " : " + translationIds.LOC_KOREA_ENVIRONMENT_CORPORATION;
                strMsg += "<br>";
                strMsg += translationIds.LOC_IT_IS_UNAUTHENTICATED_REALTIME_DATA_THERE_MAY_BE_ERRORS;
            }).finally(function () {
                $rootScope.showAlert(strTitle, strMsg);
            });
        };

        $scope.showAbout = function () {
            // Data-source and provisional-data notices must remain accessible in every locale.
            return true;
        };

        $scope.getRegion = function () {
            return Util.region;
        };

        $rootScope.isAndroid = function () {
            return ionic.Platform.isAndroid();
        };

        $rootScope.isIOS = function () {
            return ionic.Platform.isIOS();
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
                if (clientConfig.package === 'todayWeather') {
                    list = ['0', '1', '2', '3']
                }
                else if (clientConfig.package === 'todayAir') {
                   list = ['3', '4', '2']
                }
                list = list.map(function (value) {
                    return {label: $scope.getStartupPageValueStr(value), value: value};
                });
            }
            else if (name === 'refreshInterval') {
                title = 'LOC_REFRESH_INTERVAL';
                list = ['0', '30', '60', '180', '360', '720'].map(function (value) {
                    return {label: $scope.getRefreshIntervalValueStr(value), value: value};
                });
            }
            else if (name === 'theme') {
                title = 'LOC_THEME_SETTING';
                if (clientConfig.package === 'todayWeather') {
                    list = ['photo', 'light', 'dark', 'old'];
                }
                else if (clientConfig.package === 'todayAir') {
                    list = ['light', 'dark'];
                }
                list = list.map(function (value) {
                    return {label: $scope.getThemeValueStr(value), value: value};
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
                case '3':
                    return 'LOC_AIR_INFORMATION';
                case '4':
                    return 'LOC_WEATHER';
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

        $scope.getThemeValueStr = function (value) {
            //console.log('getThemeValueStr v='+value);
            switch(value) {
                case 'photo':
                    return 'LOC_WEATHER_PHOTO_THEME';
                case 'light':
                    return 'LOC_LIGHT_THEME';
                case 'dark':
                    return 'LOC_DARK_THEME';
                case 'old':
                    return 'LOC_OLD_THEME';
            }
            return 'N/A'
        };

        init();
    });
