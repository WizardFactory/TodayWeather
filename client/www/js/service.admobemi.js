/**
 * AdMob adapter for emi-indo-cordova-plugin-admob (cordova.plugins.emiAdmobPlugin), with the same
 * interface as admobClean/admobPro so TwAds can drive it unchanged.
 */
angular.module('service.admobemi', [])
    .factory('admobEmi', function(Util) {
        var obj = {};
        var bannerAdUnit = '';

        function plugin() {
            return window.cordova && cordova.plugins && cordova.plugins.emiAdmobPlugin;
        }

        /**
         * Loads the banner without showing it; success runs once it has loaded.
         * isOverlapping false shrinks the web view by the banner height (legacy overlap:false).
         */
        obj.createBannerView = function(success, error) {
            document.addEventListener('on.banner.load', function onLoad() {
                document.removeEventListener('on.banner.load', onLoad);
                if (success) { success(); }
            });
            plugin().loadBannerAd({
                adUnitId: bannerAdUnit,
                position: 'bottom-center',
                size: 'adaptive',
                collapsible: false,
                autoShow: false,
                isOverlapping: false
            }, function () {}, error);
        };

        obj.destroyBannerView = function (success, error) {
            plugin().removeBannerAd(success, error);
        };

        obj.showBannerAd = function(show, success, error) {
            if (show) {
                plugin().showBannerAd(success, error);
            }
            else {
                plugin().hideBannerAd(success, error);
            }
        };

        obj.init = function (options, success, error) {
            if (!plugin()) {
                console.log('there is not emi admob plugin');
                return -1;
            }
            bannerAdUnit = options.bannerAdUnit;

            document.addEventListener('on.sdkInitialization', function onInit(data) {
                document.removeEventListener('on.sdkInitialization', onInit);
                console.log('admob sdk initialized ' + (data && data.version));
                success();
            });
            document.addEventListener('on.banner.failed.load', function (data) {
                console.log('on banner failed load');
                Util.ga.trackEvent('plugin', 'error', 'admobReceiveAd ' + JSON.stringify(data && data.message || data));
            });

            var options = {
                isUsingAdManagerRequest: false,
                isResponseInfo: clientConfig.debug,
                isConsentDebug: false
            };
            var fallenBack = false;
            /**
             * The plugin starts the Ads SDK only after UMP succeeds. Until a consent message is set up in
             * the AdMob console, UMP fails ("no form(s) configured"), so start the SDK without it;
             * Google then serves limited ads where consent is required.
             */
            function startWithoutUmp(reason) {
                // A consent decision (not a UMP failure) must not be bypassed.
                if (fallenBack || /consent is required|status unknown/i.test(String(reason))) {
                    if (error) { error(reason); }
                    return;
                }
                fallenBack = true;
                console.log('admob consent failed, start without UMP: ' + JSON.stringify(reason));
                Util.ga.trackEvent('plugin', 'error', 'admobConsent ' + JSON.stringify(reason && reason.message || reason));
                plugin().metaData({useCustomConsentManager: true});
                plugin().initialize(options, function () {}, error);
            }
            // Android reports the failure as an event; iOS through the initialize error callback.
            document.addEventListener('on.consent.info.update.failed', function onFailed(data) {
                document.removeEventListener('on.consent.info.update.failed', onFailed);
                startWithoutUmp(data);
            });

            plugin().initialize(options, function () {}, startWithoutUmp);
        };

        return obj;
    });
