/**
 * Created by aleckim on 2016. 4. 20..
 */

angular.module('service.twads', [])
    .factory('TwAds', function($rootScope, Util) {
        var obj = {};
        obj.enableAds;
        obj.showAds;
        obj.requestEnable;
        obj.requestShow;
        obj.loaded = false;
        obj.ready = false;
        obj.bannerAdUnit = '';
        obj.interstitialAdUnit = '';

        obj.loadTwAdsInfo = function () {
            var twAdsInfo = JSON.parse(localStorage.getItem("twAdsInfo"));
            console.log('load TwAdsInfo='+JSON.stringify(twAdsInfo)+
                        ' request enable='+obj.requestEnable+' show='+obj.requestShow);

            obj.ready = true;

            if (obj.requestEnable != undefined) {
                obj.setEnableAds(obj.requestEnable);
            }
            else {
                if (twAdsInfo == undefined || twAdsInfo.enable == undefined) {
                    obj.setEnableAds(true);
                }
                else {
                    obj.setEnableAds(twAdsInfo.enable);
                }
            }
        };

        obj.saveTwAdsInfo = function (enable) {
            var twAdsInfo = {enable: enable};
            localStorage.setItem("twAdsInfo", JSON.stringify(twAdsInfo));
        };

        function _setLayout(enable) {
            //close bottom box
            $rootScope.viewAdsBanner = enable;
            $rootScope.contentBottom = enable?100:50;
            angular.element(document.getElementsByClassName('tabs')).css('margin-bottom', enable?'50px':'0px');
        }

        obj.setEnableAds = function (enable) {
            console.log('set enable ads enable='+enable);
            if (enable == obj.enableAds)  {
                console.log('already TwAds is enable='+enable);
                return;
            }

            if (obj.ready != true) {
                console.log('set enable ads called before ready');
                obj.requestEnable = enable;
                return;
            }

            if (enable === false) {
                obj.setShowAds(false);
                AdMob.removeBanner(function () {
                    console.log('destroy banner view');
                }, function (e) {
                    console.log('Fail to destroy banner');
                    console.log(e);
                });
                obj.enableAds = enable;
                _setLayout(enable);
            }
            else {
                AdMob.createBanner({
                        adId: obj.bannerAdUnit,
                        autoShow:       false
                    },
                    function () {
                        console.log('create banner view');
                        obj.enableAds = enable;
                        _setLayout(enable);

                        if (obj.requestShow != undefined) {
                            obj.setShowAds(obj.requestShow);
                        }
                        else {
                            obj.setShowAds(obj.enableAds);
                        }

                    },
                    function (e) {
                        console.log('Fail to create banner view');
                        console.log(e);
                    });
            }
        };

        obj.setShowAds = function(show) {
            console.log('set show ads show='+show);
            if(obj.showAds === show) {
                console.log('already TwAds is show='+show);
                return;
            }
            if (obj.ready != true) {
                console.log('set show ads called before ready');
                obj.requestShow = show;
                return;
            }

            if (obj.enableAds === false && show === true) {
               console.log('TwAds is not enabled');
                return;
            }

            obj.showAds = show;
            obj._setAdMobShowAd(show);
        };

        obj._setAdMobShowAd = function(show) {
            console.log('set ad mob show ='+show);

            if ( !(window.AdMob) ) {
                console.log('Admob plugin not ready : set Enable Ads');
                return;
            }

            if (show === true) {
                AdMob.showBanner(AdMob.AD_POSITION.BOTTOM_CENTER, function () {
                    console.log('show about ad mob show='+show);
                }, function (e) {
                    console.log('fail to show about ad mob show='+show);
                    console.log(JSON.stringify(e));
                });
            }
            else {
                AdMob.hideBanner(function () {
                    console.log('hide about ad mob show='+show);
                }, function (e) {
                    console.log('fail to hide about ad mob show='+show);
                    console.log(JSON.stringify(e));
                });
            }
        };

        return obj;
    })
    .run(function($ionicPlatform, TwAds, Util) {

        $ionicPlatform.ready(function() {
            var runAdmob = true;

            if (!runAdmob) {
                console.log('Ad mob is unused');
                return;
            }

            if ( !(window.AdMob) ) {
                console.log('ad mob plugin not ready');
                return;
            }

            if (TwAds.loaded == true) {
                console.log('TwAds is already loaded');
                return;
            }
            TwAds.loaded = true;

            if (ionic.Platform.isIOS()) {
                TwAds.bannerAdUnit = Util.admobIOSBannerAdUnit;
                TwAds.interstitialAdUnit = Util.admobIOSInterstitialAdUnit;
            }
            else if (ionic.Platform.isAndroid()) {
                TwAds.bannerAdUnit = Util.admobAndroidBannerAdUnit;
                TwAds.interstitialAdUnit = Util.admobAndroidInterstitialAdUnit;
            }

            AdMob.setOptions({
                adSize:         'BANNER',
                overlap:        true,
                isTesting:      Util.isDebug(),
                autoShow:       false,
            }, function () {
                console.log('Set options of Ad mob');
                TwAds.loadTwAdsInfo();
            }, function (e) {
                console.log('Fail to set options of Ad mob');
                console.log(e);
            });

            document.addEventListener('onAdFailLoad',function(data){
                console.log('on Failed Load Ad msg='+JSON.stringify(data));
                //if(data.adType == 'banner') AdMob.hideBanner();
                //else if(data.adType == 'interstitial') interstitialIsReady = false;
            });

            document.addEventListener('onAdLoaded',function(data){
                if(data.adType == 'banner')  {
                    if (TwAds.showAds === true) {
                       TwAds._setAdMobShowAd(true);
                    }
                }
                else if(data.adType == 'interstitial') {
                    //interstitialIsReady = true;
                }
            });

            document.addEventListener('onAdPresent',function(data){
                console.log('on Ad present msg='+JSON.stringify(data));
            });

        });
    });

