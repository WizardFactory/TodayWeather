/**
 * Created by aleckim on 2018. 1. 2..
 */

var start = angular.module('controller.nation', []);

start.controller('NationCtrl', function($scope, Util, WeatherUtil, $ionicHistory, $ionicLoading, Units) {

    var TYPE_SKY_TEMP   = 0;
    var TYPE_RAIN       = 1;
    var TYPE_WIND       = 2;

    var weatherDataList = [];
    var weatherType = TYPE_SKY_TEMP;
    //0 = sky/temp, 1 = rain, 2 = wind

    $scope.imgPath = Util.imgPath;

    $scope.getNationName = function () {
        if (Util.region === 'KR') {
            return 'LOC_KOREA';
        }
        else if (Util.region === 'JP') {
            return 'LOC_CHINA';
        }
        else if (Util.region === 'CN') {
            return 'LOC_CHINA';
        }
        else if (Util.region === 'US') {
            return 'LOC_USA';
        }
        else if (Util.region === 'GB') {
            return 'LOC_UK';
        }
    };

    $scope.cityList = [
        {name:"서울", top: 60, left: 100},
        {name:"춘천", top: 20, left: 160},
        {name:"강릉", top: 40, left: 230},
        {name:"대전", top: 155, left: 90},
        {name:"청주", top: 130, left: 164},
        {name:"전주", top: 240, left: 78},
        {name:"광주", top: 322, left: 74},
        {name:"대구", top: 220, left: 190},
        {name:"부산", top: 300, left: 230},
        {name:"제주", top: 420, left: 60},
        {name:"인천", top: 70, left: 36},
        {name:"목포", top: 360, left: 0},
        {name:"여수", top: 320, left: 135},
        {name:"안동", top: 130, left: 225},
        {name:"울산", top: 220, left: 270}
    ];

    $scope.onClose = function() {
        Util.ga.trackEvent('action', 'click', 'nation back');
        //convertUnits
        $ionicHistory.goBack();
    };

    $scope.region = Util.region;

    $scope.changeWeatherType = function (type) {
        weatherType = type;
    };

    $scope.getIcon = function (name) {
        var icon;
        var city;
        try {
            if (!Array.isArray(weatherDataList)) {
               return icon;
            }
            city = weatherDataList.find(function (obj) {
                return obj.regionName.indexOf(name) != -1;
            });
            if (city) {
                if (weatherType === TYPE_SKY_TEMP || weatherType === TYPE_RAIN) {
                    icon = city.current.skyIcon;
                }
                else if (weatherType === TYPE_WIND) {
                }
            }
        }
        catch (err) {
            Util.ga.trackException(err, false);
        }
        return icon;
    };

    $scope.getText1 = function (name) {
        var text1;
        var city;
        try {
            if (!Array.isArray(weatherDataList)) {
                return text1;
            }
            city = weatherDataList.find(function (obj) {
                return obj.regionName.indexOf(name) != -1;
            });
            if (city) {
                if (weatherType === TYPE_SKY_TEMP) {
                    text1 = city.current.t1h;
                }
                else if (weatherType === TYPE_RAIN) {
                    text1 = city.current.rn1;
                }
                else if (weatherType === TYPE_WIND) {
                    text1 = city.current.wdd;
                }
                $scope.hasText1 = true;
            }
        }
        catch (err) {
            Util.ga.trackException(err, false);
        }
        return text1;
    };

    $scope.getText2 = function (name) {
        var text2;
        var city;
        try {
            if (!Array.isArray(weatherDataList)) {
                return text2;
            }
            city = weatherDataList.find(function (obj) {
                return obj.regionName.indexOf(name) != -1;
            });
            if (city) {
                if (weatherType === TYPE_SKY_TEMP) {
                }
                else if (weatherType === TYPE_RAIN) {
                }
                else if (weatherType === TYPE_WIND) {
                    text2 = city.current.wsd;
                }
            }
        }
        catch (err) {
            Util.ga.trackException(err, false);
        }
        return text2;
    };

    $scope.getText1Unit = function () {
        switch (weatherType) {
            case TYPE_RAIN:
                return Units.getUnit('precipitationUnit');
        }
    };

    $scope.getText2Unit = function () {
        switch (weatherType) {
            case TYPE_WIND:
                return Units.getUnit('windSpeedUnit');
        }
    };

    function init() {
        $ionicLoading.show();
        WeatherUtil.getNationWeather(Util.region)
            .then(
                function (data) {
                    weatherDataList = data.weather;
                },
                function (err) {
                    Util.ga.trackException(err, false);
                }
            )
            .finally(function () {
                $ionicLoading.hide();
                console.info('National weather is loaded');
            });
    }

    init();
});


