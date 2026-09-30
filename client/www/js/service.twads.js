/**
 * Created by aleckim on 2016. 4. 20..
 */

angular.module('service.twads', [])
    .factory('TwAds', function(Util, admobClean, admobPro, admobEmi, Monetization) {
        var obj = {};
        obj.enableAds = null;
        obj.showAds = null;
        obj.requestEnable = null;
        obj.requestShow = null;
        obj.ready = false;
        obj.bannerAdUnit = '';
        obj.interstitialAdUnit = '';
        var sessionStart = Date.now(), delayTimer, exposed = false, initialized = false, bannerLoaded = false;

        function applyVisibility() {
            if (delayTimer) { window.clearTimeout(delayTimer); delayTimer = null; }
            if (!obj.ready) { return; }
            var policy = Monetization.bannerPolicy();
            var requested = obj.requestShow != undefined ? obj.requestShow : obj.enableAds;
            var remaining = policy.delaySeconds * 1000 - (Date.now() - sessionStart);
            var eligible = requested === true && obj.enableAds === true && policy.enabled && bannerLoaded;
            var show = eligible && remaining <= 0;
            if (requested && obj.enableAds && policy.enabled && remaining > 0) {
                delayTimer = window.setTimeout(applyVisibility, remaining);
            }
            if (eligible && !exposed) {
                exposed = true;
                Monetization.track('ad_policy_exposure', {delay_seconds: policy.delaySeconds});
            }
            if (obj.showAds === show) { return; }
            obj.showAds = show;
            obj._setAdMobShowAd(show);
        }

        obj.onAdapterReady = function () {
            this.ready = true;
            this.setEnableAds(this.requestEnable != undefined ? this.requestEnable : true);
        };

        obj._admobCreateBanner = function() {
            var self = this;
            if (self.admob == undefined) {
                console.log('admob is undefined');
                return;
            }
            self.admob.createBannerView(
                function () {
                    bannerLoaded = true;
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
            }
            else {
                self.enableAds = enable;
                self._admobCreateBanner();
            }
        };

        obj.setShowAds = function(show) {
            var self = this;
            console.log('set show ads show='+show);

            self.requestShow = show;
            if (self.ready != true) {
                console.log('set show ads called before ready');
                self.requestShow = show;
                return;
            }

            if (self.enableAds === false && show === true) {
               console.log('TwAds is not enabled');
                return;
            }

            applyVisibility();
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

            if (initialized) { return; }
            initialized = true;
            Monetization.loadConfig(applyVisibility);

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
                    self.onAdapterReady();
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
                    self.onAdapterReady();
                },
                function (e) {
                    // Util.ga.trackException(e, false);
                });

            admobEmi.init({
                bannerAdUnit: self.bannerAdUnit,
                interstitialAdUnit: self.interstitialAdUnit },
                function () {
                    self.admob = admobEmi;
                    console.log('Set options of emi AdMob');
                    self.onAdapterReady();
                },
                function (e) {
                    Util.ga.trackException(e, false);
                });
            window.addEventListener("orientationchange", function(){
                console.log('orientationType', screen.orientation.type); // e.g. portrait
                if (self.enableAds === true) {
                    bannerLoaded = false;
                    self.admob.destroyBannerView(function () {
                        self.admob.createBannerView(function () {
                            bannerLoaded = true;
                            // Force a reapply after recreation, using the current config and screen intent.
                            self.showAds = null;
                            applyVisibility();
                        });
                    });
                }
            });
        };
        return obj;
    });
