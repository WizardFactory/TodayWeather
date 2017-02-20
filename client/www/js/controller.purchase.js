/**
 * https://github.com/WizardFactory/TodayWeather/issues/524
 * Created by aleckim on 2016. 4. 11..
 */

angular.module('controller.purchase', [])
    .factory('Purchase', function($rootScope, $http, $q, TwAds) {
        var obj = {};
        obj.ACCOUNT_LEVEL_FREE = 'free';
        obj.ACCOUNT_LEVEL_PREMIUM = 'premium';
        //for paid app without ads, in app purchase
        obj.ACCOUNT_LEVEL_PAID = 'paid';
        obj.accountLevel;
        obj.productId;
        obj.expirationDate;
        obj.loaded = false;
        obj.products;
        //for only ads app without in app purchase
        obj.hasInAppPurchase = false;
        obj.paidAppUrl='';

        if (twClientConfig.isPaidApp) {
            obj.accountLevel = obj.ACCOUNT_LEVEL_PAID;
            TwAds.setEnableAds(false);
        }

        obj.setAccountLevel = function (accountLevel) {
            if (obj.accountLevel != accountLevel) {
                console.log('set account level ='+accountLevel);
                //update accountLevel
                obj.accountLevel = accountLevel;
                if (accountLevel === obj.ACCOUNT_LEVEL_FREE) {
                    TwAds.setEnableAds(true);
                }
                else if (accountLevel === obj.ACCOUNT_LEVEL_PREMIUM) {
                    TwAds.setEnableAds(false);
                }
            }
            else {
                console.log('account level is already set level='+accountLevel);
            }
        };

        obj.checkReceiptValidation = function(storeReceipt, callback) {
            var url = twClientConfig.serverUrl  + '/v000705' + '/check-purchase';
            $http({
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                url: url,
                data: storeReceipt,
                timeout: 10*1000
            })
                .then(function (result) {
                    callback(undefined, result.data);
                },
                function (err) {
                    callback(err);
                });
        };

        obj.saveStoreReceipt = function (storeReceipt) {
            localStorage.setItem("storeReceipt", JSON.stringify(storeReceipt));
        };

        obj.loadStoreReceipt = function () {
            return JSON.parse(localStorage.getItem("storeReceipt"));
        };

        obj.loadPurchaseInfo = function () {
            console.log('load purchase info');
            var purchaseInfo = JSON.parse(localStorage.getItem("purchaseInfo"));

            if (purchaseInfo != undefined) {
                console.log('load purchaseInfo='+JSON.stringify(purchaseInfo));
                obj.expirationDate = purchaseInfo.expirationDate;
                //check account date
                if ((new Date(purchaseInfo.expirationDate)).getTime() < Date.now()) {
                    console.log('account expired, please renewal or restore');
                    purchaseInfo.accountLevel = obj.ACCOUNT_LEVEL_FREE;
                }
                obj.setAccountLevel(purchaseInfo.accountLevel);
            }
            else {
                obj.setAccountLevel(obj.ACCOUNT_LEVEL_FREE);
            }
        };

        obj.savePurchaseInfo = function (accountLevel, expirationDate) {
            var purchaseInfo = {accountLevel: accountLevel, expirationDate: expirationDate};
            localStorage.setItem("purchaseInfo", JSON.stringify(purchaseInfo));

            if (purchaseInfo.accountLevel === obj.ACCOUNT_LEVEL_PREMIUM) {
                TwAds.saveTwAdsInfo(false);
            }
            else {
                TwAds.saveTwAdsInfo(true);
            }
        };

        obj.updatePurchaseInfo = function () {
            var restoreFunc = function () {
                if (ionic.Platform.isIOS()) {
                    return inAppPurchase.getReceipt().then(function (receipt) {
                        if (receipt == undefined) {
                            return undefined;
                        }
                        return  {type: 'ios', id: obj.productId, receipt: receipt};
                    });
                }
                else if (ionic.Platform.isAndroid()) {
                    return inAppPurchase.restorePurchases().then(function(data) {
                        console.log('Purchases INFO!!!');
                        console.log(JSON.stringify(data));
                        console.log('receipt count='+data.length);
                        data.forEach(function (purchase) {
                            var inReceipt = JSON.parse(purchase.receipt);
                            console.log('receipt: '+JSON.stringify(inReceipt));
                            console.log('purchaseTime='+new Date(inReceipt.purchaseTime));
                        });
                        if (data.length == 0) {
                            return undefined;
                        }
                        //if you have many product find by product id
                        return {type: 'android', id: obj.productId, receipt: data};
                    });
                }
                else {
                    throw new Error("Unknown platform");
                }
            };

            return restoreFunc()
                .then(function (storeReceipt) {
                    if (storeReceipt == undefined)  {
                        throw new Error("Can not find any purchase");
                    }
                    obj.saveStoreReceipt(storeReceipt);
                    var deferred = $q.defer();
                    obj.checkReceiptValidation(storeReceipt, function (err, receiptInfo) {
                        if (err) {
                            deferred.reject(new Error("Fail to connect validation server. Please restore after 1~2 minutes"));
                            return;
                        }

                        deferred.resolve(receiptInfo);
                    });
                    return deferred.promise;
                })
        };

        return obj;
    })
    .run(function($ionicPlatform, $ionicPopup, $q, Purchase, $rootScope, $location, $translate) {

        if (Purchase.accountLevel == Purchase.ACCOUNT_LEVEL_PAID) {
            return;
        }

        /**
         * check validation receipt by saved data in local storage
         */
        function checkPurchase() {
            var storeReceipt;
            var updatePurchaseInfo;

            storeReceipt = Purchase.loadStoreReceipt();
            if (storeReceipt) {

                console.log('Purchases INFO!!!');
                console.log(JSON.stringify(storeReceipt));

                updatePurchaseInfo = function () {
                    var deferred = $q.defer();
                    Purchase.checkReceiptValidation(storeReceipt, function (err, receiptInfo) {
                        if (err) {
                            deferred.reject(new Error("Fail to connect validation server. Please restore after 1~2 minutes"));
                            return;
                        }

                        deferred.resolve(receiptInfo);
                    });
                    return deferred.promise;
                };
            }
            else {
               updatePurchaseInfo = Purchase.updatePurchaseInfo;
            }

            updatePurchaseInfo()
                .then(function (receiptInfo) {
                    Purchase.loaded = true;
                    if (!receiptInfo.ok) {
                        //downgrade by canceled, refund ..
                        console.log(JSON.stringify(receiptInfo.data));
                        Purchase.setAccountLevel(Purchase.ACCOUNT_LEVEL_FREE);
                        Purchase.savePurchaseInfo(Purchase.accountLevel, Purchase.expirationDate);

                        //$ionicPopup.alert({
                        //    title: 'check purchase',
                        //    template: receiptInfo.data.message
                        //});
                    }
                    else {
                        console.log('welcome premium user');
                    }
                })
                .catch(function (err) {
                    //again to check purchase info
                    console.log('fail to check purchase info err='+err.message);
                });
        }

        $ionicPlatform.ready(function() {
            if (ionic.Platform.isIOS()) {
                Purchase.paidAppUrl = twClientConfig.iOSPaidAppUrl;
            }
            else if (ionic.Platform.isAndroid()) {
                Purchase.paidAppUrl = twClientConfig.androidPaidAppUrl;
            }

            Purchase.loadPurchaseInfo();

            //check purchase state is canceled or refund
            if (Purchase.loaded) {
                console.log('already check purchase info');
                return;
            }

            Purchase.productId = 'tw1year';
            console.log('productId='+Purchase.productId);

            if (!window.inAppPurchase) {
                console.log('in app purchase is not ready');
                if (Purchase.paidAppUrl.length > 0) {
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
                return;
            }

            Purchase.hasInAppPurchase = true;
            $translate('LOC_GET_PREMIUM_TO_REMOVE_ADS').then(function (bannerMessage) {
                $rootScope.adsBannerMessage = bannerMessage;
            }, function (translationId) {
                $rootScope.adsBannerMessage = translationId;
            });
            $rootScope.clickAdsBanner = function() {
                $location.path('/purchase');
            };

            inAppPurchase
                .getProducts([Purchase.productId])
                .then(function (products) {
                    console.log(JSON.stringify(products));
                    Purchase.products =  products;
                    if (Purchase.loaded === false) {
                        //It seems fail to check purchase info
                        //retry check purchase info
                        checkPurchase();
                    }
                })
                .catch(function (err) {
                    console.log('Fail to get products of id='+Purchase.productId);
                    console.log(JSON.stringify(err));
                });

            //if saved accountLevel skip checkPurchase but, have to get products
            if (Purchase.accountLevel === Purchase.ACCOUNT_LEVEL_FREE) {
                console.log('account Level is '+Purchase.accountLevel);
                Purchase.loaded = true;
                return;
            }

            //some times fail to get restorePurchases because inAppPurchase is not ready
            checkPurchase();
        });
    })
    .controller('PurchaseCtrl', function($scope, $ionicPlatform, $ionicLoading, $http, $ionicHistory, $ionicPopup, Purchase, TwAds, $translate) {

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
            inAppPurchase
                .subscribe(Purchase.productId)
                .then(function (data) {
                    console.log('subscribe ok!');
                    console.log(JSON.stringify(data));
                    //$ionicPopup.alert({
                    //    title: 'subscribe',
                    //    template: JSON.stringify(data)
                    //});
                    if (ionic.Platform.isIOS()) {
                       return {type: 'ios', id: Purchase.productId, receipt: data.receipt};
                    }
                    else if (ionic.Platform.isAndroid()) {
                       return {type: 'android', id: Purchase.productId, receipt: [data]}
                    }
                })
                .then(function (storeReceipt) {
                    //$ionicLoading.hide();
                    console.log(JSON.stringify(storeReceipt));
                    Purchase.saveStoreReceipt(storeReceipt);
                    Purchase.checkReceiptValidation(storeReceipt, function (err, receiptInfo) {
                        $ionicLoading.hide();
                        if (err) {
                            console.log(JSON.stringify(err));
                            var msg =  strFailToConnectServer + " " + strPleaseRestoreAfter;
                            throw new Error(msg);
                        }
                        console.log(JSON.stringify(receiptInfo));
                        if (!receiptInfo.ok) {
                            console.log(JSON.stringify(receiptInfo.data));
                            throw new Error(receiptInfo.data.message);
                        }

                        Purchase.setAccountLevel(Purchase.ACCOUNT_LEVEL_PREMIUM);
                        Purchase.expirationDate = receiptInfo.data.expires_date;
                        $scope.accountLevel = Purchase.ACCOUNT_LEVEL_PREMIUM;
                        $scope.expirationDate = (new Date(Purchase.expirationDate)).toLocaleDateString();
                        console.log('set accountLevel='+$scope.accountLevel);
                        Purchase.savePurchaseInfo(Purchase.accountLevel, Purchase.expirationDate);
                    });
                })
                .catch(function (err) {
                    $ionicLoading.hide();
                    console.log(strPurchaseError);
                    console.log(JSON.stringify(err));
                    $ionicPopup.alert({
                        title: strPurchaseError,
                        template: err.message
                    });
                });
        };

        $scope.restore = function () {
            $ionicLoading.show({ template: spinner + strRestoringPurchases });

            Purchase.updatePurchaseInfo()
                .then(function (receiptInfo) {
                    $ionicLoading.hide();

                    if (!receiptInfo.ok) {
                        console.log(JSON.stringify(receiptInfo.data));
                        throw new Error(receiptInfo.data.message);
                    }
                    else {
                        Purchase.setAccountLevel(Purchase.ACCOUNT_LEVEL_PREMIUM);
                        Purchase.expirationDate = receiptInfo.data.expires_date;
                        $scope.accountLevel = Purchase.ACCOUNT_LEVEL_PREMIUM;
                        $scope.expirationDate = (new Date(Purchase.expirationDate)).toLocaleDateString();
                        console.log('set accountLevel=' + $scope.accountLevel);
                        Purchase.savePurchaseInfo(Purchase.accountLevel, Purchase.expirationDate);
                    }
                })
                .catch(function (err) {
                    $ionicLoading.hide();
                    console.log(JSON.stringify(err));
                    $ionicPopup.alert({
                        title: strRestoreError,
                        template: err.message
                    });
                });
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
            TwAds.setShowAds(true);
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

            if (!window.inAppPurchase) {
                //for develop mode
                var title = "Premium";
                var description = "Subscribe to premium and use without Ads for 1 year";
                $translate(['LOC_PREMIUM', 'LOC_SUBSCRIBE_TO_PREMIUM_AND_USE_WITHOUT_ADS_FOR_1_YEAR']).then(function (translations) {
                    title = translations.LOC_PREMIUM;
                    description = translations.LOC_SUBSCRIBE_TO_PREMIUM_AND_USE_WITHOUT_ADS_FOR_1_YEAR;
                }, function (translationIds) {
                    console.log("Fail to translations "+JSON.stringify(translationIds));
                }).finally(function () {
                    $scope.product = {title: title,  price: '$1.09', description: description};
                });
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
