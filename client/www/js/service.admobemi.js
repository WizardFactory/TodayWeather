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

        var attStatuses = ['authorized', 'denied', 'restricted', 'not_determined'];
        /**
         * iOS (#2945): writes the App Tracking Transparency status and the request mode that the native rule applies
         * (scripts/ios-ad-privacy.js) to the device console, and hands the status to measurement. twAdPrivacyState
         * only reads; the app never raises the ATT prompt itself, UMP does. A build without the action gives no
         * answer, so a short timer keeps ads from waiting on this report.
         */
        function reportRequestPolicy(done) {
            var settled = false;
            function finish(state) {
                if (settled) { return; }
                settled = true;
                var known = !!state && attStatuses.indexOf(state.att_status) !== -1 && typeof state.personalized === 'boolean';
                var status = known ? state.att_status : 'unavailable';
                // console.log, as for load failures: iOS does not forward console.info to the device console.
                console.log(JSON.stringify(known ?
                    {component: 'admob', operation: 'request_policy', att_status: status, personalized: state.personalized, result: 'applied'} :
                    {component: 'admob', operation: 'request_policy', att_status: status, result: 'not_reported'}));
                Monetization.setAdTrackingStatus(status);
                done();
            }
            setTimeout(function () { finish(); }, 2000);
            try { cordova.exec(finish, function () { finish(); }, 'emiAdmobPlugin', 'twAdPrivacyState', []); }
            catch (e) { finish(); }
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
            /**
             * iOS (#2945): UMP shows the GDPR message, the IDFA explainer and the system ATT prompt inside the plugin's
             * initialize call. Ready means the SDK started and that call answered, so no banner is requested while a
             * prompt may be open, also when cached consent starts the SDK first. Android has no ATT prompt.
             */
            var isIOS = ionic.Platform.isIOS(), consentAnswered = !isIOS, reported = false;
            function ready() {
                if (!started || !consentAnswered || reported) { return; }
                reported = true;
                if (isIOS) { reportRequestPolicy(success); } else { success(); }
            }
            document.addEventListener('on.sdkInitialization', function onInit(data) {
                document.removeEventListener('on.sdkInitialization', onInit);
                started = true;
                console.info({component: 'admob', operation: 'initialize', result: 'ready'});
                ready();
            });
            document.addEventListener('on.banner.failed.load', function (event) {
                lifecycle('failed');
                // Keep only the SDK's numeric error code (no fill, network, invalid request...); the native
                // message can contain ad unit IDs. Stringify and use console.log: iOS forwards console.log, not
                // console.info, to the device console.
                var code = event && event.code;
                if (typeof code !== 'number' || Math.floor(code) !== code || code < 0 || code > 999) {
                    code = undefined;
                }
                console.log(JSON.stringify({component: 'admob', operation: 'banner_load', cause: 'load_failed',
                    error_code: code === undefined ? 'unavailable' : code, result: 'failed'}));
                if (code !== undefined) {
                    Monetization.track('ad_load_error', {ad_format: 'banner', error_code: code});
                }
            });

            var options = {
                isUsingAdManagerRequest: false,
                isResponseInfo: clientConfig.debug,
                isConsentDebug: false
            };

            /**
             * The plugin starts the Ads SDK only when UMP already allows ads at the moment initialize runs. On a
             * first launch the consent result arrives later (Android status events, the iOS callback after the
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
                // An error is an answer too: ads from cached consent continue, as before.
                consentAnswered = true;
                ready();
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

            // iOS calls back when UMP finished (SDK started, or the consent form was answered). Android calls back
            // at once, before the consent update, so a retry from that callback would run before consent is cached
            // and use up the only retry: the first session then never starts the SDK (#2871). Android waits for
            // the consent status events above instead.
            plugin().initialize(options, isIOS ? function () {
                consentAnswered = true;
                ready();
                startAfterConsent();
            } : function () {}, onConsentError);
        };

        return obj;
    });
