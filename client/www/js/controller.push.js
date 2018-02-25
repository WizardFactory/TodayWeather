angular.module('controller.push', [])
    .controller('PushCtrl', function ($scope, $stateParams, WeatherInfo, WeatherUtil, Units, Util,
                                     $ionicHistory, Push, $translate, ionicTimePicker, $ionicPopup) {

        var pushInfo;
        var startTime;
        var endTime;

        var updated = false;

        function init() {
            var fav = parseInt($stateParams.fav);
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

            var cityIndex = WeatherInfo.getCityIndex();
            var cityData = WeatherInfo.getCityOfIndex(cityIndex);

            $scope.address = cityData.name || WeatherUtil.getShortenAddress(cityData.address);

            pushInfo = {city: {index: cityIndex}, alarmList:[], dayOfWeek: []};

            _loadPushInfo(pushInfo, cityIndex);

            if (pushInfo.alert == undefined) {
                pushInfo.alert = Push.newPushAlert(_generateId(), cityIndex, 7, 22);
                updated = true;
            }

            if (pushInfo.dayOfWeek.length === 0) {
                pushInfo.dayOfWeek = [false, true, true, true, true, true, false];
                updated = true;
            }

            if (pushInfo.alarmList.length === 0) {
                [7*3600+40*60, 11*3600+40*60, 17*3600+40*60].forEach(function (value) {
                    var alarm = Push.newPushAlarm(_generateId(), cityIndex, value, pushInfo.dayOfWeek);
                    //var alarm = {id: Push.generatePushInfoId(), cityIndex: cityIndex, time: value, dayOfWeek: pushInfo.dayOfWeek};
                    pushInfo.alarmList.push(alarm);
                });
                updated = true;
            }

            startTime = Push.date2localSecs(pushInfo.alert.startTime)/3600;
            endTime = Push.date2localSecs(pushInfo.alert.endTime)/3600;

            $("#example_id").ionRangeSlider({
                hide_min_max: true,
                keyboard: false,
                min: 0,
                max: 24,
                from: startTime,
                to: endTime,
                type: 'double',
                step: 1,
                grid: true,
                onChange: function (data) {
                    startTime = data.from;
                    endTime = data.to;
                    updated = true;
                }
            });

            console.log(JSON.stringify(pushInfo));
            $scope.alert = pushInfo.alert;
            $scope.alarmList = pushInfo.alarmList;
            $scope.dayOfWeek = pushInfo.dayOfWeek;

            if (!window.PushNotification) {
                Util.ga.trackEvent('push', 'error', 'loadPlugin');
                return;
            }

            if (!window.push) {
                Push.register();
            }
            else {
                PushNotification.hasPermission(function(data) {
                    console.log('Push.isEnabled:'+data.isEnabled);
                    Push.isEnabled = data.isEnabled;
                    if (data.isEnabled === false) {
                        _showPermissionPopUp();
                    }
                });
            }
        }

        $scope.toggleEnableDay = function (day) {
            $scope.dayOfWeek[day] = !$scope.dayOfWeek[day];
            updated = true;
            return false; //재호출되지 않도록 이벤트 막음
        };

        function _generateId() {
            if (pushInfo.alarmList.length > 0) {
               return  pushInfo.alarmList[pushInfo.alarmList.length-1].id+1;
            }
            else if (pushInfo.alarmList.length == 0) {
                if (pushInfo.alert == undefined) {
                    return 1;
                }
                else {
                    return 2;
                }
            }
        }

        function _loadPushInfo(pushInfo, cityIndex) {
            console.log('load push info in ctrl push');
            var pushList;
            try {
                pushList = Push.getPushListByCityIndex(cityIndex);
                pushList.forEach(function (pushObj) {
                    if (pushObj.category === 'alert') {
                        pushObj = JSON.parse(JSON.stringify(pushObj));
                        pushObj.startTime = new Date(pushObj.startTime);
                        pushObj.endTime = new Date(pushObj.endTime);
                        pushInfo.alert = pushObj;
                    }
                    else if (pushObj.category === 'alarm') {
                        pushObj = JSON.parse(JSON.stringify(pushObj));
                        pushObj.time = new Date(pushObj.time);
                        pushInfo.alarmList.push(pushObj);
                        if (pushInfo.dayOfWeek.length === 0) {
                            pushInfo.dayOfWeek = pushObj.dayOfWeek;
                        }
                    }
                    else {
                        console.error('unknown category pushInfo:'+JSON.stringify(pushInfo));
                    }
                });
            }
            catch (err) {
                console.error(err);
            }
        }

        function _savePushInfo() {

            if (updated) {
                var newPushList = [];
                var alertObj = JSON.parse(JSON.stringify(pushInfo.alert));
                alertObj.startTime = Push.secs2date(startTime*3600);
                alertObj.endTime = Push.secs2date(endTime*3600);
                newPushList.push(alertObj);

                pushInfo.alarmList.forEach(function (obj) {
                    obj.dayOfWeek = pushInfo.dayOfWeek;
                    newPushList.push(obj);
                });

                Push.updatePushListByCityIndex(newPushList, pushInfo.city.index);
            }
            else {
                console.info('skip save push info');
            }
        }

        function _showPermissionPopUp() {

            var strClose;
            var strSetting;
            var strNotiDesc;

            $translate(['LOC_CLOSE', 'LOC_SETTING', 'LOC_NOTIFICATION_IS_OFF_TURN_ON_NOTIFICATION_FOR_THIS_APP']).then(function (translations) {
                strClose = translations.LOC_CLOSE;
                strSetting = translations.LOC_SETTING;
                strNotiDesc = translations.LOC_NOTIFICATION_IS_OFF_TURN_ON_NOTIFICATION_FOR_THIS_APP;
            }, function (translationIds) {
                console.log("Fail to translate : " + JSON.stringify(translationIds));
                Util.ga.trackEvent("translate", "error", "showRetryConfirm");
            }).finally(function () {
                var buttons = [];
                buttons.push({
                    text: strClose,
                    onTap: function () {
                        return 'close';
                    }
                });
                buttons.push({
                    text: strSetting,
                    type: 'button-dark',
                    onTap: function () {
                        return 'settings';
                    }
                });

                var confirmPopup = $ionicPopup.show({
                    title: "Permission",
                    template: strNotiDesc,
                    buttons: buttons
                });

                confirmPopup
                    .then(function (res) {
                        if (res == 'settings') {
                            Util.ga.trackEvent('action', 'click', 'settings');
                            setTimeout(function () {
                                cordova.plugins.diagnostic.switchToSettings(function () {
                                    console.log("Successfully switched to Settings app");
                                }, function (error) {
                                    console.log("The following error occurred: " + error);
                                });
                            }, 0);
                        }
                        else {
                            Util.ga.trackEvent('action', 'click', 'close');
                        }
                    })
                    .finally(function () {
                        console.log('called finally');
                    });
            });
        }

        /**
         * tabCtrl에 동일한 함수 있음.
         * @param day
         * @returns {string}
         */
        $scope.dayToString = function(day) {
            var dayStr = ['LOC_SUN', 'LOC_MON', 'LOC_TUE', 'LOC_WED', 'LOC_THU', 'LOC_FRI', 'LOC_SAT'];
            return dayStr[day];
        };

        $scope.onClose = function() {
            Util.ga.trackEvent('action', 'click', 'units back');
            $ionicHistory.goBack();
        };

        $scope.secs2dateStr = function (date) {
            if (date instanceof Date) {
                var mins = date.getMinutes();
                if (mins<10) {
                   mins = '0'+mins;
                }
                return date.getHours()+':'+ mins;
            }
            else {
                console.error("It is not Date param:"+date);
                return ' -:--'
            }
        };

        $scope.onOkay = function () {
            if (!window.PushNotification) {
                Util.ga.trackEvent('push', 'error', 'loadPlugin');
                return;
            }

            PushNotification.hasPermission(function(data) {
                console.log('Push.isEnabled:'+data.isEnabled);
                Push.isEnabled = data.isEnabled;
                if (data.isEnabled) {
                    _savePushInfo();
                    $ionicHistory.goBack();
                }
                else {
                    _showPermissionPopUp();
                }
            });
        };

        $scope.canMakeNewAlarm = function () {
            var enableList = pushInfo.alarmList.filter(function (value) {
               return value.enable;
            });
            return enableList.length < 5;
        };

        /**
         *
         * @param index
         * @constructor
         */
        $scope.onOpenTimePicker = function (index) {
            var cityIndex = pushInfo.city.index;
            var id;

            if (index >= pushInfo.alarmList.length) {
                id = _generateId();
            }
            else if (pushInfo.alarmList[index]) {
                id = pushInfo.alarmList[index].id;
            }

            Util.ga.trackEvent('alarm', 'open', 'timePicker');
            var ipObj1 = {
                callback: function (val) {      //Mandatory
                    if (typeof(val) === 'undefined') {
                        Util.ga.trackEvent('alarm', 'close', 'timePicker');
                        console.log('closed');
                    }
                    else if (val == 0) {
                        Util.ga.trackEvent('alarm', 'cancel', $scope.address, id);
                        updated = true;

                        if (pushInfo.alarmList[index] != undefined) {
                            pushInfo.alarmList[index].enable = false;
                        }
                    }
                    else {
                        Util.ga.trackEvent('alarm', 'set', $scope.address, id);
                        updated = true;

                        var selectedTime = Push.secs2date(val);

                        if (index === pushInfo.alarmList.length) {
                            var alarmInfo = Push.newPushAlarm(id, cityIndex, selectedTime, pushInfo.dayOfWeek);
                            pushInfo.alarmList.push(alarmInfo);
                        }
                        else {
                            pushInfo.alarmList[index].time = selectedTime;
                            pushInfo.alarmList[index].enable = true;
                        }
                    }
                }
            };

            if (pushInfo.alarmList[index] != undefined) {
                ipObj1.inputTime = Push.date2localSecs(pushInfo.alarmList[index].time);
                console.log('inputTime='+ipObj1.inputTime);
            }
            else {
                ipObj1.inputTime = 8*60*60; //AM 8:00
            }

            var strSetting = "Setting";
            var strDelete = "Delete";
            var strClose = "Close";
            $translate(['LOC_SETTING', 'LOC_DELETE', 'LOC_CLOSE']).then(function (translations) {
                strSetting = translations.LOC_SETTING;
                strDelete = translations.LOC_DELETE;
                strClose = translations.LOC_CLOSE;
            }, function (translationIds) {
                console.error("Fail to translate "+ JSON.stringify(translationIds));
            }).finally(function () {
                ipObj1.setLabel = strSetting;
                ipObj1.cancelLabel = strDelete;
                ipObj1.closeLabel = strClose;
                ionicTimePicker.openTimePicker(ipObj1);
            });
        };

        $scope.onToggleEnableAlert = function () {
            updated = true;
        };

        init();
    });


