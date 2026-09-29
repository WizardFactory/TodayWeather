/**
 * Created by aleckim on 2018. 5. 14.
 */

angular.module('service.firebase', [])
    .factory('Firebase', function() {
        var obj = {};

        // cordova-plugin-firebasex modular plugins: messaging and analytics each expose their own
        // global instead of the old cordova-plugin-firebase FirebasePlugin.
        function messaging() {
            return window.FirebasexMessaging;
        }
        function analytics() {
            return window.FirebasexAnalytics;
        }

        /**
         * PUSH API
         */

        /**
         * 
         * @param {*} callback 
         */
        obj.getToken = function (callback) {
            if (this.inited === false) {
                return;
            }
            messaging().getToken(function (token) {
                // save this server-side and use it to push notifications to this device
                console.log(token);
                callback(null, token);
            }, function (err) {
                console.error(err);
                callback(err);
            });
        };

        /**
         * Calls back with {isEnabled}, the shape of the old plugin (firebasex passes a boolean).
         */
        obj.hasPermission = function(callback) {
            messaging().hasPermission(
                function (enabled) {
                    console.log(enabled);
                    callback({isEnabled: enabled});
                },
                function (err) {
                    console.log(err) ;
                });
        };

        obj.grantPermission = function(callback) {
            messaging().grantPermission(
                function (data) {
                    callback(null, data);
                },
                function (err) {
                    callback(err);
                });
        };

        obj.unregister = function() {
            messaging().unregister();
        };

        /**
         * analytics api
         */
        obj.logEvent = function(name, params) {
            analytics().logEvent(name, params);
        };

        obj.setScreenName = function(name) {
            analytics().setScreenName(name);
        };

        obj.setUserId = function(id) {
            analytics().setUserId(id);
        };

        /**
         * 
         * @param {*} tokenFreshCallback 
         * @param {*} notificationCallback 
         */
        obj.init = function (tokenFreshCallback, notificationCallback) {
            if (messaging() == undefined) {
                console.error('There is not firebase plugin');
                return;
            }
            this.inited = true;
            messaging().onTokenRefresh(function(token) {
                // save this server-side and use it to push notifications to this device
                console.log(token);
                tokenFreshCallback(null, token);
            }, function(err) {
                console.error(err);
                tokenFreshCallback(err);
            });
            // onMessageReceived replaces onNotificationOpen: firebasex sets tap to "background" or
            // "foreground" only when the user tapped the notification; the old plugin used a boolean.
            messaging().onMessageReceived(function(notification) {
                console.log(notification);
                notification.tap = !!notification.tap;
                notificationCallback(null, notification);
            }, function(err) {
                console.error(err);
                notificationCallback(err);
            });
        };

        return obj;
    });
