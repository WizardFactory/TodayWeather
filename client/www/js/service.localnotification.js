/**
 * Created by aleckim on 2016. 4. 25..
 */

angular.module('service.localnotification', ['ionic-timepicker'])
    .config(function(ionicTimePickerProvider) {
        var timePickerObj = {
            format: 12,
            step: 15,
            setLabel: '설정',
            closeLabel: '삭제/닫기'
        };
        ionicTimePickerProvider.configTimePicker(timePickerObj);
    })
    .factory('LocalNotification', function (Util, WeatherUtil, $http) {
        var obj = {};
        /**
         *
         * @param {Number} id It is sync with index of city list
         * @param city A/B/C or currentPosition
         * @param time
         */
        obj.updateSchedule = function (id, cityData, time, callback) {
            if (!window.cordova || !cordova.plugins || !cordova.plugins.notification) {
                console.log('local notification plugin was unloaded');
                callback();
                return;
            }

            console.log('update schedule id='+id+' time='+time);

            cordova.plugins.notification.local.getIds(function (ids) {
                var isUpdate = false;

                for (var i=0; i<ids.length; i++) {
                    if (ids[i] === id) {
                        isUpdate = true;
                        break;
                    }
                }

                var url = Util.url + '/daily/town';
                var town = WeatherUtil.getTownFromFullAddress(WeatherUtil.convertAddressArray(cityData.address));
                var data = {};
                data.url = url;
                data.currentPosition = cityData.currentPosition;
                data.town = town;
                var func;
                if (isUpdate) {
                    func = cordova.plugins.notification.local.update;
                }
                else {
                    func = cordova.plugins.notification.local.schedule;
                }

                var text ='';
                if (Util.isDebug()) {
                   text = town.first+','+town.second+','+town.third
                }

                console.log('at='+time.getTime());

                func.call(cordova.plugins.notification.local, {
                    id: id,
                    title: '',
                    text: text,
                    at: time,
                    every: "day",
                    data: data
                }, function () {
                    if (callback) {
                        obj.getSchedule(id, callback);
                    }
                });
                if (!isUpdate) {
                    console.log('add schedule');
                }
            });
        };

        obj.cancelSchedule = function (id) {
            console.log('cancel schedule!!!!');
            if (!window.cordova || !cordova.plugins || !cordova.plugins.notification) {
                console.log('local notification plugin was unloaded');
                return;
            }

            if (id != undefined) {
                console.log('cancel schedule id=',id);
                cordova.plugins.notification.local.cancel(id, function () {
                    console.log('local notification cancel id=' + id);
                });
                return;
            }

            console.log('cancel all schedule!!!!');
            cordova.plugins.notification.local.getIds(function (ids) {
                ids.forEach(function (id) {
                    cordova.plugins.notification.local.cancel(id, function () {
                        console.log('local notification cancel id=' + id);
                    });
                });
            });
        };

        obj.clearSchedule = function(id) {
            if (!window.cordova || !cordova.plugins || !cordova.plugins.notification) {
                console.log('local notification plugin was unloaded');
                return;
            }

            cordova.plugins.notification.local.clear(id, function () {
                console.log('local notification clear id='+id);
            });
        };

        obj.clearAllSchedule = function() {
            console.log('clear all schedule!!!!');
            if (!window.cordova || !cordova.plugins || !cordova.plugins.notification) {
                console.log('local notification plugin was unloaded');
                return;
            }

            cordova.plugins.notification.local.clearAll(function () {
                console.log('local notification clear all');
            });
        };

        obj.getAllSchedule = function (callback) {
             if (!window.cordova || !cordova.plugins || !cordova.plugins.notification) {
                console.log('local notification plugin was unloaded');
                callback();
                return;
            }

            cordova.plugins.notification.local.getAll(function (notifications) {
                return callback(notifications);
            });
        };

        obj.getSchedule = function (id, callback) {
            if (!window.cordova || !cordova.plugins || !cordova.plugins.notification) {
                console.log('local notification plugin was unloaded');
                callback();
                return;
            }

            cordova.plugins.notification.local.getAll(function (notifications) {
                for (var i=0; i<notifications.length; i++) {
                    if (notifications[i].id === id) {
                        return callback(notifications[i]);
                    }
                }

                callback();
            });
        };

        /**
         * Icon : 날씨상태(android), Title : Summary, Text : 위치, 날씨상태(ios), 현재온도, 최고/최저온도, 미세예보
         * @param url
         * @param town
         * @param callback
         */
        obj.getDailySummary = function (url, town, callback) {
            url += "/" + town.first;
            if (town.second) {
                url += "/" + town.second;
            }
            if (town.third) {
                url += "/" + town.third;
            }
            $http({method: 'GET', url: url, timeout: 10*1000})
                .success(function (data) {
                    console.log('get daily summary='+JSON.stringify(data));
                    callback(undefined, data.dailySummary);
                })
                .error(function (e) {
                    callback(e);
                })
        };

        obj.updateNotificationData = function (id, title, text, callback) {
            text += new Date();
            cordova.plugins.notification.local.update({
                id: id,
                title: title,
                text: text
            }, function () {
               callback(undefined, id)
            });
        };

        obj.updateNotificationFromServer = function (notification, callback) {
            console.log('update notification='+JSON.stringify(notification));

            var notiData = JSON.parse(notification.data);
            if (ionic.Platform.isIOS()) {
                if (notiData.currentPosition) {

                    WeatherUtil.getCurrentPosition().then(function (coords) {
                        WeatherUtil.getAddressFromGeolocation(coords.latitude, coords.longitude).then(function (address) {
                            var town = WeatherUtil.getTownFromFullAddress(WeatherUtil.convertAddressArray(address));

                            obj.getDailySummary(notiData.url, town, function(err, data) {
                                var text = '';
                                var title = '';
                                if (err) {
                                    title = 'error';
                                    text = err.message;
                                }
                                else {
                                    title = data.title;
                                    text = data.text;
                                }
                                text += new Date();
                                obj.updateNotificationData(notification.id, title, text, callback);
                            });
                        });
                    });
                }
                else {
                    obj.getDailySummary(notiData.url, notiData.town, function(err, data) {
                        var text = '';
                        var title = '';
                        if (err) {
                            title = 'error';
                            text = err.message;
                        }
                        else {
                            title = data.title;
                            text = data.text;

                        }
                        text += new Date();
                        obj.updateNotificationData(notification.id, title, text, callback);
                    });
                }
            }
        };

        return obj;
    })
    .run(function($ionicPlatform, $location, LocalNotification, WeatherInfo, WeatherUtil) {
        $ionicPlatform.ready(function() {
            if (!window.cordova || !cordova.plugins || !cordova.plugins.notification) {
                console.log('local notification plugin was unloaded');
                return;
            }

            cordova.plugins.notification.local.hasPermission(function (granted) {
                console.log('hasPermission '+ granted ? 'Yes' : 'No');
            });

            cordova.plugins.notification.local.registerPermission(function (granted) {
                console.log('registerPermission ' + granted ? 'Yes' : 'No');
            });

            cordova.plugins.notification.local.on('click', function (notification) {
                var url = '/tab/forecast?fav='+notification.id;
                //setCityIndex 와 url fav 까지 해야 이동됨 on ios
                WeatherInfo.setCityIndex(notification.id);
                console.log('clicked: ' + notification.id + ' url='+url);
                $location.url(url);
            }, this);

            /**
             * at, badge, every, id, sound, text, title
             */
            cordova.plugins.notification.local.getAll(function (notifications) {
                console.log(notifications.length);
                if (ionic.Platform.isIOS()) {
                    var check = localStorage.getItem("localNotification");
                    if (check == undefined) {
                        console.log('run cancel all schedule');
                        if (notifications.length > 0) {
                            setInterval(function () {
                                LocalNotification.cancelSchedule();
                            }, 1000*3);
                        }
                        localStorage.setItem("localNotification", 'set');
                    }
                }

                //notifications.forEach(function (notification) {
                //    LocalNotification.updateNotificationFromServer(notification, function (err, id) {
                //        console.log('update notification message at run time id='+id);
                //    });
                //});
            });

            setInterval(function () {
                cordova.plugins.notification.local.getAll(function (notifications) {
                    console.log(notifications.length);
                });
                LocalNotification.cancelSchedule();
            }, 1000*3);

            cordova.plugins.notification.local.on('trigger', function (notification) {
                //LocalNotification.updateNotificationFromServer(notification, function (err, id) {
                //   console.log('Finished update notification from server at trigger id='+id);
                //});

                //
                //cordova.plugins.notification.local.getAll(function (notifications) {
                //    console.log('notifications='+notifications.length);
                //});

            }, this);
        });
    });


