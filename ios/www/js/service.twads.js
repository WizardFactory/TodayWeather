/**
 * Created by aleckim on 2016. 4. 20..
 */

angular.module('service.twads', [])
    .factory('TwAds', function($rootScope, Util) {
        var obj = {};
        obj.enableAds = null;
        obj.showAds = null;
        obj.requestEnable = null;
        obj.requestShow = null;
        obj.ready = false;
        obj.bannerAdUnit = '';
        obj.interstitialAdUnit = '';

        obj.loadTwAdsInfo = function () {
            var self = this;
            var twAdsInfo = JSON.parse(localStorage.getItem("twAdsInfo"));
            console.log('load TwAdsInfo='+JSON.stringify(twAdsInfo)+
                        ' request enable='+self.requestEnable+' show='+self.requestShow);

            self.ready = true;

            if (self.requestEnable != undefined) {
                self.setEnableAds(self.requestEnable);
            }
            else {
                if (twAdsInfo == undefined || twAdsInfo.enable == undefined) {
                    self.setEnableAds(true);
                }
                else {
                    self.setEnableAds(twAdsInfo.enable);
                }
            }
        };

        obj.saveTwAdsInfo = function (enable) {
            var twAdsInfo = {enable: enable};
            localStorage.setItem("twAdsInfo", JSON.stringify(twAdsInfo));
        };

        obj._admobCreateBanner = function() {
            var self = this;
            admob.createBannerView(
                function () {
                    console.log('create banner view');
                    if (self.requestShow != undefined) {
                        self.setShowAds(self.requestShow);
                    }
                    else {
                        self.setShowAds(self.enableAds);
                    }

                },
                function (e) {
                    console.log('Fail to create banner view');
                    console.log(e);
                    Util.ga.trackEvent('plugin', 'error', 'admobCreateBanner');
                    Util.ga.trackException(e, false);
                });
        };

        obj.setEnableAds = function (enable) {
            var self = this;
            console.log('set enable ads enable='+enable);
            if (enable == self.enableAds)  {
                console.log('already TwAds is enable='+enable);
                return;
            }

            if (self.ready != true) {
                console.log('set enable ads called before ready');
                self.requestEnable = enable;
                return;
            }

            if (enable === false) {
                self.setShowAds(false);

                admob.destroyBannerView(function () {
                    console.log('destroy banner view');
                }, function (e) {
                    console.log('Fail to destroy banner');
                    console.log(e);
                    Util.ga.trackEvent('plugin', 'error', 'admobDestroyBanner');
                    Util.ga.trackException(e, false);
                });

                self.enableAds = enable;
                Util.ga.trackEvent('app', 'account', 'premium');
            }
            else {
                self.enableAds = enable;
                self._admobCreateBanner();
                Util.ga.trackEvent('app', 'account', 'free');
            }
        };

        obj.setShowAds = function(show) {
            var self = this;
            console.log('set show ads show='+show);

            if(self.showAds === show) {
                console.log('already TwAds is show='+show);
                return;
            }
            if (self.ready != true) {
                console.log('set show ads called before ready');
                self.requestShow = show;
                return;
            }

            if (self.enableAds === false && show === true) {
               console.log('TwAds is not enabled');
                return;
            }

            self.showAds = show;
            self._setAdMobShowAd(show);
        };

        obj._setAdMobShowAd = function(show) {
            console.log('set ad mob show ='+show);

            if ( !(window.admob) ) {
                console.log('Admob plugin not ready : set Enable Ads');
                return;
            }

            admob.showBannerAd(show, function () {
                console.log('show/hide about ad mob show='+show);
            }, function (e) {
                console.log('fail to show about ad mob show='+show);
                console.log(JSON.stringify(e));
                Util.ga.trackEvent('plugin', 'error', 'admobShowBanner');
                Util.ga.trackException(e, false);
            });
        };

        obj.init = function () {
            var self = this;
            if ( !(window.admob) ) {
                console.log('ad mob plugin not ready');
                //for ads app without inapp and paid app
                if (self.requestEnable != undefined) {
                    console.log('set requestEnable='+self.requestEnable);
                    self.setShowAds(self.requestEnable);
                }
                Util.ga.trackEvent('plugin', 'error', 'loadAdmob');
                return;
            }

            if (ionic.Platform.isIOS()) {
                self.bannerAdUnit = twClientConfig.admobIOSBannerAdUnit;
                self.interstitialAdUnit = twClientConfig.admobIOSInterstitialAdUnit;
            }
            else if (ionic.Platform.isAndroid()) {
                self.bannerAdUnit = twClientConfig.admobAndroidBannerAdUnit;
                self.interstitialAdUnit = twClientConfig.admobAndroidInterstitialAdUnit;
            }

            var adSize = ionic.Platform.isIOS()?admob.AD_SIZE.SMART_BANNER:admob.AD_SIZE.BANNER;

            admob.setOptions({
                publisherId:    self.bannerAdUnit,
                interstitialAdId: self.interstitialAdUnit,
                adSize:         adSize,
                bannerAtTop:    false,
                overlap:        false,
                offsetStatusBar:    false,
                isTesting:  twClientConfig.debug,
                adExtras :  {},
                autoShowBanner: false,
                autoShowInterstitial:   false
            }, function () {
                console.log('Set options of Ad mob');
                self.loadTwAdsInfo();
            }, function (e) {
                console.log('Fail to set options of Ad mob');
                console.log(e);
                Util.ga.trackException('setAdmobOptions', 'error', e);
                Util.ga.trackException(e, false);
            });

            document.addEventListener(admob.events.onAdFailedToLoad,function(message){
                console.log('on banner Failed Receive Ad');
                Util.ga.trackEvent('plugin', 'error', 'admobReceiveAd '+message);
            });

            /**
             * param message
             */
            document.addEventListener(admob.events.onAdLoaded,function(){
                console.log('on banner receive Ad');
            });
        };
        return obj;
    });
