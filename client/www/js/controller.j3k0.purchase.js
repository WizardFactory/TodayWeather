/**
 * https://github.com/WizardFactory/TodayWeather/issues/524
 * Created by aleckim on 2016. 4. 11..
 */

angular.module('controller.purchase', [])
    .factory('Purchase', function($rootScope, $http, $q, TwAds, Util, $translate) {
        var obj = {};
        obj.ACCOUNT_LEVEL_FREE = 'free';
        obj.ACCOUNT_LEVEL_PREMIUM = 'premium';
        obj.ACCOUNT_LEVEL_PAID = 'paid';
        obj.accountLevel = null;
        obj.productId = null;
        obj.expirationDate = null;
        obj.products = null;
        obj.hasInAppPurchase = false;
        obj.paidAppUrl='';

        if (twClientConfig.isPaidApp) {
            obj.accountLevel = obj.ACCOUNT_LEVEL_PAID;
            TwAds.setEnableAds(false);
        }

        obj.setAccountLevel = function (accountLevel) {
            var self = this;
            if (self.accountLevel != accountLevel) {
                console.log('set account level ='+accountLevel);
                //update accountLevel
                self.accountLevel = accountLevel;
                if (accountLevel === self.ACCOUNT_LEVEL_FREE) {
                    TwAds.setEnableAds(true);
                }
                else if (accountLevel === self.ACCOUNT_LEVEL_PREMIUM) {
                    TwAds.setEnableAds(false);
                }
            }
            else {
                console.log('account level is already set level='+accountLevel);
            }
        };

        obj._loadPurchaseInfo = function (purchaseInfo) {
            var self = this;
            if (purchaseInfo == undefined || purchaseInfo == '') {
                return self.setAccountLevel(self.ACCOUNT_LEVEL_FREE);
            }

            console.log('load purchaseInfo='+JSON.stringify(purchaseInfo));
            self.expirationDate = purchaseInfo.expirationDate;
            //check account date
            if ((new Date(purchaseInfo.expirationDate)).getTime() < Date.now()) {
                console.log('account expired, please renewal or restore');
                Util.ga.trackEvent('purchase', 'expired', 'subscribeExpired '+purchaseInfo.expirationDate);
                purchaseInfo.accountLevel = self.ACCOUNT_LEVEL_FREE;
            }
            self.setAccountLevel(purchaseInfo.accountLevel);
        };

        obj.loadPurchaseInfo = function (callback) {
            var purchaseInfo;
            var self = this;
            if (callback == undefined) {
                console.log('callback is undefined');
                return;
            }

            if (window.plugins == undefined || plugins.appPreferences == undefined) {
                console.log('load purchase info');
                purchaseInfo = JSON.parse(localStorage.getItem("purchaseInfo"));
                self._loadPurchaseInfo(purchaseInfo);
                return callback();
            }

            var suitePrefs = plugins.appPreferences.suite(Util.suiteName);

            suitePrefs.fetch(
                function (value) {
                    console.log("fetch preference Success: " + value);
                    try {
                        self._loadPurchaseInfo.call(self, JSON.parse(value));
                        callback(null, value);
                    }
                    catch(e) {
                        callback(e);
                    }
                },
                function (error) {
                    console.log("fetch preference Error: " + error);
                    callback(error);
                },
                "purchaseInfo");
        };

        obj.savePurchaseInfo = function (accountLevel, expirationDate, callback) {

            callback = callback || function() {};

            var purchaseInfo = {accountLevel: accountLevel, expirationDate: expirationDate};
            if (purchaseInfo.accountLevel === obj.ACCOUNT_LEVEL_PREMIUM) {
                TwAds.saveTwAdsInfo(false);
            }
            else {
                TwAds.saveTwAdsInfo(true);
            }

            if (window.plugins == undefined || plugins.appPreferences == undefined) {
                localStorage.setItem("purchaseInfo", JSON.stringify(purchaseInfo));
                return callback();
            }

            var suitePrefs = plugins.appPreferences.suite(Util.suiteName);

            suitePrefs.store(function (value) {
                console.log("save preference Success: " + value);
                callback();
            }, function (error) {
                console.log("save preference Error: " + error);
                callback(error);
            }, 'purchaseInfo', JSON.stringify(purchaseInfo));
        };

        obj.init = function () {
            var self = this;
            self.loadPurchaseInfo(function () {
                console.log('load purchase info');
            });

            self.productId = 'tw1year';

            if (!window.store) {
                Util.ga.trackEvent('purchase', 'unused');
                if (self.paidAppUrl.length > 0) {
                    $translate('LOC_GET_PREMIUM_TO_REMOVE_ADS').then(function (bannerMessage) {
                        $rootScope.adsBannerMessage = bannerMessage;
                    }, function (translationId) {
                        $rootScope.adsBannerMessage = translationId;
                    });
                    $rootScope.clickAdsBanner = function() {
                        $location.path('/purchase');
                    };
                }
                else {
                    $translate('LOC_TODAYWEATHER').then(function (bannerMessage) {
                        $rootScope.adsBannerMessage = bannerMessage;
                    }, function (translationId) {
                        $rootScope.adsBannerMessage = translationId;
                    });
                    $rootScope.clickAdsBanner = function() {};
                }
                self.setAccountLevel(self.ACCOUNT_LEVEL_FREE);
                return;
            }

            self.hasInAppPurchase = true;
            $translate('LOC_GET_PREMIUM_TO_REMOVE_ADS').then(function (bannerMessage) {
                $rootScope.adsBannerMessage = bannerMessage;
            }, function (translationId) {
                $rootScope.adsBannerMessage = translationId;
            });
            $rootScope.clickAdsBanner = function() {
                $location.path('/purchase');
            };

            store.verbosity = store.DEBUG;

            // Enable remote receipt validation
            store.validator = twClientConfig.serverUrl+"/v000705"+"/check-purchase";

            store.register({
                id: self.productId,
                alias: self.productId,
                type: store.PAID_SUBSCRIPTION
            });

            // Log all errors
            store.error(function(error) {
                console.log('ERROR ' + error.code + ': ' + error.message);
            });

            store.ready(function () {
                console.log("store ready!");
            });

            store.refresh();

            store.when("product").updated(function (p) {
                console.log(JSON.stringify(p));
                self.products = p;
            });

            store.when(self.productId).approved(function(p) {
                console.log("verify subscription");
                //p.finish();
                p.verify().success(function (p, data) {
                    console.log("verify success") ;
                    console.log('You are a lucky subscriber!');
                    self.expirationDate = data.expires_date;
                    self.setAccountLevel(self.ACCOUNT_LEVEL_PREMIUM);
                    self.savePurchaseInfo(self.accountLevel, self.expirationDate);
                }).expired(function (p) {
                    console.log("verify expired") ;
                    self.setAccountLevel(self.ACCOUNT_LEVEL_FREE);
                    self.savePurchaseInfo(self.accountLevel, self.expirationDate);
                }).error(function (err) {
                    console.log("verify error") ;
                }).done(function (p) {
                    console.log("verify done") ;
                    p.finish();
                });
            });
        };

        return obj;
    })
    .run(function(Purchase) {
       Purchase.init();
    })
    .controller('PurchaseCtrl', function($scope, $ionicHistory, $ionicLoading, Util, Purchase, TwAds, $translate) {

        if (ionic.Platform.isIOS()) {
            Util.ga.trackEvent('plugin', 'error', 'PurchaseCtrlOnIOS');
            return;
        }

        var spinner = '<ion-spinner icon="dots" class="spinner-stable"></ion-spinner><br/>';

        var strPurchaseError = "Purchase error";
        var strFailToConnectServer = "Fail to connect validation server.";
        var strPleaseRestoreAfter = "Please restore after 1~2 minutes";
        var strRestoringPurchases = "Restoring Purchases...";
        var strRestoreError = "Restore error";
        var strPurchasing = "Purchasing...";
        $translate(['LOC_PURCHASE_ERROR', 'LOC_FAIL_TO_CONNECT_VALIDATION_SERVER', 'LOC_PLEASE_RESTORE_AFTER_1_2_MINUTES',
            'LOC_RESTORING_PURCHASES', 'LOC_RESTORE_ERROR', 'LOC_PURCHASING']).then(function (translations) {
            strPurchaseError = translations.LOC_PURCHASE_ERROR;
            strFailToConnectServer = translations.LOC_FAIL_TO_CONNECT_VALIDATION_SERVER;
            strPleaseRestoreAfter = translations.LOC_PLEASE_RESTORE_AFTER_1_2_MINUTES;
            strRestoringPurchases = translations.LOC_RESTORING_PURCHASES;
            strRestoreError = translations.LOC_RESTORE_ERROR;
            strPurchasing = translations.LOC_PURCHASING;
        }, function (translationIds) {
           console.log("Fail to translations "+JSON.stringify(translationIds));
        });

        $scope.order = function () {
            $ionicLoading.show({ template: spinner + strPurchasing });
            console.log('subscribe product='+Purchase.productId);
            if (window.store) {
                store.order(Purchase.productId);
                Util.ga.trackEvent('purchase', 'order', 'subscribe');
            }
            else {

            }
        };

        /**
         * android의 경우 자동 복원되기 때문에 필요없음
         */
        $scope.restore = function () {
            if (window.store) {
                store.refresh();
            }
            else {

            }
        };

        $scope.goBack = function() {
            if ($scope.accountLevel == Purchase.ACCOUNT_LEVEL_PREMIUM) {
                TwAds.setShowAds(false);
            }
            else {
                TwAds.setShowAds(true);
            }
            $ionicHistory.goBack();
        };

        $scope.$on('$ionicView.leave', function() {
            if ($scope.accountLevel == Purchase.ACCOUNT_LEVEL_PREMIUM) {
                TwAds.setShowAds(false);
            }
            else {
                TwAds.setShowAds(true);
            }
        });

        $scope.$on('$ionicView.enter', function() {
            TwAds.setShowAds(false);
            if (window.StatusBar) {
                StatusBar.backgroundColorByHexString('#0288D1');
            }
        });

        function init() {
            var expirationDate = new Date(Purchase.expirationDate);
            var showRenewDate = new Date();

            //for fast close ads when first loading
            TwAds.setShowAds(false);
            $scope.accountLevel = Purchase.accountLevel;
            $scope.expirationDate = expirationDate.toLocaleDateString();

            //Todo: check expire date for ios, check autoRenewing and expire date for android
            showRenewDate.setMonth(showRenewDate.getMonth()+3);

            if (expirationDate.getTime() <= showRenewDate.getTime()) {
                $scope.showRenew = true;
            }
            else {
                $scope.showRenew = false;
            }

            if (!window.store) {
                //for develop mode
                $scope.product = {title:'프리미엄',  price: '$1.09', description: '지금 바로 프리미엄 서비스를 신청하시고, 1년간 광고 없이 사용하세요.'};
            }
            else {
                if (Purchase.products && Purchase.products.length) {
                    $scope.product = Purchase.products[0];
                }
                else {
                    console.log("Failed to get product info at start");
                }
            }

            $scope.listWidth = window.innerWidth;
        }

        init();
    });
