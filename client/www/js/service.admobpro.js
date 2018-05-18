/**
 * Created by aleckim on 2018. 5. 14.
 */

angular.module('service.admobpro', [])
    .factory('admobPro', function(Util) {
        var obj = {};

        obj.createBannerView = function(success, error) {
            AdMob.createBanner(this.options.bannerAdUnit, success, error);
        };

        obj.destroyBannerView = function (success, error) {
            AdMob.removeBanner(success, error);
        };

        obj.showBannerAd = function(show, success, error) {
            if (show == true) {
                AdMob.showBanner(AdMob.AD_POSITION.BOTTOM_CENTER, success, error);
            }
            else {
                AdMob.hideBanner(success, error);
            }
        };

        obj.init = function (options, success, error) {
            if ( !(window.AdMob) ) {
                error('there is not admob pro');
                return -1;
            }
            options.adSize = ionic.Platform.isIOS()?'SMART_BANNER':'BANNER';
            this.options = options;

            AdMob.setOptions({
                adSize:         options.adSize,
                position: AdMob.AD_POSITION.BOTTOM_CENTER,
                overlap:        false,
                isTesting:  clientConfig.debug,
                autoShow: true
            }, success, error);

            document.addEventListener('onAdFailLoad',function(message){
                console.log('on banner Failed Receive Ad');
                Util.ga.trackEvent('plugin', 'error', 'admobProReceiveAd '+message);
            });
        };

        return obj;
    });

