/**
 * Created by aleckim on 2016. 5. 10..
 * 현재 빌드 에러로 plugin 제외함, 재 적용시에 setUserDefaults를 사용하는게 아니라, Widget처럼, 관심지역 목록을 전달하고 직접 데이터 업데이트 하게 변경
 */

angular.module('service.applewatch', [])
    .factory('AppleWatch', function() {
        var obj = {};
        obj.loaded;

        function setUserDefaults(data) {
            if (obj.loaded == undefined) {
                return;
            }

            applewatch.sendUserDefaults(function() {
                console.log(data);
            }, function() {
                console.log("Failed to sendUserDefault");
            }, data, "group.net.wizardfactory.todayweather");
        };

        obj.setWeatherData = function (address, cityData) {
            if (obj.loaded == undefined) {
                return;
            }

            var shortestAddress = address.split(",")[1];
            if (!shortestAddress) { shortestAddress = address.split(",")[0];
            }
            setUserDefaults({"Location": shortestAddress || "구름동"});
            setUserDefaults({"Temperature": String(cityData.currentWeather.t1h)+'˚' || "33˚"});
            setUserDefaults({"WeatherComment": cityData.currentWeather.summary || "어제과 같음"});
            setUserDefaults({"WeatherImage": cityData.currentWeather.skyIcon || "Snow"});

            setUserDefaults({"TodayMaxTemp": "99"});
            setUserDefaults({"TodayMinTemp": "0"});
            setUserDefaults({"YesterdayMaxTemp": "99"});
            setUserDefaults({"YesterdayMinTemp": "0"});
            setUserDefaults({"TomorrowMaxTemp": "99"});
            setUserDefaults({"TomorrowMinTemp": "0"});

            for (var i = 0; i < cityData.dayTable.length; i++) {
                if (cityData.dayTable[i].week === "오늘") {
                    setUserDefaults({"TodayMaxTemp": String(cityData.dayTable[i - 1].tmx || 99)});
                    setUserDefaults({"TodayMinTemp": String(cityData.dayTable[i - 1].tmn || 0)});
                    setUserDefaults({"YesterdayMaxTemp": String(cityData.dayTable[i].tmx || 99)});
                    setUserDefaults({"YesterdayMinTemp": String(cityData.dayTable[i].tmn || 0)});
                    setUserDefaults({"TomorrowMaxTemp": String(cityData.dayTable[i + 1].tmx || 99)});
                    setUserDefaults({"TomorrowMinTemp": String(cityData.dayTable[i + 1].tmn || 0)});
                    break;
                }
            }
        };

        return obj;
    })
    .run(function($ionicPlatform) {
        $ionicPlatform.ready(function() {

            if (!ionic.Platform.isIOS()) {
                return;
            }

            if (!window.applewatch) {
                console.log("Need to add plugin apple watch");
                return;
            }

            applewatch.init(function () {
                console.log("Succeeded to initialize for apple-watch");
            }, function (err) {
                console.log('Failed to initialize apple-watch', err);
            }, "group.net.wizardfactory.todayweather");

        });

    });



