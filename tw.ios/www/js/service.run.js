angular.module('service.run', [])
    .run(function($rootScope, $ionicPlatform, WeatherInfo, Util) {
        //위치 재조정해야 함.
        if (twClientConfig.debug) {
            Util.ga.debugMode();
        }

        if (ionic.Platform.isIOS()) {
            Util.ga.startTrackerWithId(twClientConfig.gaIOSKey);

            // isLocationEnabled 요청해야 registerLocationStateChangeHandler가 호출됨
            if (window.cordova && window.cordova.plugins && window.cordova.plugins.diagnostic) {
                cordova.plugins.diagnostic.isLocationEnabled(function (enabled) {
                    console.log("Location setting is " + (enabled ? "enabled" : "disabled"));
                }, function (error) {
                    console.error("Error getting for location enabled status: " + error);
                });
            }
        } else if (ionic.Platform.isAndroid()) {
            Util.ga.startTrackerWithId(twClientConfig.gaAndroidKey, 30);

            // android는 실행 시 registerLocationStateChangeHandler 호출되지 않으므로 직접 locationMode를 가져와서 설정함
            if (window.cordova && window.cordova.plugins && window.cordova.plugins.diagnostic) {
                cordova.plugins.diagnostic.getLocationMode(function(locationMode) {
                    Util.locationStatus = locationMode;
                }, function(error) {
                    console.error("Error getting for location mode: " + error);
                });
            }
        }
        else {
            console.log("Error : Unknown platform");
        }
        Util.ga.platformReady();

        Util.ga.enableUncaughtExceptionReporting(true);
        Util.ga.setAllowIDFACollection(true);

        Util.language = navigator.userLanguage || navigator.language;
        if (navigator.globalization) {
            navigator.globalization.getLocaleName(
                function (locale) {
                    Util.region = locale.value.split('-')[1];
                    console.log('region: ' + Util.region + '\n');
                },
                function () {
                    console.log('Error getting locale\n');
                }
            );
        }

        Util.ga.trackEvent('app', 'language', Util.language);

        if (window.hasOwnProperty("device")) {
            Util.uuid = window.device.uuid;
            console.log("UUID:"+window.device.uuid);
        }

        console.log("UA:"+ionic.Platform.ua);
        console.log("Height:" + window.innerHeight + ", Width:" + window.innerWidth + ", PixelRatio:" + window.devicePixelRatio);
        console.log("OuterHeight:" + window.outerHeight + ", OuterWidth:" + window.outerWidth);
        console.log("ScreenHeight:"+window.screen.height+", ScreenWidth:"+window.screen.width);

        if (window.screen) {
            Util.ga.trackEvent('app', 'screen width', window.screen.width);
            Util.ga.trackEvent('app', 'screen height', window.screen.height);
        }
        else if (window.outerHeight) {
            Util.ga.trackEvent('app', 'outer width', window.outerWidth);
            Util.ga.trackEvent('app', 'outer height', window.outerHeight);
        }

        if (window.hasOwnProperty("device")) {
            Util.ga.trackEvent('app', 'uuid', window.device.uuid);
        }
        Util.ga.trackEvent('app', 'ua', ionic.Platform.ua);
        if (window.cordova && cordova.getAppVersion) {
            cordova.getAppVersion.getVersionNumber().then(function (version) {
                $rootScope.version = version;
                Util.version = version;
                Util.ga.trackEvent('app', 'version', Util.version);
            });
        }

        window.onerror = function(msg, url, line) {
            var idx = url.lastIndexOf("/");
            if(idx > -1) {url = url.substring(idx+1);}
            var errorMsg = "ERROR in " + url + " (line #" + line + "): " + msg;
            Util.ga.trackEvent('window', 'error', errorMsg);
            Util.ga.trackException(errorMsg, true);
            console.log(errorMsg);
            if (twClientConfig.debug) {
                alert("ERROR in " + url + " (line #" + line + "): " + msg);
            }
            return false; //suppress Error Alert;
        };

        document.addEventListener("resume", function() {
            Util.ga.trackEvent('app', 'status', 'resume');
        }, false);
        document.addEventListener("pause", function() {
            Util.ga.trackEvent('app', 'status', 'pause');
        }, false);

        WeatherInfo.loadCities();
        WeatherInfo.loadTowns();
        $ionicPlatform.on('resume', function(){
            $rootScope.$broadcast('reloadEvent', 'resume');
        });

        if (window.cordova && window.cordova.plugins && window.cordova.plugins.diagnostic) {
            // ios는 실행 시 registerLocationStateChangeHandler 호출되어 locationStatus가 설정됨
            cordova.plugins.diagnostic.registerLocationStateChangeHandler(function (state) {
                var oldLocationEnabled = Util.isLocationEnabled();

                console.log("Location state changed to: " + state);
                Util.locationStatus = state;

                Util.ga.trackEvent('position', 'status', state);

                if (oldLocationEnabled === false && Util.isLocationEnabled()) {
                    $rootScope.$broadcast('reloadEvent', 'locationOn');
                }
            }, function (error) {
                console.error("Error registering for location state changes: " + error);
                Util.ga.trackEvent('position', 'error', 'registerLocationStateChange');
            });
        }
        else {
            Util.ga.trackEvent('plugin', 'error', 'loadDiagnostic')
        }
    });
