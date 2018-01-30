/**
 *
 */

angular.module('controller.setting.radio', [])
    .factory("radioList", function RadioList($rootScope, Units, TwStorage, Util) {
        var radioList = {};
        radioList.type = "";
        radioList.title = "";
        radioList.list = [];
        radioList.value;

        radioList.importData = function (newList) {
            var list = [];
            newList.forEach(function (item) {
                var obj = {};
                ['label', 'value'].forEach(function (propertyName) {
                    obj[propertyName]  = item[propertyName];
                });
                list.push(obj);
            });
            this.list = list;
        };

        /**
         * 설정이 있는 ion-side-menu는  $ionicView.enter가 발생하지 않아, rootScope에 달아둠.
         * @param value
         */
        radioList.setValue = function (value) {
            this.value = value;
            if (this.type.indexOf('Unit') >= 0) {
                if (Units.setUnit(this.type, this.value)) {
                    Units.saveUnits();
                }
            }
            else if (this.type === 'startupPage' || this.type === 'refreshInterval') {
                var settingsInfo = TwStorage.get("settingsInfo");
                if (settingsInfo === null) {
                    settingsInfo = {
                        startupPage: "0", //시간별날씨
                        refreshInterval: "0" //수동
                    };
                }
                settingsInfo[this.type] = value;
                TwStorage.set("settingsInfo", settingsInfo);
                $rootScope.settingsInfo = settingsInfo;

                if (this.type === 'refreshInterval') {
                    $rootScope.$broadcast('reloadEvent', 'setRefreshInterval');
                }
            }
            else {
                Util.ga.trackEvent('action', 'error', 'unknown type='+this.type);
            }
        };

        radioList.getValue = function () {
            return this.value;
        };

        return radioList;
    })
    .controller('RadioCtrl', function($rootScope, $scope, $ionicHistory, Util, radioList, WeatherInfo) {
        $scope.onClose = function() {
            Util.ga.trackEvent('action', 'click', 'setting.radio back');
            $ionicHistory.goBack();
        };

        console.info(JSON.stringify(radioList));

        function _resetUpdateTimeCities() {
            console.log('reset update time');
            for (var i = 0; i < WeatherInfo.getCityCount(); i += 1) {
                WeatherInfo.reloadCity(i);
            }
            $rootScope.$broadcast('reloadEvent', 'resume');
        }

        $scope.title = radioList.title;
        $scope.list = radioList.list;
        $scope.data = {value: radioList.getValue()};
        $scope.valueChanged = function(item) {
            radioList.setValue(item.value);
            _resetUpdateTimeCities();
        };
    });

