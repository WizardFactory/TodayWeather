/**
 * Created by aleckim on 2017. 4. 4..
 */

angular.module('service.storage', [])
    .factory('TwStorage', function(Util) {
        var obj = {};

        function _getSuiteName() {
            return ionic.Platform.isAndroid()?
                "net.wizardfactory.todayweather_preferences":
                "group.net.wizardfactory.todayweather";
        }

        function _hasAppPreferences() {
            if (window.plugins == undefined || plugins.appPreferences == undefined) {
               return false ;
            }
            return true;
        }

        function _localStorage2appPref() {
            var suitePrefs = plugins.appPreferences.suite(_getSuiteName());
            var legacyKey = ['guideVersion', 'purchaseInfo', 'storeReceipt', 'pushData', 'twAdsInfo',
                'cities', 'cityIndex'];

            legacyKey.forEach(function (key) {
                suitePrefs.fetch(
                    function (value) {
                        if (value == null || value == '') {
                            value = localStorage.getItem(key);
                            console.log('save key='+key+ 'val='+value);
                            suitePrefs.store(
                                function (result) {
                                    console.log("save preference Success: " + result);
                                },
                                function (err) {
                                    Util.ga.trackEvent('storage', 'error', key);
                                    Util.ga.trackException(err, false);
                                },
                                key, value);
                        }
                        else {
                            console.log(key +' is already saved val='+value);
                        }
                    },
                    function (err) {
                        Util.ga.trackEvent('storage', 'error', key);
                        Util.ga.trackException(err, false);
                    },
                    key);
            });
        }

        obj.get = function (successCallback, errorCallback, name) {
            if (_hasAppPreferences()) {
                var value = localStorage.getItem(name);
                successCallback(value);
                return;
            }
            else {
                var suitePrefs = plugins.appPreferences.suite(_getSuiteName());
                return suitePrefs.fetch(successCallback, errorCallback, name);
            }
        };

        obj.set = function (successCallback, errorCallback, name, value) {
            if (_hasAppPreferences()) {
                localStorage.setItem(name, value);
                successCallback("ok");
                return;
            }
            else {
                var suitePrefs = plugins.appPreferences.suite(_getSuiteName());
                return suitePrefs.store(successCallback, errorCallback, name, val);
            }
        };

        obj.init = function () {
            //for compatible version
            _localStorage2appPref();
        };

        return obj;
    });


