/**
 * Created by aleckim on 2016. 4. 29..
 */

angular.module('service.backgroundfetch', [])
    .run(function($ionicPlatform, $location, LocalNotification) {
        $ionicPlatform.ready(function() {
            if (!window.BackgroundFetch) {
                console.log('background fetch plugin was unloaded');
                return;
            }
            if (!ionic.Platform.isIOS()) {
                console.log('it is just support ios');
                return;
            }

            var Fetcher = window.BackgroundFetch;
            var fetchCallback = function () {
                console.log('called background fetch');
                var currentAt = (((new Date()).getHours() * 60 * 60) + ((new Date()).getMinutes() * 60));
                var callCount = 0;
                //LocalNotification.getAllSchedule(function (notifications) {
                //    console.log('notifications='+notifications.length);
                //    if (notifications.length == 0) {
                //        Fetcher.finish();
                //        return;
                //    }
                //    notifications.forEach(function (notification) {
                //        console.log('notification='+JSON.stringify(notification));
                //        callCount++;
                //        if (notification.at) {
                //            var date = new Date(notification.at*1000);
                //            var notificationAt = date.getHours() * 60 * 60 + date.getMinutes() * 60;
                //            console.log('date='+date.toString());
                //            console.log('currentAt='+currentAt+' notificationAt='+notificationAt);
                //            if (currentAt + 1*60*60 < notificationAt) {
                //                console.log('Not this time');
                //                callCount--;
                //                if (callCount <= 0) {
                //                    Fetcher.finish();
                //                }
                //                return;
                //            }
                //        }
                //        LocalNotification.updateNotificationFromServer(notification, function (err, id) {
                //            console.log('update notification message at background fetch id='+id);
                //            callCount--;
                //            if (callCount <= 0) {
                //                Fetcher.finish();
                //            }
                //        });
                //    });
                //});
            };

            var failureCallback = function() {
                console.log('- BackgroundFetch failed');
            };
            Fetcher.configure(fetchCallback, failureCallback, {
                stopOnTerminate: false  // <-- false is default
            });
        });
    });


