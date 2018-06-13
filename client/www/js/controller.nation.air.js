/**
 * Created by aleckim on 2018. 6. 12..
 */

var start = angular.module('controller.nation', []);

start.controller('NationAirCtrl', function($scope, Util, WeatherUtil, $ionicHistory, $ionicLoading, Units) {

    $scope.airTypeList = ['pm2.5', 'pm10', 'o3', 'no2', 'so2', 'co'];
    $scope.airType = $scope.airTypeList[0];
    var airDataList = [];
    var aqiStandard = WeatherUtil.aqiStandard;
    var airUnit;

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

    //'서울', '부산', '대구', '인천', '광주', '대전', '울산', '경기', '강원', '충북', '충남', '전북', '전남', '경북',
    //             '경남', '제주', '세종'
    //         ];
    $scope.cityList = [
        {name:"서울", top: 90, left: 72},
        {name:"부산", top: 300, left: 210},
        {name:"대구", top: 240, left: 190},
        {name:"인천", top: 70, left: 14},
        {name:"광주", top: 322, left: 78},
        {name:"대전", top: 220, left: 110},
        {name:"울산", top: 260, left: 270},
        {name:"제주", top: 420, left: 60},

        {name:"경기", top: 80, left: 130},
        {name:"강원", top: 40, left: 200},
        {name:"충북", top: 140, left: 150},
        {name:"충남", top: 180, left: 24},
        {name:"전북", top: 240, left: 50},
        {name:"전남", top: 340, left: 16},
        {name:"경북", top: 180, left: 225},
        {name:"경남", top: 320, left: 150},
        {name:"세종", top: 170, left: 90},
    ];

    $scope.onClose = function() {
        Util.ga.trackEvent('action', 'click', 'nation back');
        //convertUnits
        $ionicHistory.goBack();
    };

    $scope.region = Util.region;

    $scope.changeAirType = function (type) {
        $scope.airType = type;
    };

    function _findCity(name, list) {
        return list.find(function (obj) {
            return obj.sidoName === name;
        });
    }

    $scope.getText1 = function (name) {
        var text1;
        var city;
        try {
            if (!Array.isArray(airDataList)) {
                return text1;
            }
            city = _findCity(name, airDataList);
            if (city) {
                var airType = $scope.airType === 'pm2.5'?'pm25':$scope.airType;
                text1 = city[airType+'Value'];
                $scope.hasText1 = true;
            }
        }
        catch (err) {
            Util.ga.trackException(err, false);
        }
        return text1;
    };

    $scope.grade2Color = function (cityName) {
        var RGB = '#000000';
        var A = 0.4;
        var color = 'rgba(0, 0, 0, 0.4)';

        try {
            var city = _findCity(cityName, airDataList);
            var airType = $scope.airType === 'pm2.5'?'pm25':$scope.airType;
            if (city == undefined || city[airType+'Grade'] == undefined) {
                return color;
            }
            var grade = city[airType+'Grade'];
            var standard = aqiStandard[airUnit];

            // if (grade > $scope.aqiStandard.length) {
            //     Util.ga.trackEvent('air', 'error', 'invalidGradeAtGrade2Color', grade);
            //     grade = $scope.aqiStandard.length;
            // }
            RGB = standard.color[grade-1];
            A = 0.8;
            color = 'rgba('+parseInt(RGB.substring(1,3),16)+','+
            parseInt(RGB.substring(3,5),16)+','+
            parseInt(RGB.substring(5,7),16)+','+A+')';
            console.log('color:'+color);
        }
        catch (err) {
            Util.ga.trackException(err, false);
        }
        return color;
    };

    function init() {
        airUnit = Units.getUnit('airUnit');
        $ionicLoading.show();
        WeatherUtil.getNationWeather(Util.region)
            .then(
                function (data) {
                    airDataList = data.air;
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
