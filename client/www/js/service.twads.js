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
                admob.destroyBannerView(function () {
                    console.log('destroy banner view');
                }, function (e) {
                    console.log('Fail to destroy banner');
                    console.log(e);
                });
                obj.enableAds = enable;
                _setLayout(enable);
            }
            else {
                admob.createBannerView(function () {
                    console.log('create banner view');
                    obj.enableAds = enable;
                    _setLayout(enable);

                    if (obj.requestShow != undefined) {
                        obj.setShowAds(obj.requestShow);
                    }
                    else {
                        obj.setShowAds(obj.enableAds);
                    }

                }, function (e) {
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

            angular.element(document.getElementsByClassName('tabs')).css('margin-bottom', show?'50px':'0px');
            obj._setAdMobShowAd(show);
        };

        obj._setAdMobShowAd = function(show) {
            console.log('set ad mob show ='+show);

            if ( !(window.admob) ) {
                console.log('admob plugin not ready : set Enable Ads');
                return;
            }

            admob.showBannerAd(show, function () {
                console.log('show/hide about ad mob show='+show);
            }, function (e) {
                console.log('fail to show/hide about ad mob show='+show);
                console.log(JSON.stringify(e));
            });
        };

        return obj;
    })
    .run(function($ionicPlatform, TwAds, Util) {

        $ionicPlatform.ready(function() {
            //Purchase.setAccountLevel('lover');
            //#367
            //todo: height 기준으로 layout 재계산
            //todo: header hide상태를 해제하여 bannerAd가 overlap되도록 변경
            var runAdmob = true;

            if (!runAdmob) {
                console.log('admob is unused');
                return;
            }

            if ( !(window.admob) ) {
                console.log('ad mob plugin not ready');
                return;
            }

            if (TwAds.loaded == true) {
                console.log('TwAds is already loaded');
                return;
            }
            TwAds.loaded = true;

            var bannerAdUnit;
            var interstitialAdUnit;
            if (ionic.Platform.isIOS()) {
                bannerAdUnit = Util.admobIOSBannerAdUnit;
                interstitialAdUnit = Util.admobIOSInterstitialAdUnit;
            }
            else if (ionic.Platform.isAndroid()) {
                bannerAdUnit = Util.admobAndroidBannerAdUnit;
                interstitialAdUnit = Util.admobAndroidInterstitialAdUnit;
            }

            admob.setOptions({
                publisherId:          bannerAdUnit,  // Required
                interstitialAdId:     interstitialAdUnit,  // Optional
                adSize:               admob.AD_SIZE.BANNER,
                bannerAtTop:          false,
                overlap:              true,
                offsetStatusBar:      false,
                isTesting:            Util.isDebug(),
                adExtras :            {},
                autoShowBanner:       false,
                autoShowInterstitial: false,
            }, function () {
                console.log('Set options of admob');
                TwAds.loadTwAdsInfo();
            }, function (e) {
                console.log('Fail to set options of admob');
                console.log(e);
            });

            document.addEventListener(admob.events.onAdLoaded, function(message){
                console.log('on banner receive msg='+JSON.stringify(message));
            });

            document.addEventListener(admob.events.onAdFailedToLoad, function(message){
                console.log('on banner Failed Receive Ad msg='+JSON.stringify(message));
            });
        });
    });

