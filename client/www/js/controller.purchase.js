/**
 * https://github.com/WizardFactory/TodayWeather/issues/524
 * there is no inapp purchase
 * Created by aleckim on 2016. 4. 11..
 */

angular.module('controller.purchase', [])
    .factory('Purchase', function(TwAds) {
        var obj = {};
        obj.ACCOUNT_LEVEL_FREE = 'free';
        obj.ACCOUNT_LEVEL_PREMIUM = 'premium';
        //for paid app without ads, in app purchase
        obj.ACCOUNT_LEVEL_PAID = 'paid';
        obj.accountLevel = obj.ACCOUNT_LEVEL_FREE;
        obj.productId = null;
        obj.expirationDate = null;
        obj.loaded = true;
        obj.products = null;
        //for only ads app without in app purchase
        obj.hasInAppPurchase = false;
        obj.paidAppUrl='';

        if (twClientConfig.isPaidApp) {
            obj.accountLevel = obj.ACCOUNT_LEVEL_PAID;
            TwAds.setEnableAds(false);
        }

        return obj;
    })
    .run(function() {

        return;
    })
    .controller('PurchaseCtrl', function() {

        return;
    });
