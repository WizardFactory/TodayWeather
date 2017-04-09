angular.module('controller.guidectrl', [])
    .controller('GuideCtrl', function($scope, $rootScope, $ionicSlideBoxDelegate, $ionicNavBarDelegate,
                                      $location, Util, TwAds, $ionicPopup, WeatherInfo, $translate, Purchase) {
        var guideVersion = null;

        $scope.data = { 'autoSearch': true };

        var strClose = "Close";
        var strSkip = "Skip";
        var strCancel = "Cancel";
        var strOkay = "OK";
        var strUseYourCurrentLocation = "Use your current location";
        var strFindLocationByName = "Find location by name";
        var strTodayWeather = "TodayWeather";

        function _setShowAds(show) {
            if (show == true && Purchase.accountLevel == Purchase.ACCOUNT_LEVEL_FREE) {
                TwAds.setShowAds(true);
            }
            else if (show == false) {
                TwAds.setShowAds(false);
            }
        }

        function init() {
            if (window.cordova && window.cordova.plugins && window.cordova.plugins.diagnostic) {
                cordova.plugins.diagnostic.isLocationEnabled(function (enabled) {
                    console.log("guidectrl location setting is " + (enabled ? "enabled" : "disabled"));
                    $scope.data.autoSearch = enabled;
                }, function (error) {
                    console.log("The following error occurred: "+error);
                    Util.ga.trackEvent('position', 'error', 'isLocationEnabled');
                    Util.ga.trackException(error, false);
                });
            }

            //for fast close ads when first loading
            _setShowAds(false);

            var bodyHeight;

            if (window.screen.height) {
                bodyHeight = window.screen.height;
            }
            else if (window.innerHeight) {
                bodyHeight = window.innerHeight;
            }
            else if (window.outerHeight) {
                bodyHeight = window.outerHeight;
            }
            else {
                console.log("Fail to get window height");
                bodyHeight = 640;
            }

            $scope.bigFont = (bodyHeight - 56) * 0.0512;
            $scope.smallFont = (bodyHeight - 56) * 0.0299;

            guideVersion = localStorage.getItem("guideVersion");

            $translate(['LOC_TODAYWEATHER', 'LOC_CLOSE', 'LOC_SKIP', 'LOC_CANCEL', 'LOC_OK',
                'LOC_USE_YOUR_CURRENT_LOCATION', 'LOC_FIND_LOCATION_BY_NAME']).then(function (translations) {
                strTodayWeather = translations.LOC_TODAYWEATHER;
                strClose = translations.LOC_CLOSE;
                strSkip = translations.LOC_SKIP;
                strCancel = translations.LOC_CANCEL;
                strOkay = translations.LOC_OK;
                strUseYourCurrentLocation = translations.LOC_USE_YOUR_CURRENT_LOCATION;
                strFindLocationByName = translations.LOC_FIND_LOCATION_BY_NAME;
            }, function (translationIds) {
                console.log("Fail to translate : " + JSON.stringify(translationIds));
            }).finally(function () {
                update();
            });
        }

        function close() {
            if (guideVersion === null) {
                showPopup();
            } else {
                if (Util.guideVersion == Number(guideVersion)) {
                    _setShowAds(true);
                    $location.path('/tab/setting');
                } else {
                    localStorage.setItem("guideVersion", Util.guideVersion.toString());
                    _setShowAds(true);
                    $location.path('/tab/forecast');
                }
            }
        }

        function update() {
            if ($ionicSlideBoxDelegate.currentIndex() == $ionicSlideBoxDelegate.slidesCount() - 1) {
                $scope.leftText = "<";
                $scope.rightText = strClose;
            } else {
                $scope.leftText = strSkip;
                $scope.rightText = ">";
            }
        }

        function showPopup() {
            Util.ga.trackEvent('window', 'show', 'firstPopup');
            var popup = $ionicPopup.show({
                template: '<ion-list>' +
                    '<ion-radio ng-model="data.autoSearch" ng-value="true">'+strUseYourCurrentLocation+'</ion-radio>' +
                    '<ion-radio ng-model="data.autoSearch" ng-value="false">'+strFindLocationByName+'</ion-radio>' +
                    '</ion-list>',
                title: strTodayWeather,
                scope: $scope,
                cssClass: 'ionic_popup',
                buttons: [
                    {
                        text: strCancel
                    },
                    {
                        text: strOkay,
                        type: 'button-positive',
                        onTap: function() {
                            return $scope.data.autoSearch;
                        }
                    }
                ]
            });

            popup.then(function(res) {
                if (res === undefined) { // cancel button
                    Util.ga.trackEvent('action', 'click', 'cancel');
                    return;
                }

                localStorage.setItem("guideVersion", Util.guideVersion.toString());
                _setShowAds(true);
                if (res === true) { // autoSearch
                    Util.ga.trackEvent('action', 'click', 'auto search');
                    WeatherInfo.disableCity(false);
                    $location.path('/tab/forecast');
                } else {
                    Util.ga.trackEvent('action', 'click', 'city search');
                    $location.path('/tab/search');
                }
            });
        }

        $scope.onSlideChanged = function() {
            update();
        };

        $scope.onLeftClick = function() {
            if ($ionicSlideBoxDelegate.currentIndex() == $ionicSlideBoxDelegate.slidesCount() - 1) {
                Util.ga.trackEvent('action', 'click', 'guide previous');
                $ionicSlideBoxDelegate.previous();
            } else {
                Util.ga.trackEvent('action', 'click', 'guide skip');
                close();
            }
        };

        $scope.onRightClick = function() {
            if ($ionicSlideBoxDelegate.currentIndex() == $ionicSlideBoxDelegate.slidesCount() - 1) {
                Util.ga.trackEvent('action', 'click', 'guide close');
                close();
            } else {
                Util.ga.trackEvent('action', 'click', 'guide next');
                $ionicSlideBoxDelegate.next();
            }
        };

        $scope.onClose = function() {
            Util.ga.trackEvent('action', 'click', 'guide top close');
            close();
        };

        $scope.getGuideImg = function (number) {
            var imgPath;
            if (ionic.Platform.isAndroid()) {
                imgPath = "img/guide_android_0";
            }
            else {
                imgPath = "img/guide-0";
            }
            imgPath += ""+number+".png";
            console.log(imgPath);

            return imgPath;
        };

        $scope.$on('$ionicView.leave', function() {
            _setShowAds(true);
        });

        $scope.$on('$ionicView.enter', function() {
            _setShowAds(false);
            $ionicSlideBoxDelegate.slide(0);
        });

        init();
    });

