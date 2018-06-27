/**
 * Created by aleckim on 2016. 4. 20..
 */

angular.module('service.twads', [])
    .factory('TwAds', function(TwStorage, Util, admobClean, admobPro) {
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
            var twAdsInfo = TwStorage.get("twAdsInfo");
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
            TwStorage.set("twAdsInfo", twAdsInfo);
        };

        obj._admobCreateBanner = function() {
            var self = this;
            if (self.admob == undefined) {
                console.log('admob is undefined');
                return;
            }
            self.admob.createBannerView(
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

                if (self.admob == undefined) {
                    console.log('admob is undefined');
                    return;
                }
                self.admob.destroyBannerView(function () {
                    console.log('destroy banner view');
                }, function (e) {
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
            var self = this;
            console.log('set ad mob show ='+show);

            if (self.admob == undefined) {
                console.log('admob is undefined');
                return;
            }
            self.admob.showBannerAd(show, function () {
                console.log('show/hide about ad mob show='+show);
            }, function (e) {
                Util.ga.trackException(e, false);
            });
        };

        obj.init = function () {
            var self = this;

            if (ionic.Platform.isIOS()) {
                self.bannerAdUnit = clientConfig.admobIOSBannerAdUnit;
                self.interstitialAdUnit = clientConfig.admobIOSInterstitialAdUnit;
            }
            else if (ionic.Platform.isAndroid()) {
                self.bannerAdUnit = clientConfig.admobAndroidBannerAdUnit;
                self.interstitialAdUnit = clientConfig.admobAndroidInterstitialAdUnit;
            }

            admobPro.init(
                { bannerAdUnit: self.bannerAdUnit, interstitialAdUnit: self.interstitialAdUnit },
                function () {
                    self.admob = admobPro;
                    console.log('Set options of Ad mob clean');
                    self.loadTwAdsInfo();
                },
                function (e) {
                    Util.ga.trackException(e, false);
                });

            admobClean.init({
                bannerAdUnit: self.bannerAdUnit,
                interstitialAdUnit: self.interstitialAdUnit },
                function () {
                    self.admob = admobClean;
                    console.log('Set options of Ad mob clean');
                    self.loadTwAdsInfo();
                },
                function (e) {
                    // Util.ga.trackException(e, false);
                });

            window.addEventListener("orientationchange", function(){
                console.log('orientationType', screen.orientation.type); // e.g. portrait
                if (self.enableAds === true) {
                    self.admob.destroyBannerView(function () {
                        self.admob.createBannerView(function () {
                            self.admob.showBannerAd(self.showAds);
                        });
                    });
                }
            });
        };
        return obj;
    });
