/**
 * Created by wizardfactory on 17. 5. 13..
 */

angular.module('service.storage', [])
    .factory('TwStorage', function(Util) {
        var obj = {};
        var suitePrefs = null;
        var keys = ['cities', 'cityIndex', 'units', 'storeReceipt', 'purchaseInfo', 'pushData', 'twAdsInfo'];

        function _getSuiteName() {
            return ionic.Platform.isAndroid()?
                "net.wizardfactory.todayweather_preferences":
                "group.net.wizardfactory.todayweather";
        }

        function _hasAppPreferences() {
            if (window.plugins == undefined || plugins.appPreferences == undefined) {
                return false;
            }
            return true;
        }

        function _localStorage2appPref() {
            if (_hasAppPreferences()) {
                suitePrefs = plugins.appPreferences.suite(_getSuiteName());

                for(var key in localStorage) {
                    if (keys.indexOf(key) == -1) {
                        localStorage.removeItem(key);
                    } else {
                        console.log('load + ' + key);
                        suitePrefs.fetch(
                            function (value) {
                                if (value == undefined || value === '') {
                                    value = localStorage.getItem(key);
                                    console.log('save key = ' + key + 'val = ' + value);
                                    suitePrefs.store(
                                        function (result) {
                                            console.log("save preference Success: " + result);
                                            localStorage.removeItem(key);
                                        },
                                        function (err) {
                                            Util.ga.trackEvent('storage', 'error', key);
                                            Util.ga.trackException(err, false);
                                        },
                                        key, value);
                                }
                                else {
                                    console.log(key +' is already saved val='+value);
                                    localStorage.removeItem(key);
                                }
                            }, function (err) {
                                Util.ga.trackEvent('storage', 'error', key);
                                Util.ga.trackException(err, false);
                            }, key);
                    }
                }
            }
        }

        obj.get = function (callback, name) {
            if (_hasAppPreferences()) {
                suitePrefs.fetch(function (value) {
                    if (value == undefined || value === '') {
                        callback(null);
                    } else {
                        callback(JSON.parse(value));
                    }
                }, function (error) {
                    Util.ga.trackEvent('storage', 'error', 'get ' + name);
                    Util.ga.trackException(err, false);
                    callback(null);
                }, name);
            } else {
                var value = localStorage.getItem(name);
                try {
                    value = JSON.parse(localStorage.getItem(name));
                } catch (e) {
                }
                callback(value);
            }
        };

        obj.set = function (callback, name, value) {
            if (_hasAppPreferences()) {
                suitePrefs.store(function (value) {
                    callback("OK");
                }, function(error) {
                    Util.ga.trackEvent('storage', 'error', 'set ' + name);
                    Util.ga.trackException(err, false);
                    callback(error);
                }, name, value);
            } else {
                localStorage.setItem(name, value);
                callback("OK");
            }
        };

        obj.init = function () {
            //for compatible version
            _localStorage2appPref();
        };

        return obj;
    })
    .run(function(TwStorage, WeatherInfo) {
        TwStorage.init();
        WeatherInfo.loadCities();
    });