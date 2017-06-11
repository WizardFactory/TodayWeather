/**
 * Created by aleckim on 2016. 5. 1..
 * alarmInfo(pushInfo)를 구분하는 것은 cityIndex보다는 town object가 적합하지만, string의 부담때문에 cityIndex를 구분으로 쓰고 있음.
 * city의 index가 변경가능하게 수정되면 이부분도 꼭 수정되어야 함 backend도 수정필요함.
 */

angular.module('service.push', [])
    .factory('Push', function($http, Util, WeatherUtil, WeatherInfo, $location, Units, TwStorage) {
        var obj = {};
        obj.config = {
            "android": {
                "senderID": twClientConfig.googleSenderId
                //"icon": "TodayWeather",
                //"iconColor": "blue"
                //"forceShow": true,
            },
            "ios": {
                "alert": "true",
                "badge": "true",
                "sound": "true",
                "clearBadge": "true"
            },
            "windows": {}
        };

        obj.pushUrl = twClientConfig.serverUrl + '/v000705'+'/push';

        //attach push object to the window object for android event
        //obj.push;

        //obj.alarmInfo = {'time': new Date(0), 'cityIndex': -1, 'town': {'first':'','second':'', 'third':'}};
        obj.pushData = {registrationId: '', type: '', alarmList: []};
        //obj.registrationId;
        //obj.type; //'ios' or 'android'
        //obj.alarmList = [];

        obj.loadPushInfo = function (callback) {
            var self = this;

            TwStorage.get(
                function (value) {
                    console.log('load pushData=' + value);
                    var pushData = value;
                    if (pushData != undefined) {
                        self.pushData.registrationId = pushData.registrationId;
                        self.pushData.type = pushData.type;
                        self.pushData.alarmList = pushData.alarmList;
                        self.pushData.alarmList.forEach(function (alarmInfo) {
                            alarmInfo.time = new Date(alarmInfo.time);
                        });

                        //update alarmInfo to server for sync
                        if (self.pushData.alarmList.length > 0) {
                            setTimeout(function() {
                                self.pushData.alarmList.forEach(function (alarmInfo) {
                                    self._postPushInfo(alarmInfo);
                                });
                            }, 3000);
                        }
                    }
                    if (callback != undefined) {
                        callback();
                    }
                }, "pushData");
        };

        obj.savePushInfo = function (callback) {
            var self = this;

            TwStorage.set(
                function (result) {
                    console.log("save pushData=" + result);
                    if (callback != undefined) {
                        callback(result);
                    }
                }, 'pushData', JSON.stringify(self.pushData));
        };

        /**
         * loadPushInfo로 데이터를 읽어온 경우 time은 string임.
         * controllers에서 localTime으로 설정한 후, 여기서 UTC기준으로 전달함.
         * @param alarmInfo
         */
        obj._postPushInfo  = function postPushInfo(alarmInfo) {
            var self = this;
            var time = alarmInfo.time;
            var pushTime = time.getUTCHours() * 60 * 60 + time.getUTCMinutes() * 60;
            var pushInfo = { registrationId: self.pushData.registrationId,
                type: self.pushData.type,
                pushTime: pushTime,
                cityIndex: alarmInfo.cityIndex,
                town: alarmInfo.town,               //first, second, third
                name: alarmInfo.name,
                location: alarmInfo.location,       //lat, long
                source: alarmInfo.source,           //KMA or DSF, ...
                units: Units.getAllUnits()
            };
            //name, units
            $http({
                method: 'POST',
                headers: {'Content-Type': 'application/json', 'Accept-Language': Util.language},
                url: self.pushUrl,
                data: pushInfo,
                timeout: 10*1000
            })
                .success(function (data) {
                    //callback(undefined, result.data);
                    console.log(data);
                })
                .error(function (data, status) {
                    console.log(status +":"+data);
                    data = data || "Request failed";
                    var err = new Error(data);
                    err.code = status;
                    console.log(err);
                    //callback(err);
                });
        };

        obj._deletePushInfo = function deletePushInfo(alarmInfo) {
            var self = this;
            var pushInfo = { registrationId: self.pushData.registrationId,
                type: self.pushData.type,
                cityIndex: alarmInfo.cityIndex,
                town: alarmInfo.town };

            $http({
                method: 'DELETE',
                headers: {'Content-Type': 'application/json'},
                url: self.pushUrl,
                data: pushInfo,
                timeout: 10*1000
            })
                .success(function (data) {
                    //callback(undefined, result.data);
                    console.log(data);
                })
                .error(function (data, status) {
                    console.log(status +":"+data);
                    data = data || "Request failed";
                    var err = new Error(data);
                    err.code = status;
                    console.log(err);
                    //callback(err);
                });
        };

        obj._updateRegistrationId = function updateRegistrationId( registrationId) {
            var self = this;
            //update registration id on server
            $http({
                method: 'PUT',
                headers: {'Content-Type': 'application/json'},
                url: self.pushUrl,
                data: {newRegId: registrationId, oldRegId: self.pushData.registrationId},
                timeout: 10*1000
            })
                .success(function (data) {
                    //callback(undefined, result.data);
                    console.log(data);
                })
                .error(function (data, status) {
                    console.log(status +":"+data);
                    data = data || "Request failed";
                    var err = new Error(data);
                    err.code = status;
                    console.log(err);
                    //callback(err);
                });
            self.pushData.registrationId = registrationId;
        };

        obj.register = function (callback) {
            var self = this;

            if (!window.PushNotification) {
                console.log("push notification plugin is not set");
                return;
            }

            window.push = PushNotification.init(self.config);

            window.push.on('registration', function(data) {
                console.log(JSON.stringify(data));
                if (self.pushData.registrationId != data.registrationId) {
                    self._updateRegistrationId(data.registrationId);
                }
                return callback(data.registrationId);
            });

            //android에서는 background->foreground 넘어올 때 event 발생하지 않음
            window.push.on('notification', function(data) {
                console.log('notification = '+JSON.stringify(data));
                // data.message,
                // data.title,
                // data.count,
                // data.sound,
                // data.image,
                // data.additionalData.foreground
                // data.additionalData.coldstart
                // data.additionalData.cityIndex
                if (data && data.additionalData && data.additionalData.foreground === false) {
                    //clicked 인지 아닌지 구분 필요.
                    //ios의 경우 badge 업데이트
                    //현재위치의 경우 데이타 업데이트 가능? 체크


                    //if have additionalData go to index page
                    var url = '/tab/forecast?fav='+data.additionalData.cityIndex;
                    //setCityIndex 와 url fav 까지 해야 이동됨 on ios
                    var fav = parseInt(data.additionalData.cityIndex);
                    if (!isNaN(fav)) {
                        if (fav === 0) {
                            var city = WeatherInfo.getCityOfIndex(0);
                            if (city !== null && !city.disable) {
                                WeatherInfo.setCityIndex(fav);
                            }
                        } else {
                            WeatherInfo.setCityIndex(fav);
                        }
                    }
                    console.log('clicked: ' + data.additionalData.cityIndex + ' url='+url);
                    $location.url(url);
                    Util.ga.trackEvent('action', 'click', 'push url='+url);
                }
                else {
                    Util.ga.trackEvent('action', 'error', 'push data='+data);
                }
            });

            window.push.on('error', function(e) {
                console.log('notification error='+e.message);
                Util.ga.trackEvent('plugin', 'error', 'push '+ e.message);
                // e.message
            });

            /**
             * WeatherInfo 와 circular dependency 제거용.
             * @param cityIndex
             * @param address
             * @param time
             * @param callback
             */
            window.push.updateAlarm = function (cityIndex, address, time, callback) {
                return self.updateAlarm(cityIndex, address, time, callback);
            };

            window.push.getAlarm = function (cityIndex) {
                return self.getAlarm(cityIndex);
            };
        };

        obj.unregister = function () {
            console.log('we do not use unregister');
            //var self = this;
            //console.log('push unregister');
            //window.push.unregister(function() {
            //    console.log('push unregister success');
            //    self.push = undefined;
            //}, function(e) {
            //    console.log('error push unregister');
            //    console.log(e);
            //});
        };

        obj.updateAlarm = function (cityIndex, address, time, callback) {
            var self = this;
            var town = WeatherUtil.getTownFromFullAddress(WeatherUtil.convertAddressArray(address));
            var alarmInfo = {cityIndex: cityIndex, town: town, time: time};

            var city = WeatherInfo.getCityOfIndex(cityIndex);

            alarmInfo = {cityIndex: cityIndex, town: town, time: time,
                        location: city.location, name: city.name, source: city.source};

            if (!callback) {
                callback = function (err) {
                    if (err) {
                        console.log(err);
                    }
                };
            }

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
                    if (!time) {
                        alarmInfo.time = self.pushData.alarmList[i].time;
                    }

                    if (alarmInfo.time.getTime() == self.pushData.alarmList[i].time.getTime() &&
                        JSON.stringify(alarmInfo.town) == JSON.stringify(self.pushData.alarmList[i].town)) {
                        console.log('alarmInfo is already latest');
                        return callback(undefined, alarmInfo);
                    }
                    self.pushData.alarmList[i] = alarmInfo;
                }
                else {
                    if (!time) {
                        var err = new Error("You have to set time for add alarm");
                        return callback(err);
                    }
                    self.pushData.alarmList.push(alarmInfo);
                }
                //check alarm in list
            }

            if (!window.push) {
                self.register(function () {
                    self._postPushInfo(alarmInfo);
                    self.savePushInfo(function (result) {
                        callback(undefined, alarmInfo);
                    });
                });
            }
            else {
                self._postPushInfo(alarmInfo);
                self.savePushInfo(function (result) {
                    callback(undefined, alarmInfo);
                });
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
            self._deletePushInfo(alarmInfo);

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
        };

        return obj;
    })
    .run(function(Push, Util) {
        Push.loadPushInfo(function () {
            if (!window.PushNotification) {
                console.log("push notification plugin is not set");
                Util.ga.trackEvent('push', 'error', 'loadPlugin');
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

                if (window.push) {
                    console.log('Already set push notification');
                    return;
                }
                Push.register(function (registrationId) {
                   console.log('start push registrationId='+registrationId);
                });
            }
        });
    });

