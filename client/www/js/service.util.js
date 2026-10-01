angular.module('service.util', [])
    .factory('Util', function ($window, Monetization) {
        var obj = {};

        //region Function

        //endregion

        //region APIs

        // Compatibility facade: retired UA/Fabric calls cannot forward arbitrary labels to GA4.
        obj.ga = {
            platformReady: function() { Monetization.init(); },
            trackView: function(screen) { Monetization.screen(screen); },
            trackEvent: function(category, action, label, value) {
                if (category === "position" && action === "status" && label === "authorized") {
                    Monetization.track("location_permission", {outcome: value === 1 ? "granted" : value === 0 ? "denied" : "unknown"});
                }
            },
            // Compatibility callers may withdraw; only the settings choice may grant.
            setOptOut: function(optout) { if (optout === true) { Monetization.setCollectionEnabled(false); } },
            // Old integrations remain inert for call-site compatibility. Never export UUIDs/raw errors.
            startTrackerWithId: angular.noop, setAllowIDFACollection: angular.noop,
            setUserId: angular.noop, setAnonymizeIp: angular.noop, setAppVersion: angular.noop,
            debugMode: angular.noop, trackMetric: angular.noop, addCustomDimension: angular.noop,
            trackException: angular.noop, trackTiming: angular.noop, addTransaction: angular.noop,
            addTransactionItem: angular.noop, enableUncaughtExceptionReporting: angular.noop
        };

        //endregion

        obj.version = '';
        obj.startVersion = 1.0;
        obj.language;
        obj.region;
        obj.uuid = '';

        //obj.url = "/v000803";
        //obj.url = "https://todayweather-wizardfactory.rhcloud.com/v000803";
        //obj.url = "https://tw-wzdfac.rhcloud.com/v000803";
        //obj.url = "https://todayweather.wizardfactory.net/v000803";
        //obj.url = window.clientConfig.serverUrl;

        // android는 diagnostic.locationMode, ios는 diagnostic.permissionStatus를 나타냄
        obj.locationStatus = undefined;

        obj.isLocationEnabled = function() {
            var that = this;

            if (window.cordova && window.cordova.plugins && window.cordova.plugins.diagnostic) {
                if (ionic.Platform.isIOS()) {
                    if (that.locationStatus === cordova.plugins.diagnostic.permissionStatus.GRANTED
                        || that.locationStatus === cordova.plugins.diagnostic.permissionStatus.GRANTED_WHEN_IN_USE) {
                        return true;
                    }
                } else if (ionic.Platform.isAndroid()) {
                    if (that.locationStatus === cordova.plugins.diagnostic.locationMode.HIGH_ACCURACY
                        || that.locationStatus === cordova.plugins.diagnostic.locationMode.BATTERY_SAVING
                        || that.locationStatus === cordova.plugins.diagnostic.locationMode.DEVICE_ONLY) {
                        return true;
                    }
                }
                return false;
            }
            else {
                return true;
            }
        };

        obj.placesUrl = 'js!https://maps.googleapis.com/maps/api/js?libraries=places';
        if (clientConfig.googleapikey) {
            obj.placesUrl += '&key='+clientConfig.googleapikey;
        }

        obj.sendMail = function($translate) {
            var to = clientConfig.mailTo;
            var subject = 'Send feedback';
            var body = '\n====================\nApp Version : ' + this.version + '\nUUID : ' + window.device.uuid
                + '\nUA : ' + ionic.Platform.ua + '\n====================\n';

            $translate('LOC_SEND_FEEDBACK').then(function (translations) {
                subject = translations;
            }, function (translationIds) {
                subject = translationIds;
            }).finally(function () {
                window.location.href = 'mailto:' + to + '?subject=' + subject + '&body=' + encodeURIComponent(body);
            });

            this.ga.trackEvent('action', 'click', 'send mail');
        };

        obj.openMarket = function() {
            var src = "";
            if (ionic.Platform.isIOS()) {
                src = clientConfig.iOSStoreUrl;
            }
            else if (ionic.Platform.isAndroid()) {
                src = clientConfig.androidStoreUrl;
            }
            else {
                src = clientConfig.etcUrl;
            }

            console.log('market='+src);

            if (window.cordova && cordova.InAppBrowser) {
                cordova.InAppBrowser.open(src, "_system");
                this.ga.trackEvent('action', 'click', 'open market');
            }
            else {
                this.ga.trackEvent("inappbrowser", "error", "loadPlugin");
                var options = {
                    location: "yes",
                    clearcache: "yes",
                    toolbar: "no"
                };
                window.open(src, "_blank", options);
            }
        };

        /**
         * iOS keeps the status bar outside the web view (StatusBarOverlaysWebView=false), so its
         * background follows the theme's header colour (ionic.app.scss); otherwise the light text
         * of the photo/dark/old themes is drawn on white.
         * @param {string} theme settingsInfo.theme
         * @param {string} state $rootScope.state (forecast, dailyforecast, ...)
         */
        obj.applyIOSStatusBar = function (theme, state) {
            if (!window.StatusBar || !ionic.Platform.isIOS()) {
                return;
            }
            var color = {light: '#ffffff', dark: '#1b1b1b', old: '#444444', photo: '#444444'}[theme] || '#ffffff';
            if (theme === 'old' && state === 'forecast') {
                color = '#03a9f4';
            }
            else if (theme === 'old' && state === 'dailyforecast') {
                color = '#00bcd4';
            }
            StatusBar.backgroundColorByHexString(color);
            if (theme === 'light') {
                StatusBar.styleDefault();
            } else { //photo, dark, old
                StatusBar.styleLightContent();
            }
        };

        return obj;
    });
