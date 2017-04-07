/**
 * Created by aleckim on 2017. 4. 4..
 */

angular.module('service.storage', [])
    .factory('TwStorage', function(Util) {
        var obj = {};
        var suitePrefs;

        function _localStorage2appPref() {
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

        obj.init = function () {
            var suiteName;
            var self = this;

            if (window.plugins == undefined || plugins.appPreferences == undefined) {
                self.set = function (successCallback, errorCallback, name, value) {
                    localStorage.setItem(name, value);
                    successCallback(value);
                    return;
                };

                self.get = function (successCallback, errorCallback, name) {
                    var value = localStorage.getItem(name);
                    successCallback(value);
                    return;
                };
            }
            else {
                if (ionic.Platform.isAndroid()) {
                    suiteName = "net.wizardfactory.todayweather_preferences";
                }
                else {
                    suiteName = "group.net.wizardfactory.todayweather";
                }

                suitePrefs = plugins.appPreferences.suite(suiteName);

                self.set = function (successCallback, errorCallback, name, val) {
                    return suitePrefs.store(successCallback, errorCallback, name, val);
                };

                self.get = function (successCallback, errorCallback, name) {
                    return suitePrefs.fetch(successCallback, errorCallback, name);
                };

                //for compatible version
                _localStorage2appPref();
            }
        };

        return obj;
    });


