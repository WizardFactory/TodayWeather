/**
 * Created by aleckim on 2016. 5. 1..
 * alarmInfo(pushInfo)를 구분하는 것은 cityIndex보다는 town object가 적합하지만, string의 부담때문에 cityIndex를 구분으로 쓰고 있음.
 * city의 index가 변경가능하게 수정되면 이부분도 꼭 수정되어야 함 backend도 수정필요함.
 */

angular.module('service.push', [])
    .factory('Push', function($http, Util, WeatherUtil, WeatherInfo, $location) {
        var obj = {};
        obj.config = {
            "android": {
                "senderID": Util.googleSenderId,
                //"icon": "TodayWeather",
                //"iconColor": "blue"
                //"forceShow": true,
            },
            "ios": {
                "alert": "false",
                "badge": "false",
                "sound": "false"
            },
            "windows": {}
        };

        //obj.pushUrl = Util.url + '/push';
        obj.pushUrl = "http://192.168.0.5:3000/v000705" + '/push';
        obj.push;
        //obj.alarmInfo = {'time': new Date(0), 'cityIndex': -1, 'town': {'first':'','second':'', 'third':'}};
        obj.pushData = {registrationId: '', type: '', alarmList: []};
        //obj.registrationId;
        //obj.type; //'ios' or 'android'
        //obj.alarmList = [];

        obj.loadPushInfo = function () {
            var self = this;
            var pushData = JSON.parse(localStorage.getItem("pushData"));
            if (pushData != null) {
                self.pushData.registrationId = pushData.registrationId;
                self.pushData.type = pushData.type;
                self.pushData.alarmList = pushData.alarmList;
                //update alarmInfo to server for sync
                if (self.pushData.alarmList.length > 0) {
                    setTimeout(function() {
                        self.pushData.alarmList.forEach(function (alarmInfo) {
                            postPushInfo(alarmInfo);
                        });
                    }, 3000);
                }
            }
            console.log('load push data');
            console.log(self);
        };

        obj.savePushInfo = function () {
            console.log('save push data');
            var self = this;
            localStorage.setItem("pushData", JSON.stringify(self.pushData));
        };

        /**
         * loadPushInfo로 데이터를 읽어온 경우 time은 string임.
         * @param alarmInfo
         */
        function postPushInfo(alarmInfo) {
            var pushTime;
            var time;
            if (alarmInfo.time instanceof Date) {
                time = alarmInfo.time;
            }
            else {
                time = new Date(alarmInfo.time);
            }
            pushTime = time.getUTCHours() * 60 * 60 + time.getUTCMinutes() * 60;

            var pushInfo = { registrationId: obj.pushData.registrationId,
                type: obj.pushData.type,
                pushTime: pushTime,
                cityIndex: alarmInfo.cityIndex,
                town: alarmInfo.town };
            $http({
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                url: obj.pushUrl,
                data: pushInfo,
                timeout: 10*1000
            })
                .then(function (result) {
                    //callback(undefined, result.data);
                    console.log(result);
                },
                function (err) {
                    //callback(err);
                    console.log(err);
                });
        }

        function deletePushInfo(alarmInfo) {
             var pushInfo = { registrationId: obj.pushData.registrationId,
                type: obj.pushData.type,
                cityIndex: alarmInfo.cityIndex,
                town: alarmInfo.town };

            $http({
                method: 'DELETE',
                headers: {'Content-Type': 'application/json'},
                url: obj.pushUrl,
                data: pushInfo,
                timeout: 10*1000
            })
                .then(function (result) {
                    //callback(undefined, result.data);
                    console.log(result);
                },
                function (err) {
                    //callback(err);
                    console.log(err);
                });
        }

        function updateRegistrationId( registrationId) {
            //update registration id on server
            $http({
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                url: obj.pushUrl,
                data: {newRegId: registrationId, oldRegId: obj.pushData.registrationId},
                timeout: 10*1000
            })
                .then(function (result) {
                    //callback(undefined, result.data);
                    console.log(result);
                },
                function (err) {
                    //callback(err);
                    console.log(err);
                });
            obj.pushData.registrationId = registrationId;
        }

        obj.register = function (callback) {
            var self = this;

            if (!window.PushNotification) {
                console.log("push notification plugin is not set");
                return;
            }

            self.push = PushNotification.init(self.config);

            self.push.on('registration', function(data) {
                console.log(JSON.stringify(data));
                if (self.pushData.registrationId != data.registrationId) {
                    updateRegistrationId(data.registrationId);
                }
                return callback(data.registrationId);
            });

            //android에서는 background->foreground 넘어올 때 event 발생하지 않음
            self.push.on('notification', function(data) {
                console.log('notification = '+JSON.stringify(data));
                // data.message,
                // data.title,
                // data.count,
                // data.sound,
                // data.image,
                // data.additionalData.foreground
                // data.additionalData.coldstart
                // data.additionalData.cityIndex
                if (data.additionalData.foreground === false) {
                    //if have additionalData go to index page
                    var url = '/tab/forecast?fav='+data.additionalData.cityIndex;
                    //setCityIndex 와 url fav 까지 해야 이동됨 on ios
                    WeatherInfo.setCityIndex(data.additionalData.cityIndex);
                    console.log('clicked: ' + data.additionalData.cityIndex + ' url='+url);
                    $location.url(url);
                }
            });

            self.push.on('error', function(e) {
                console.log('notification error='+JSON.stringify(e));
                // e.message
            });
        };

        obj.unregister = function () {
            console.log('we donot use unregister');
            return;
            //var self = this;
            //console.log('push unregister');
            //self.push.unregister(function() {
            //    console.log('push unregister success');
            //    self.push = undefined;
            //}, function(e) {
            //    console.log('error push unregister');
            //    console.log(e);
            //});
        };

        obj.updateAlarm = function (cityIndex, cityData, time, callback) {
            var town = WeatherUtil.getTownFromFullAddress(WeatherUtil.convertAddressArray(cityData.address));
            var alarmInfo = {cityIndex: cityIndex, town: town, time: time};
            var self = this;

            if (self.pushData.alarmList.length == 0) {
                self.pushData.alarmList.push(alarmInfo);
            }
            else {
                for (var i=0; i<self.pushData.alarmList.length; i++) {
                    var a = self.pushData.alarmList[i];
                    if (a.cityIndex === alarmInfo.cityIndex) {
                        break;
                    }
                }
                if (i<self.pushData.alarmList.length) {
                    self.pushData.alarmList[i] = alarmInfo;
                }
                else {
                    self.pushData.alarmList.push(alarmInfo);
                }
                //check alarm in list
            }
            if (!self.push) {
                self.register(function () {
                    postPushInfo(alarmInfo);
                    self.savePushInfo();
                    return callback(alarmInfo);
                });
            }
            else {
                postPushInfo(alarmInfo);
                self.savePushInfo();
                return callback(alarmInfo);
            }
        };

        obj.removeAlarm = function (alarmInfo) {
            var self = this;
            console.log('remove alarm='+JSON.stringify(alarmInfo));
            for (var i=0; i<self.pushData.alarmList.length; i++) {
                var a = self.pushData.alarmList[i];
                if (a.cityIndex === alarmInfo.cityIndex) {
                    break;
                }
            }
            if (i == self.pushData.alarmList.length) {
                console.log('error fail to find alarm='+JSON.stringify(alarmInfo));
                return;
            }

            self.pushData.alarmList.splice(i, 1);
            deletePushInfo(alarmInfo);

            if (self.pushData.alarmList.length == 0) {
                self.unregister();
            }
            self.savePushInfo();
        };

        obj.getAlarm = function (cityIndex) {
            var self = this;
            for (var i=0; i<self.pushData.alarmList.length; i++) {
                var a = self.pushData.alarmList[i];
                if (a.cityIndex === cityIndex) {
                    return self.pushData.alarmList[i];
                }
            }
            console.log('fail to find cityIndex='+cityIndex);
            return;
        };

        return obj;
    })
    .run(function($ionicPlatform, Push) {

        Push.loadPushInfo();

        $ionicPlatform.ready(function() {
            if (!window.PushNotification) {
                console.log("push notification plugin is not set");
                return;
            }

            if (ionic.Platform.isIOS()) {
                Push.pushData.type = 'ios';
            }
            else if (ionic.Platform.isAndroid()) {
                Push.pushData.type = 'android';
            }

            //if push is on, call register
            if (Push.pushData.alarmList.length > 0) {
                PushNotification.hasPermission(function(data) {
                    if (data.isEnabled) {
                        console.log('isEnabled');
                    }
                    else {
                        console.log('isEnabled is false');
                        //alert('you have to set notification permission');
                    }
                });

                if (Push.push) {
                    console.log('Already set push notification');
                    return;
                }
                Push.register(function (registrationId) {
                   console.log('start push registrationId='+registrationId);
                });
            }
        });
    });

