/**
 * https://github.com/WizardFactory/TodayWeather/issues/524
 * Created by aleckim on 2016. 4. 11..
 */

angular.module('controller.purchase', [])
    .factory('Purchase', function($http, $q, TwAds, TwStorage, Util) {
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

        if (clientConfig.isPaidApp) {
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
            var self = this;
            if (callback == undefined) {
                console.log('callback is undefined');
                return;
            }

            console.log('load purchase info');
            var purchaseInfo = TwStorage.get("purchaseInfo");
            self._loadPurchaseInfo(purchaseInfo);
            return callback();
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

            TwStorage.set("purchaseInfo", purchaseInfo);
            return callback();
        };

        obj.restore = function () {
            store.refresh();
        };

        obj.order = function () {
            store.order(this.productId);
        };

        obj.init = function () {
            var self = this;
            self.loadPurchaseInfo(function () {
                console.log('load purchase info');
            });

            self.productId = 'tw1year';

            if (!window.store) {
                Util.ga.trackEvent('purchase', 'error', 'uninstalled');
                return;
            }

            self.hasInAppPurchase = true;

            //store.verbosity = store.DEBUG;

            // Enable remote receipt validation
            store.validator = clientConfig.serverUrl+"/v000705"+"/check-purchase";

            store.register({
                id: self.productId,
                alias: self.productId,
                type: store.PAID_SUBSCRIPTION
            });

            // Log all errors
            store.error(function(error) {
                Util.ga.trackEvent('purchase', 'error', error.message);
            });

            store.ready(function () {
                console.log("store ready!");
            });

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
                    Util.ga.trackEvent('purchase', 'error', 'expired');
                }).error(function (err) {
                    console.log("verify error") ;
                }).done(function (p) {
                    console.log("verify done") ;
                    p.finish();
                });
            });

            store.refresh();
        };

        return obj;
    })
    .controller('PurchaseCtrl', function($scope, $ionicHistory, Util, Purchase, TwAds) {
        if (ionic.Platform.isIOS()) {
            Util.ga.trackEvent('plugin', 'error', 'PurchaseCtrlOnIOS');
            return;
        }

        $scope.order = function () {
            console.log('subscribe product='+Purchase.productId);
            Util.ga.trackEvent('purchase', 'order', 'subscribe');
            Purchase.order();
        };

        /**
         * 자동 복원되기 때문에 필요없음
         */
        $scope.restore = function () {
            console.log('restore product='+Purchase.productId);
            Util.ga.trackEvent('purchase', 'restore', 'subscribe');
            Purchase.restore();
        };

        $scope.onClose = function() {
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
                if (Purchase.products) {
                    $scope.product = Purchase.products;
                }
                else {
                    console.log("Failed to get product info at start");
                }
            }

            $scope.listWidth = window.innerWidth;
        }

        init();
    });
