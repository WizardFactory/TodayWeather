/**
 * AdMob adapter for emi-indo-cordova-plugin-admob (cordova.plugins.emiAdmobPlugin), with the same
 * interface as admobClean/admobPro so TwAds can drive it unchanged.
 */
angular.module('service.admobemi', [])
    .factory('admobEmi', function(Util, Monetization) {
        var obj = {};
        var bannerAdUnit = '';
        var initialized = false, lastBannerLoadAt, pendingLoadTimer, cancelPendingLoad;
        function lifecycle(action) {
            Monetization.track('ad_lifecycle', {action: action, ad_format: 'banner'});
        }

        function plugin() {
            return window.cordova && cordova.plugins && cordova.plugins.emiAdmobPlugin;
        }

        /**
         * Loads the banner without showing it; success runs once it has loaded.
         * isOverlapping false shrinks the web view by the banner height (legacy overlap:false).
         */
        obj.createBannerView = function(success, error) {
            var settled = false;
            function settle(failed) {
                if (settled) { return; }
                settled = true;
                document.removeEventListener('on.banner.load', onLoad);
                document.removeEventListener('on.banner.failed.load', onFailure);
                if (failed) { if (error) { error(); } }
                else if (success) { success(); }
            }
            function onLoad() { settle(false); }
            function onFailure() { settle(true); }
            function load() {
                pendingLoadTimer = undefined; cancelPendingLoad = undefined;
                lastBannerLoadAt = Date.now();
                // Native load failures are events, distinct from Cordova command failures.
                document.addEventListener('on.banner.load', onLoad);
                document.addEventListener('on.banner.failed.load', onFailure);
                lifecycle('request');
                plugin().loadBannerAd({
                    adUnitId: bannerAdUnit,
                    position: 'bottom-center',
                    size: 'adaptive',
                    collapsible: false,
                    autoShow: false,
                    isOverlapping: false,
                    // cordova-android 15 layout: resize the web view by the banner height (also on Android 16+).
                    isCordova15: true,
                    loadInterval: 0 // JS owns five-second spacing; avoid native silent returns.
                }, function () {}, onFailure);
            }
            // Preserve the plugin's five-second request spacing in JS. Native interval
            // returns silently (no event/callback), so it must not own this completion gate.
            var remaining = lastBannerLoadAt === undefined ? 0 : 5000 - (Date.now() - lastBannerLoadAt);
            if (remaining > 0) {
                cancelPendingLoad = onFailure;
                pendingLoadTimer = window.setTimeout(load, remaining);
            } else { load(); }
        };

        obj.destroyBannerView = function (success, error) {
            if (pendingLoadTimer !== undefined) {
                window.clearTimeout(pendingLoadTimer); pendingLoadTimer = undefined;
                var cancel = cancelPendingLoad; cancelPendingLoad = undefined;
                cancel();
            }
            plugin().removeBannerAd(success, error);
        };

        obj.showBannerAd = function(show, success, error) {
            if (show) {
                plugin().showBannerAd(function() {
                    lifecycle('show');
                    if (success) { success(); }
                }, error);
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
            if (initialized) { return; }
            initialized = true;
            // Diagnostic events are separate from automatic Firebase ad_impression/revenue.
            ['load', 'impression', 'hide'].forEach(function(name) {
                document.addEventListener('on.banner.' + name, function() {
                    lifecycle(name === 'load' ? 'loaded' : name);
                });
            });

            var started = false;
            document.addEventListener('on.sdkInitialization', function onInit(data) {
                document.removeEventListener('on.sdkInitialization', onInit);
                started = true;
                console.info({component: 'admob', operation: 'initialize', result: 'ready'});
                success();
            });
            document.addEventListener('on.banner.failed.load', function (data) {
                console.log('on banner failed load');
                lifecycle('failed');
            });

            var options = {
                isUsingAdManagerRequest: false,
                isResponseInfo: clientConfig.debug,
                isConsentDebug: false
            };

            /**
             * The plugin starts the Ads SDK only when UMP already allows ads at the moment initialize runs. On a
             * first launch the consent result arrives later (Android success events, the iOS callback after the
             * form), so the SDK stays off until the next launch. Once the consent flow has finished, initialize
             * again: consent is cached by then, and the plugin starts the SDK only if UMP allows ads.
             */
            var retried = false;
            function startAfterConsent() {
                setTimeout(function () {
                    if (started || retried) {
                        return;
                    }
                    retried = true;
                    console.log('admob consent finished, initialize again');
                    plugin().initialize(options, function () {}, onConsentError);
                }, 1000);
            }
            ['on.consent.status.not_required', 'on.consent.status.obtained', 'on.personalization.state'].forEach(function (name) {
                document.addEventListener(name, startAfterConsent);
            });

            var fallenBack = false;
            /**
             * UMP fails ("no form(s) configured") while no consent message is published in the AdMob console.
             * Release builds then show no ads, as Google's consent guidance requires. Builds with Google's test ad
             * units start the SDK without UMP so the ad path stays testable.
             */
            function onConsentError(reason) {
                console.warn({component: 'admob', operation: 'consent', cause: 'ump_error', action: 'retain_gate', result: 'not_ready'});
                lifecycle('consent_failed');
                // A consent decision (not a UMP failure) must never be bypassed.
                if (clientConfig.releaseAds || fallenBack || /consent is required|status unknown/i.test(String(reason))) {
                    if (error) { error(reason); }
                    return;
                }
                fallenBack = true;
                plugin().metaData({useCustomConsentManager: true});
                plugin().initialize(options, function () {}, error);
            }
            // Android reports the failure as an event; iOS through the initialize error callback.
            document.addEventListener('on.consent.info.update.failed', function onFailed(data) {
                document.removeEventListener('on.consent.info.update.failed', onFailed);
                onConsentError(data);
            });

            // iOS calls back when UMP finished (SDK started, or the consent form was answered).
            plugin().initialize(options, startAfterConsent, onConsentError);
        };

        return obj;
    });
