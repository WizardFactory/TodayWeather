angular.module('service.storage', [])
    .factory('TwStorage', function($rootScope, $q, Util) {
        var obj = {};
        var suiteName;
        var oldSuiteName = 'net.wizardfactory.todayweather_preferences'; // only android
        var suitePrefs = null;
        var oldSuitePrefs = null;

        if (clientConfig.package) {
            suiteName = 'group.net.wizardfactory' + '.' + clientConfig.package.toLowerCase();
            console.info(suiteName);
        }
        else {
            console.error('unknown package:'+clientConfig.package);
        }

        function _hasAppPreferences() {
            if (window.plugins == undefined || plugins.appPreferences == undefined) {
                return false;
            }
            return true;
        }

        // localStorage가 clear 된 경우 appPreference의 data를 localStorage로 update
        function _appPref2localStorage() {
            var deferred = $q.defer();
            var keys = ['cities', 'cityIndex', 'storeReceipt', 'pushData', 'twAdsInfo', 'startVersion', 'settingsInfo',
                'purchaseInfo', 'units', 'cityList', 'daumServiceKeys', 'disableUpdateInfo', 'appVersion', 'expandShortChart'];
            var count = keys.length;

            keys.forEach(function (key) {
                suitePrefs.fetch(function (value) {
                    if (value == undefined || value === '') {
                        console.log('[_appPref2localStorage] ' + key + ' does not exist');
                    }
                    else {
                        localStorage.setItem(key, value);
                        console.log('[_appPref2localStorage] set key = ' + key + ', val = ' + value);
                    }
                    if (--count === 0) {
                        deferred.resolve();
                    }
                }, function (err) {
                    console.log('[_appPref2localStorage] ' + key + ' fetch fail');
                    Util.ga.trackEvent('storage', 'error', key);
                    Util.ga.trackException(err, false);
                    if (--count === 0) {
                        deferred.resolve();
                    }
                }, key);
            });

            return deferred.promise;
        }

        // appPreference에 저장된 data를 localStorage로 update, android는 새로운 appPreference에도 update
        function _appPref2appPref() {
            var deferred = $q.defer();
            var keys = ['units', 'cityList', 'daumServiceKeys'];
            if (ionic.Platform.isAndroid()) {
                keys.push('purchaseInfo');
            }

            var count = keys.length;
            keys.forEach(function (key) {
                var value = localStorage.getItem(key);
                if (value != undefined) {
                    console.log('[_appPref2appPref] ' + key + ' exist');
                    if (--count === 0) {
                        deferred.resolve();
                    }
                } else {
                    oldSuitePrefs.fetch(function (value) {
                        if (value == undefined || value === '') {
                            console.log('[_appPref2appPref] ' + key + ' does not exist');
                        }
                        else {
                            localStorage.setItem(key, value);

                            if (ionic.Platform.isAndroid()) {
                                suitePrefs.store(null, null, key, value);
                                oldSuitePrefs.remove(null, null, key);
                            }
                            console.log('[_appPref2appPref] key = ' + key + ', val = ' + value);
                        }
                        if (--count === 0) {
                            deferred.resolve();
                        }
                    }, function (err) {
                        console.log('[_appPref2appPref] ' + key + ' load fail');
                        Util.ga.trackEvent('storage', 'error', key);
                        Util.ga.trackException(err, false);
                        if (--count === 0) {
                            deferred.resolve();
                        }
                    }, key);
                }
            });

            return deferred.promise;
        }

        // localStorage에 저장된 data를 appPreference로 update
        function _localStorage2appPref() {
            var keys = ['cities', 'cityIndex', 'storeReceipt', 'pushData', 'twAdsInfo', 'startVersion', 'settingsInfo'];
            if (ionic.Platform.isIOS()) {
                keys.push('purchaseInfo');
            }

            keys.forEach(function (key){
                var value = localStorage.getItem(key);
                if (value != undefined) {
                    suitePrefs.store(function (result) {
                        console.log('[_localStorage2appPref] key = ' + key + ', val = ' + value);
                    },
                    function (err) {
                        console.log('[_localStorage2appPref] ' + key + ' save fail');
                        Util.ga.trackEvent('storage', 'error', key);
                        Util.ga.trackException(err, false);
                    }, key, value);
                }
            });
        }
        
        function _setBackwardCompatibility() {
            console.log({'startVersion':localStorage.getItem('startVersion')});
            if (localStorage.getItem('startVersion') == null && localStorage.getItem('guideVersion') != null) {
                localStorage.setItem('startVersion', localStorage.getItem('guideVersion'));
                localStorage.removeItem('guideVersion');
            }

            if (localStorage.getItem('settingsInfo') == null) {
                var settingsInfo = {
                    startupPage: "0", //시간별날씨
                    refreshInterval: "0" //수동
                };

                settingsInfo.startupPage = localStorage.getItem("startupPage");
                if (settingsInfo.startupPage === null) {
                    settingsInfo.startupPage = "0";
                } else {
                    localStorage.removeItem("startupPage");
                }
                settingsInfo.refreshInterval = localStorage.getItem("refreshInterval");
                if (settingsInfo.refreshInterval === null) {
                    settingsInfo.refreshInterval = "0";
                } else {
                    localStorage.removeItem("refreshInterval");
                }

                localStorage.setItem("settingsInfo", JSON.stringify(settingsInfo));
            }
        }

        obj.setForwardCompatibility = function () {
            var that = this;

            var settingsInfo = that.get("settingsInfo");
            if (settingsInfo !== null) {
                if (settingsInfo.theme == undefined) {
                    settingsInfo.theme = 'light'; //밝은 테마
                    that.set("settingsInfo", settingsInfo);
                }
                $rootScope.settingsInfo = settingsInfo; // 저장된 설정값으로 업데이트
            } else {
                that.set("settingsInfo", $rootScope.settingsInfo); // 초기값 저장
            }
        };

        obj.get = function (name) {
            var value;
            try {
                value = JSON.parse(localStorage.getItem(name));
            } catch (err) {
                Util.ga.trackEvent('storage', 'error', 'get ' + name);
                Util.ga.trackException(err, false);
            }
            return value;
        };

        obj.set = function (name, value) {
            var data = JSON.stringify(value);

            if (_hasAppPreferences()) {
                suitePrefs.store(function (data) {
                    //callback("OK");
                }, function(err) {
                    Util.ga.trackEvent('storage', 'error', 'set ' + name);
                    Util.ga.trackException(err, false);
                    //callback(err);
                }, name, data);
            }

            localStorage.setItem(name, data);
        };

        obj.init = function () {
            var that = this;
            var deferred = $q.defer();

            // settingInfo 초기값을 rootScope에 저장
            if (clientConfig.package === 'todayAir') {
                $rootScope.settingsInfo = {
                    startupPage: "3", //대기정보
                    refreshInterval: "0", //수동
                    theme: "light" //밝은 테마
                };
            } else {
                $rootScope.settingsInfo = {
                    startupPage: "0", //시간별날씨
                    refreshInterval: "0", //수동
                    theme: "light" //밝은 테마
                };
            }

            if (_hasAppPreferences()) {
                suitePrefs = plugins.appPreferences.suite(suiteName);

                // localStorage가 clear 된 경우 appPreference의 data를 localStorage로 update
                if (localStorage.length === 0) {
                    _appPref2localStorage().finally(function () {
                        that.setForwardCompatibility();
                        deferred.resolve();
                    })
                } else {
                    _setBackwardCompatibility();

                    if (ionic.Platform.isAndroid()) {
                        oldSuitePrefs = plugins.appPreferences.suite(oldSuiteName);
                    } else {
                        oldSuitePrefs = suitePrefs;
                    }

                    // appPreference에 저장된 data를 localStorage로 update, android는 새로운 appPreference에도 update
                    _appPref2appPref().finally(function () {
                        // localStorage에 저장된 data를 appPreference로 update
                        _localStorage2appPref();
                        that.setForwardCompatibility();
                        deferred.resolve();
                    });
                }
            } else {
                that.setForwardCompatibility();
                deferred.resolve();
            }

            return deferred.promise;
        };

        return obj;
    });