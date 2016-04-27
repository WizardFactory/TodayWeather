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

            if (obj.requestShow != undefined) {
                obj.setShowAds(obj.requestShow);
            }
            else {
                obj.setShowAds(obj.enableAds);
            }
        };

        obj.saveTwAdsInfo = function (enable) {
            var twAdsInfo = {enable: enable};
            localStorage.setItem("twAdsInfo", JSON.stringify(twAdsInfo));
        };

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
            }
            obj.enableAds = enable;

            //close bottom box
            $rootScope.viewAdsBanner = obj.enableAds;
            $rootScope.contentBottom = obj.enableAds?100:50;
            angular.element(document.getElementsByClassName('tabs')).css('margin-bottom', obj.enableAds?'50px':'0px');
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

            if ( !(admob) ) {
                console.log('admob plugin not ready : set Enable Ads');
                return;
            }

            if (show) {
                var admobParam = new admob.Params();
                admobParam.isTesting = Util.isDebug();

                admob.showBanner(admob.BannerSize.BANNER, admob.Position.BOTTOM_CENTER, admobParam, function () {

                }, function (e) {
                    console.log('fail to show ad mob');
                    console.log(JSON.stringify(e));
                });
            }
            else {
                admob.hideBanner(function () {

                }, function (e) {
                    console.log('fail to hide ad mob');
                    console.log(JSON.stringify(e));
                });
            }
        };

        return obj;
    })
    .run(function($ionicPlatform, TwAds) {

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

            if ( !(admob) ) {
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
                bannerAdUnit = 'ca-app-pub-3300619349648096/7636193363';
                interstitialAdUnit = 'ca-app-pub-3300619349648096/3066392962';
            }
            else if (ionic.Platform.isAndroid()) {
                bannerAdUnit = 'ca-app-pub-3300619349648096/9569086167';
                interstitialAdUnit = 'ca-app-pub-3300619349648096/2045819361';
            }
            admob.initAdmob(bannerAdUnit, interstitialAdUnit, function () {
                console.log('init admob');
                TwAds.loadTwAdsInfo();
            }, function (e) {
                console.log('fail to init admob : '+ e);
            });

            document.addEventListener(admob.Event.onBannerReceive, function(message){
                console.log('on banner receive msg='+JSON.stringify(message));
            });

            document.addEventListener(admob.Event.onBannerFailedReceive, function(message){
                console.log('on banner Failed Receive Ad msg='+JSON.stringify(message));
            });
        });
    });

