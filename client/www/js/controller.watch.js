/**
 * Created by aleckim on 2017. 10. 24..
 * https://github.com/DVenkatesh/cordova-plugin-watchconnectivity
 */

angular.module('controller.watch', []).factory('Watch', function () {
    var obj = {};
    obj.appGroupId;

    obj.sendUserDefaults = function (obj, callback) {
        if (!this.appGroupId) {
            return callback(new Error("App group id is null"));
        }

        applewatch.sendUserDefaults(function () {
                callback();
            },
            function () {
                callback(new Error("Fail to send user defaults"));
            },
            obj, this.appGroupId);
    };

    obj.init = function (appGroupId) {
        var that = this;
        if(window.applewatch == undefined) {
            console.log("Fail to load applewatch");
            return;
        }
        applewatch.init(function (id) {
            that.appGroupId = id;
            console.log('applewatch is initialized group id='+id);
        }, function () {
            console.log('applewatch fail to init');
        }, appGroupId);
    };

    return obj;
});
