angular.module('service.storage', [])
    .factory('TwStorage', function($rootScope, $q, Util, Monetization) {
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

        // The rollback hand-back (AN-17, #2896): after a native release is rolled back to this build (a higher
        // versionCode), the native app has left the state the user had there in the suite under this marker
        // ({schema, generation, writer, complete, keys}). A newer complete native hand-back replaces the stale WebView
        // values, removals included, before the restore or mirror below; this build then claims the state
        // (writer 'cordova', generation + 1), so a later native start migrates what changes here. While the marker or
        // a key cannot be read, localStorage refuses the texts, or the claim is not stored, the start waits (the splash
        // stays until a view enters) and tries again with growing delays: nothing of the stale state is shown, posted
        // or edited, and nothing mixes into the suite. The promise resolves whether the stored analytics choice can be trusted: not
        // under a marker this build cannot use, which may hold a newer choice.
        var handBackKey = '_twHandBack';
        var handBackApplied = 'twHandBackApplied';
        var handBackKeys = ['cities', 'cityIndex', 'cityList', 'units', 'settingsInfo', 'pushData2', 'pushData',
            'expandShortChart', 'startVersion', 'appVersion', 'disableUpdateInfo', 'twAnalyticsConsentV1'];

        function _readHandBack(value) {
            var marker = value;
            if (typeof value === 'string') {
                try { marker = JSON.parse(value); } catch (e) { return null; }
            }
            if (!marker || marker.schema !== 1 || typeof marker.generation !== 'number' || marker.complete !== true ||
                (marker.writer !== 'native' && marker.writer !== 'cordova') || !Array.isArray(marker.keys)) {
                return null;
            }
            return marker;
        }

        function _handBack() {
            var deferred = $q.defer();
            var delay = 1000;

            function retry(reason, next) {
                console.log('[_handBack] ' + reason + '; trying again in ' + delay + ' ms');
                Util.ga.trackEvent('storage', 'error', 'handBack');
                setTimeout(next || attempt, delay);
                delay = Math.min(delay * 2, 30000);
            }

            function attempt() {
                var applied = Number(localStorage.getItem(handBackApplied)) || 0;

                // The claim lets a later native start adopt what changes here: under a native marker the start goes on
                // ([done]) only once the suite reports it stored. A commit that fails leaves the claim in the suite's
                // memory while its file keeps the native marker, so the same claim is stored again until it is, instead
                // of being read back.
                function claim(generation, done) {
                    var text = JSON.stringify({schema: 1, generation: Math.max(generation, applied) + 1,
                        writer: 'cordova', complete: true, keys: handBackKeys});
                    function store() {
                        suitePrefs.store(function () {
                            if (done) { done(); }
                        }, function () {
                            if (done) { retry('the claim not stored', store); }
                        }, handBackKey, text);
                    }
                    store();
                }
                function resolveTrusted() { deferred.resolve(true); }

                suitePrefs.fetch(function (value) {
                    var marker = _readHandBack(value);
                    if (value == undefined || value === '') {
                        claim(0);
                        deferred.resolve(true);
                        return;
                    }
                    // An unreadable or unknown marker, or this build's own claim: the WebView state stays and is not claimed.
                    if (!marker || marker.writer !== 'native') {
                        deferred.resolve(!!marker);
                        return;
                    }
                    if (marker.generation <= applied) {
                        claim(marker.generation, resolveTrusted);
                        return;
                    }
                    var keys = handBackKeys.filter(function (key) { return marker.keys.indexOf(key) >= 0; });
                    var texts = {}, count = keys.length, failed = false;
                    function finish() {
                        if (failed) {
                            retry('a key unreadable');
                            return;
                        }
                        try {
                            // Every owned key goes first, so the texts take the room of the stale ones.
                            keys.forEach(function (key) { localStorage.removeItem(key); });
                            keys.forEach(function (key) {
                                if (texts[key] != undefined && texts[key] !== '') { localStorage.setItem(key, texts[key]); }
                            });
                            localStorage.setItem(handBackApplied, String(marker.generation));
                        } catch (e) {
                            retry('not applied: ' + e);
                            return;
                        }
                        claim(marker.generation, resolveTrusted);
                    }
                    if (count === 0) { finish(); return; }
                    keys.forEach(function (key) {
                        suitePrefs.fetch(function (text) {
                            texts[key] = text == undefined || typeof text === 'string' ? text : JSON.stringify(text);
                            if (--count === 0) { finish(); }
                        }, function (err) {
                            failed = true;
                            if (--count === 0) { finish(); }
                        }, key);
                    });
                }, function (err) {
                    retry('the marker unreadable');
                }, handBackKey);
            }

            attempt();
            return deferred.promise;
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
            var keys = ['cities', 'cityIndex', 'pushData', 'pushData2', 'startVersion', 'settingsInfo',
                'units', 'cityList', 'daumServiceKeys', 'disableUpdateInfo', 'appVersion', 'expandShortChart'];
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
            var keys = ['cities', 'cityIndex', 'pushData', 'startVersion', 'settingsInfo'];

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

                _handBack().then(function (trusted) {
                    // The analytics choice is final in localStorage now (the restore below does not touch it).
                    Monetization.storageReady(trusted);
                    _restoreOrMirror();
                });
            } else {
                Monetization.storageReady(true);
                that.setForwardCompatibility();
                deferred.resolve();
            }

            function _restoreOrMirror() {
                // localStorage가 clear 된 경우 appPreference의 data를 localStorage로 update.
                // A new web origin (file:// → app://localhost or https://localhost) also starts empty; test the
                // city keys, not length, so an unrelated early write cannot skip the restore.
                if (localStorage.getItem('cityList') === null && localStorage.getItem('cities') === null) {
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
            }

            return deferred.promise;
        };

        return obj;
    });