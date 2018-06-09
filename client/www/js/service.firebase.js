/**
 * Created by aleckim on 2018. 5. 14.
 */

angular.module('service.firebase', [])
    .factory('Firebase', function() {
        var obj = {};

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

            window.FirebasePlugin.getToken(function (token) {
                // save this server-side and use it to push notifications to this device
                console.log(token);
                callback(null, token);
            }, function (err) {
                console.error(err);
                callback(err);
            });
        };

        obj.hasPermission = function(callback) {
            window.FirebasePlugin.hasPermission(
                function (data) {
                    console.log(data.isEnabled);
                    callback(data);
                },
                function (err) {
                    console.log(err) ;
                });
        };

        obj.grantPermission = function(callback) {
            window.FirebasePlugin.grantPermission(
                function (data) {
                    callback(null, data);
                },
                function (err) {
                    callback(err);
                });
        };

        obj.unregister = function() {
            window.FirebasePlugin.unregister();
        };

        /**
         * analytics api
         */
        obj.logEvent = function(name, params) {
            window.FirebasePlugin.logEvent(name, params);
        };

        obj.setScreenName = function(name) {
            window.FirebasePlugin.setScreenName(name);
        };

        obj.setUserId = function(id) {
            window.FirebasePlugin.setUserId(id);
        };

        /**
         * 
         * @param {*} tokenFreshCallback 
         * @param {*} notificationCallback 
         */
        obj.init = function (tokenFreshCallback, notificationCallback) {
            if (window.FirebasePlugin == undefined) {
                console.error('There is not firebase plugin');
                return;
            }

            this.inited = true;

            window.FirebasePlugin.onTokenRefresh(function(token) {
                // save this server-side and use it to push notifications to this device
                console.log(token);
                tokenFreshCallback(null, token);
            }, function(err) {
                console.error(err);
                tokenFreshCallback(err);
            });

            window.FirebasePlugin.onNotificationOpen(function(notification) {
                console.log(notification);
                notificationCallback(null, notification);
            }, function(err) {
                console.error(err);
                notificationCallback(err);
            });
        };

        return obj;
    });
 