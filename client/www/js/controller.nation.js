/**
 * Created by aleckim on 2018. 1. 2..
 */

var start = angular.module('controller.nation', []);

start.controller('NationCtrl', function($scope, Util, WeatherUtil, $ionicHistory, $ionicLoading) {

    var weatherDataList = [];

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
        {name:"광주", top: 327, left: 78},
        {name:"대구", top: 220, left: 190},
        {name:"부산", top: 300, left: 230},
        {name:"제주", top: 420, left: 60},
        {name:"인천", top: 70, left: 40},
        {name:"목포", top: 360, left: 5},
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

    $scope.getCurrentSkyIcon = function (name) {
        var skyIcon;
        var city;
        try {
            if (!Array.isArray(weatherDataList)) {
               return skyIcon;
            }
            city = weatherDataList.find(function (obj) {
                return obj.regionName.indexOf(name) != -1;
            });
            if (city) {
                skyIcon = city.current.skyIcon;
            }
        }
        catch (err) {
            Util.ga.trackException(err, false);
        }
        return skyIcon;
    };

    $scope.getCurrentTemp = function (name) {
        var temp = 0;
        var city;
        try {
            if (!Array.isArray(weatherDataList)) {
                return temp;
            }
            city = weatherDataList.find(function (obj) {
                return obj.regionName.indexOf(name) != -1;
            });
            if (city) {
                temp = city.current.t1h;
            }
        }
        catch (err) {
            Util.ga.trackException(err, false);
        }
        return temp;
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


