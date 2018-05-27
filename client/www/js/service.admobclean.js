/**
 * Created by aleckim on 2018. 5. 14.
 */

angular.module('service.admobclean', [])
    .factory('admobClean', function(Util) {
        var obj = {};

        obj.createBannerView = function(success, error) {
            admob.createBannerView(success, error);
        };

        obj.destroyBannerView = function (success, error) {
            admob.destroyBannerView(success, error);
        };

        obj.showBannerAd = function(show, success, error) {
            admob.showBannerAd(show, success, error);
        };

        obj.init = function (options, success, error) {
            if ( !(window.admob) ) {
                error('there is not admob clean');
                return -1;
            }

            options.adSize = ionic.Platform.isIOS()?admob.AD_SIZE.SMART_BANNER:admob.AD_SIZE.BANNER;

            admob.setOptions({
                publisherId:    options.bannerAdUnit,
                interstitialAdId: options.interstitialAdUnit,
                adSize:         options.adSize,
                bannerAtTop:    false,
                overlap:        false,
                offsetStatusBar:    false,
                isTesting:  clientConfig.debug,
                adExtras :  {},
                autoShowBanner: false,
                autoShowInterstitial:   false
            }, success, error);

            document.addEventListener(admob.events.onAdFailedToLoad, function(message) {
                console.log('on banner Failed Receive Ad');
                Util.ga.trackEvent('plugin', 'error', 'admobReceiveAd '+message);
            });

            /**
             * param message
             */
            document.addEventListener(admob.events.onAdLoaded, function() {
                console.log('on banner receive Ad');
            });
        };

        return obj;
    });

