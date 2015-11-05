
angular.module('starter.controllers', [])

    .controller('ForecastCtrl', function ($scope, $ionicPlatform, $ionicScrollDelegate, $ionicPopup,
                                          $timeout, $interval, $http, $q, WeatherUtil)
    {
        $scope.skipGuide = false;
        if(typeof(Storage) !== "undefined") {
            if (localStorage.getItem("skipGuide") !== null) {
                $scope.skipGuide = localStorage.getItem("skipGuide");
            }
        }
        $scope.shortForecast = true;
        $scope.forecastType = 'short'; //mid, detail

        //String
        $scope.address = "";

        //{time: Number, t1h: Number, sky: String, tmn: Number, tmx: Number, summary: String};
        $scope.currentWeather;

        //{day: String, time: Number, t3h: Number, sky: String, pop: Number, tempIcon: String, tempInfo: String, tmn: Number, tmx: Number}
        $scope.timeTable = [];
        //{week: String, sky:String, pop: Number, humidityIcon: String, reh: Number, tmn: Number, tmx: Number};
        $scope.dayTable = [];

        //[ {name: String, values:[{name: String, value: Number}, ]},
        //  {name: String, values:[{name: String, value: number}, ]} ]
        $scope.timeChart;
        //
        $scope.dayChart;

        //10월 8일(수) 12:23 AM
        $scope.currentTimeString;

        //String
        var fullAddress = null;
        var currentTime = new Date();

        //{date: String, sky: String, tmx: Number, tmn: Number, reh: Number}
        var dailyInfoArray = [];

        //{"lat": Number, "long": Number};
        var location;

        var colWidth;

        var deploy = new Ionic.Deploy();
        // "dev" is the channel tag for the Dev channel.
        //deploy.setChannel("Dev");

        // Check Ionic Deploy for new code
        function checkForUpdates() {
            var deferred = $q.defer();

            console.log('Ionic Deploy: Checking for updates');
            deploy.info().then(function(deployInfo) {
                console.log(deployInfo);
            }, function() {}, function() {});

            deploy.check().then(function(hasUpdate) {
                console.log('Ionic Deploy: Update available: ' + hasUpdate);
                if (hasUpdate) {
                    showConfirm("업데이트", "새로운 버전이 확인되었습니다. 업데이트 하시겠습니까?", function (res) {
                        if (res)   {
                            // Update app code with new release from Ionic Deploy
                            $scope.currentWeather.summary = '업데이트 시작';
                            deploy.update().then(function (res) {
                                $scope.currentWeather.summary = '최신버젼으로 업데이트 되었습니다! ' + res;
                                deferred.resolve();
                            }, function (err) {
                                $scope.currentWeather.summary = '업데이트 실패 ' + err;
                                deferred.reject();
                            }, function (prog) {
                                $scope.currentWeather.summary = '업데이트중 ' + prog + '%';
                            });
                        }
                        else {
                            deferred.reject();
                        }
                    });
                }
                else {
                    deferred.resolve();
                }
            }, function(err) {
                console.log('Ionic Deploy: Unable to check for updates', err);
                deferred.reject();
            });

            return deferred.promise;
        }

        /**
         * Identifies a user with the Ionic User service
         */
        function identifyUser() {
            console.log('User: Identifying with User service');

            // kick off the platform web client
            Ionic.io();

            // this will give you a fresh user or the previously saved 'current user'
            var user = Ionic.User.current();

            // if the user doesn't have an id, you'll need to give it one.
            if (!user.id) {
                user.id = Ionic.User.anonymousId();
                // user.id = 'your-custom-user-id';
            }

            //persist the user
            user.save();
        }

        /**
         *
         * @param {String} fullAddress 대한민국 천하도 강남시 하늘구 가내동 33-2, 대한민국 서울특별시 라임구 마라동
         * @returns {String[]}
         */
        function splitAddress(fullAddress) {
            var splitAddress = [];
            if (fullAddress && fullAddress.split) {
                splitAddress = fullAddress.split(" ");
            }
            return splitAddress;
        }

        /**
         * It's supporting only korean lang
         * return only city namd and dong name
         * @param {String} fullAddress
         * @returns {string}
         */
        function getShortenAddress(fullAddress) {
            var parsedAddress = splitAddress(fullAddress);
            if (!parsedAddress || parsedAddress.length < 2) {
                console.log("Fail to split full address="+fullAddress);
                return "";
            }
            if (parsedAddress.length === 5) {
                //대한민국, 경기도, 성남시, 분당구, 수내동
                parsedAddress.splice(0, 2);
            }
            else if (parsedAddress.length === 4) {
                //대한민국, 서울특별시, 송파구, 잠실동
                parsedAddress.splice(0, 1);
            }
            else if (parsedAddress.length === 3) {
                //대한민국,세종특별자치시, 금난면,
                parsedAddress.splice(0, 1);
            }
            else {
                console.log('Fail to get shorten from ='+fullAddress);
            }
            parsedAddress.splice(1, 1);
            parsedAddress.splice(2, 1);

            console.log(parsedAddress.toString());

            return parsedAddress.toString();
        }

        /**
         *
         * @param {String[]} addressArray
         * @param {cbWeatherInfo} callback
         */
        function getWeatherInfo(addressArray, callback) {
            //var url = 'town';
            var url = 'https://d2ibo8bwl7ifj5.cloudfront.net/town';
            //var url = 'http://todayweather1-wizardfactory.rhcloud.com/town';

            if (!Array.isArray(addressArray) || addressArray.length === 0) {
                return callback(new Error("addressArray is NOT array"));
            }

            if (addressArray.length === 5) {
                url += '/'+addressArray[1]+'/'+addressArray[2]+addressArray[3]+'/'+addressArray[4];
            }
            else if (addressArray.length === 4) {
                url += '/'+addressArray[1]+'/'+addressArray[2]+'/'+addressArray[3];
            }
            else if (addressArray.length === 3) {
                url += '/'+addressArray[1]+'/'+addressArray[1]+'/'+addressArray[2];
            }
            else {
                var err = new Error("Fail to parse address array="+addressArray.toString());
                console.log(err);
                return callback(err);
            }

            console.log(url);

            $http({method: 'GET', url: url})
                .success(function(data) {
                    console.log(data);
                    callback(undefined, data);
                })
                .error(function(error) {
                    if (!error) {
                        error = new Error("Fail to get weatherInfo");
                    }
                    console.log(error);
                    callback(error);
                });
        }
        /**
         * @callback cbWeatherInfo
         */

        function getCurrentPosition() {
            var deferred = $q.defer();

            navigator.geolocation.getCurrentPosition(function(position) {
                //경기도,광주시,오포읍,37.36340556,127.2307667
                //deferred.resolve({latitude: 37.363, longitude: 127.230});
                //세종특별자치시,세종특별자치시,연기면,36.517338,127.259247
                //deferred.resolve({latitude: 36.51, longitude: 127.259});

                deferred.resolve(position.coords);
            }, function(error) {
                console.log(error);
                deferred.reject();
            },{timeout:3000});
            return deferred.promise;
        }

        /**
         * It's supporting only korean lang
         * @param {Object[]} results
         * @returns {string}
         */
        function findDongAddressFromGoogleGeoCodeResults(results) {
            var dongAddress = "";
            var length = 0;
            results.forEach(function (result) {
                var lastChar = result.formatted_address.slice(-1);
                if (lastChar === '동' || lastChar === '읍' || lastChar === '면')  {
                    if(length < result.formatted_address.length) {
                        dongAddress = result.formatted_address;
                        length = result.formatted_address.length;
                    }
                }
            });
            if (dongAddress.length === 0) {
                console.log("Fail to find index of dong from="+results[0].formatted_address);
            }
            return dongAddress;
        }

        /**
         *
         * @param {Number} lat
         * @param {Number} long
         */
        function getAddressFromGeolocation(lat, long) {
            var deferred = $q.defer();
            var url = "https://maps.googleapis.com/maps/api/geocode/json?latlng=" + lat + "," + long +
                        "&sensor=true&language=ko";

            $http({method: 'GET', url: url}).success(function (data) {
                if (data.status === 'OK') {
                    var address = findDongAddressFromGoogleGeoCodeResults(data.results);
                    if (!address || address.length === 0) {
                        deferred.reject(new Error("Fail to find dong address from " + data.results[0].formatted_address));
                    }
                    console.log(address);
                    deferred.resolve(address);
                }
                else {
                    //'ZERO_RESULTS', 'OVER_QUERY_LIMIT', 'REQUEST_DENIED',  'INVALID_REQUEST', 'UNKNOWN_ERROR'
                    deferred.reject(new Error(data.status));
                }
            }).error(function (err) {
                deferred.reject(err);
            });

            return deferred.promise;
        }

        /**
         *
         * @param {Object} current
         * @param {Object} yesterday
         * @returns {String}
         */
        function makeSummary(current, yesterday) {
            var str = "어제";
            var diffTemp = current.t1h - yesterday.t3h;

            if (diffTemp == 0) {
               return str += "와 동일";
            }

            str += "보다 " + Math.abs(diffTemp);
            if (diffTemp < 0) {
                str += "도 낮음";
            }
            else if (diffTemp > 0) {
                str += "도 높음";
            }
            return str;
        }

        /**
         *
         * @param weatherData
         */
        function setWeatherData(weatherData) {
            var currentForecast = WeatherUtil.parseCurrentTownWeather(weatherData.current);

            dailyInfoArray = WeatherUtil.parsePreShortTownWeather(weatherData.short);

            /*
            parseShortWeather에서 currentForcast에 체감온도를 추가 함, scope에 적용전에 parseShortTownWeather를 해야 함
             */
            var parsedWeather = WeatherUtil.parseShortTownWeather(weatherData.short, currentForecast, currentTime, dailyInfoArray);
            currentForecast.summary = makeSummary(currentForecast, parsedWeather.timeTable[0]);

            $scope.timeTable = parsedWeather.timeTable;
            $scope.timeChart = parsedWeather.timeChart;

            /*
            parseMidTownWeather에서 currentForecast에 자외선지수를 추가 함
             */
            $scope.dayTable = WeatherUtil.parseMidTownWeather(weatherData.midData, dailyInfoArray, currentTime, currentForecast);

            $scope.currentWeather = currentForecast;

            $scope.dayChart = [{
                values: $scope.dayTable,
                temp: $scope.currentWeather.t1h
            }];

            localStorage.setItem("currentWeather", JSON.stringify(currentForecast));
            localStorage.setItem("timeTable", JSON.stringify(parsedWeather.timeTable));
            localStorage.setItem("timeChart", JSON.stringify(parsedWeather.timeChart));
            localStorage.setItem("dayTable", JSON.stringify($scope.dayTable));
            localStorage.setItem("dayChart", JSON.stringify($scope.dayChart));

            console.log($scope.currentWeather);
            console.log($scope.timeChart.length);
            console.log($scope.timeChart);
        }

        function updateWeatherData() {
            var deferred = $q.defer();
            var preUpdate = false;
            var addressUpdate = false;

            if(fullAddress)  {
                getWeatherInfo(splitAddress(fullAddress), function (err, weatherData) {
                    // 1: resolved, 2: rejected
                    if (deferred.promise.$$state.status === 1 || deferred.promise.$$state.status === 2) {
                        return;
                    }
                    if (!err) {
                        preUpdate = true;
                        $scope.address = getShortenAddress(fullAddress);
                        setWeatherData(weatherData);
                        deferred.notify();
                    }
                    if (addressUpdate === true) {
                        deferred.resolve();
                    }
                });
            }

            getCurrentPosition().then(function (coords) {
                location = {"lat": coords.latitude, "long": coords.longitude};
                localStorage.setItem("location", JSON.stringify(location));
                console.log(location);

                getAddressFromGeolocation(coords.latitude, coords.longitude).then(function (address) {
                    if (fullAddress === address) {
                        addressUpdate = true;
                        if (preUpdate === true) {
                            console.log("Already updated current position weather data");
                            deferred.resolve();
                        }
                    }
                    else {
                        fullAddress = address;
                        console.log(fullAddress);

                        localStorage.setItem("fullAddress", fullAddress);
                        $scope.address = getShortenAddress(fullAddress);

                        getWeatherInfo(splitAddress(fullAddress), function (error, weatherData) {
                            if (error) {
                                deferred.reject();
                            }
                            else {
                                $scope.address = getShortenAddress(fullAddress);
                                setWeatherData(weatherData);
                                deferred.notify();
                                deferred.resolve();
                            }
                        });
                    }
                }, function (err) {
                    var str = "현재 위치에 대한 정보를 찾을 수 없습니다.";
                    showAlert("에러", str);
                    deferred.reject();
                });
            }, function () {
                var str = '현재 위치를 찾을 수 없습니다.';
                if (ionic.Platform.isAndroid()) {
                    str += '<br>WIFI와 위치정보를 켜주세요.';
                }
                showAlert("에러", str);
                deferred.reject();
            });

            return deferred.promise;
        }

        /**
         *
         * @returns {boolean}
         */
        function loadStorage() {
            if (typeof(Storage) === "undefined") {
                return false;
            }

            fullAddress = localStorage.getItem("fullAddress");
            if (!fullAddress || fullAddress === 'undefined') {
                fullAddress = null;
                return false;
            }
            try {
                $scope.address = getShortenAddress(fullAddress);
                console.log($scope.address);
                location = JSON.parse(localStorage.getItem("location"));
                console.log($scope.location);
                $scope.currentWeather = JSON.parse(localStorage.getItem("currentWeather"));
                console.log($scope.currentWeather);
                $scope.timeTable = JSON.parse(localStorage.getItem("timeTable"));
                console.log($scope.timeTable);
                $scope.timeChart = JSON.parse(localStorage.getItem("timeChart"));
                console.log($scope.timeChart);
                $scope.dayTable = JSON.parse(localStorage.getItem("dayTable"));
                console.log($scope.dayTable);
                $scope.dayChart = JSON.parse(localStorage.getItem("dayChart"));
                console.log($scope.dayChart);
                return true;
            }
            catch(error) {
               return false;
            }
        }

        function loadGuideData() {
            fullAddress = "대한민국 하늘시 중구 구름동";
            $scope.address = getShortenAddress(fullAddress);
            $scope.currentWeather = {time: 7, t1h: 19, sky: "SunWithCloud", tmn: 14, tmx: 28, summary: "어제보다 1도 낮음"};

            var timeData = [];
            timeData[0] = {day: "", time: "6시", t3h: 17, sky:"Cloud", pop: 10, tempIcon:"Temp-01", tmn: 17};
            timeData[1] = {day: "", time: "9시", t3h: 21, sky:"Lightning", pop: 20, tempIcon:"Temp-02"};
            timeData[2] = {day: "", time: "12시", t3h: 26, sky:"Moon", pop: 30, tempIcon:"Temp-03"};
            timeData[3] = {day: "", time: "15시", t3h: 28, sky:"MoonWithCloud", pop: 40, tempIcon:"Temp-04", tmx: 28};
            timeData[4] = {day: "", time: "18시", t3h: 26, sky:"Rain", pop: 50, tempIcon:"Temp-05"};
            timeData[5] = {day: "", time: "21시", t3h: 21, sky:"RainWithLightning", pop: 60, tempIcon:"Temp-06"};
            timeData[6] = {day: "어제", time: "0시", t3h: 18, sky:"RainWithSnow", pop: 70, tempIcon:"Temp-07"};
            timeData[7] = {day: "", time: "3시", t3h: 16, sky:"Snow", pop: 80, tempIcon:"Temp-08"};
            timeData[8] = {day: "", time: "6시", t3h: 15, sky:"SnowWithLightning-Big", pop: 90, tempIcon:"Temp-09", tmn: 15};
            timeData[9] = {day: "", time: "9시", t3h: 21, sky:"Sun", pop: 10, tempIcon:"Temp-10"};
            timeData[10] = {day: "", time: "12시", t3h: 26, sky:"SunWithCloud", pop: 20, tempIcon:"Temp-10"};
            timeData[11] = {day: "", time: "15시", t3h: 28, sky:"WindWithCloud", pop: 30, tempIcon:"Temp-01"};
            timeData[12] = {day: "", time: "18시", t3h: 29, sky:"Rain", pop: 50, tempIcon:"Temp-04", tmx: 29};
            timeData[13] = {day: "", time: "21시", t3h: 21, sky:"RainWithLightning", pop: 60, tempIcon:"Temp-05"};
            timeData[14] = {day: "오늘", time: "0시", t3h: 18, sky:"RainWithSnow", pop: 70, tempIcon:"Temp-06"};
            timeData[15] = {day: "", time: "3시", t3h: 15, sky:"Snow", pop: 80, tempIcon:"Temp-07"};
            timeData[16] = {day: "", time: "지금", t3h: 14, sky:"SnowWithLightning-Big", pop: 90, tempIcon:"Temp-08", tmn: 14};
            timeData[17] = {day: "", time: "9시", t3h: 21, sky:"Cloud", pop: 10, tempIcon:"Temp-09"};
            timeData[18] = {day: "", time: "12시", t3h: 26, sky:"Lightning", pop: 20, tempIcon:"Temp-10"};
            timeData[19] = {day: "", time: "15시", t3h: 29, sky:"Moon", pop: 30, tempIcon:"Temp-01", tmx: 29};
            timeData[20] = {day: "", time: "18시", t3h: 28, sky:"MoonWithCloud", pop: 50, tempIcon:"Temp-04"};
            timeData[21] = {day: "", time: "21시", t3h: 22, sky:"Rain", pop: 60, tempIcon:"Temp-05"};
            timeData[22] = {day: "내일", time: "0시", t3h: 20, sky:"RainWithSnow", pop: 70, tempIcon:"Temp-06"};
            timeData[23] = {day: "", time: "3시", t3h: 18, sky:"RainWithLightning", pop: 80, tempIcon:"Temp-07"};
            timeData[24] = {day: "", time: "6시", t3h: 17, sky:"SnowWithLightning-Big", pop: 90, tempIcon:"Temp-08", tmn: 17};
            timeData[25] = {day: "", time: "9시", t3h: 21, sky:"Sun", pop: 10, tempIcon:"Temp-09"};
            timeData[26] = {day: "", time: "12시", t3h: 27, sky:"SunWithCloud", pop: 20, tempIcon:"Temp-10"};
            timeData[27] = {day: "", time: "15시", t3h: 29, sky:"WindWithCloud", pop: 30, tempIcon:"Temp-01", tmn: 29};
            timeData[28] = {day: "", time: "18시", t3h: 28, sky:"Rain", pop: 50, tempIcon:"Temp-04"};
            timeData[29] = {day: "", time: "21시", t3h: 24, sky:"RainWithLightning", pop: 60, tempIcon:"Temp-05"};
            timeData[30] = {day: "모레", time: "0시", t3h: 21, sky:"RainWithSnow", pop: 70, tempIcon:"Temp-06"};
            timeData[31] = {day: "", time: "3시", t3h: 18, sky:"Snow", pop: 80, tempIcon:"Temp-07"};
            //timeData[32] = {day: "", time: "6시", t3h: 17, sky:"SnowWithLightning-Big", pop: 90, tempIcon:"Temp-08"};
            //timeData[33] = {day: "", time: "9시", t3h: 21, sky:"Sun", pop: 10, tempIcon:"Temp-09"};
            //timeData[34] = {day: "", time: "12시", t3h: 26, sky:"SunWithCloud", pop: 20, tempIcon:"Temp-10"};
            //timeData[35] = {day: "", time: "15시", t3h: 29, sky:"WindWithCloud", pop: 30, tempIcon:"Temp-01"};
            //timeData[36] = {day: "", time: "18시", t3h: 26, sky:"Rain", pop: 50, tempIcon:"Temp-04"};
            //timeData[37] = {day: "", time: "21시", t3h: 23, sky:"RainWithLightning", pop: 60, tempIcon:"Temp-05"};
            //timeData[38] = {day: "글피", time: "0시", t3h: 18, sky:"RainWithSnow", pop: 70, tempIcon:"Temp-06"};
            //timeData[39] = {day: "", time: "3시", t3h: 18, sky:"Snow", pop: 80, tempIcon:"Temp-07"};

            $scope.timeTable = timeData.slice(8);
            $scope.timeChart = [
                {
                    name: 'yesterday',
                    values: timeData.slice(0, timeData.length - 8).map(function (d) {
                        return { name: 'yesterday', value: d };
                    })
                },
                {
                    name: 'today',
                    values: timeData.slice(8).map(function (d) {
                        return { name: 'today', value: d };
                    })
                }
            ];

            var dayData = [];
            dayData[0] = {week: "목", sky:"Cloud", pop: 10, humidityIcon:"Humidity-10", reh: 10, tmn: 10, tmx: 28};
            dayData[1] = {week: "금", sky:"Lightning", pop: 20, humidityIcon:"Humidity-20", reh: 10, tmn: 17, tmx: 26};
            dayData[2] = {week: "토", sky:"Moon", pop: 30, humidityIcon:"Humidity-30", reh: 10, tmn: 16, tmx: 23};
            dayData[3] = {week: "일", sky:"MoonWithCloud", pop: 40, humidityIcon:"Humidity-40", reh: 10, tmn: 14, tmx: 22};
            dayData[4] = {week: "월", sky:"Rain", pop: 50, humidityIcon:"Humidity-50", reh: 10, tmn: 14, tmx: 22};
            dayData[5] = {week: "화", sky:"RainWithLightning", pop: 60, humidityIcon:"Humidity-60", reh: 10, tmn: 12, tmx: 22};
            dayData[6] = {week: "수", sky:"RainWithSnow", pop: 70, humidityIcon:"Humidity-70", reh: 10, tmn: 15, tmx: 27};
            dayData[7] = {week: "오늘", sky:"Snow", pop: 80, humidityIcon:"Humidity-80", reh: 10, tmn: 15, tmx: 25};
            dayData[8] = {week: "금", sky:"SnowWithLightning-Big", pop: 90, humidityIcon:"Humidity-90", reh: 10, tmn: 15, tmx: 22};
            dayData[9] = {week: "토", sky:"Sun", pop: 10, humidityIcon:"Humidity-10", reh: 10, tmn: 12, tmx: 22};
            dayData[10] = {week: "일", sky:"SunWithCloud", pop: 20, humidityIcon:"Humidity-10", reh: 10, tmn: 17, tmx: 28};
            dayData[11] = {week: "월", sky:"WindWithCloud", pop: 30, humidityIcon:"Humidity-10", reh: 10, tmn: 17, tmx: 27};
            dayData[12] = {week: "화", sky:"Rain", pop: 50, humidityIcon:"Humidity-40", reh: 10, tmn: 17, tmx: 26};
            dayData[13] = {week: "수", sky:"RainWithLightning", pop: 60, humidityIcon:"Humidity-50", reh: 10, tmn: 16, tmx: 24};
            dayData[14] = {week: "목", sky:"RainWithSnow", pop: 70, humidityIcon:"Humidity-60", reh: 10, tmn: 15, tmx: 28};
            dayData[15] = {week: "금", sky:"Snow", pop: 80, humidityIcon:"Humidity-70", reh: 10, tmn: 17, tmx: 26};
            dayData[16] = {week: "토", sky:"SnowWithLightning-Big", pop: 90, humidityIcon:"Humidity-80", reh: 10, tmn: 13, tmx: 24};
            dayData[17] = {week: "일", sky:"Cloud", pop: 10, humidityIcon:"Humidity-90", reh: 10, tmn: 12, tmx: 25};

            $scope.dayTable = dayData;
            $scope.dayChart = [{
                values: dayData,
                temp: $scope.currentWeather.t1h
            }];
        }

        function getWidthPerCol() {
            if (colWidth)  {
                return colWidth;
            }

            var bodyWidth =  angular.element(document).find('body')[0].offsetWidth;
            console.log("body of width="+bodyWidth);

            switch (bodyWidth) {
                case 320:   //iphone 4,5
                    colWidth = 53;
                    break;
                case 375:   //iphone 6
                    colWidth = 53;
                    break;
                case 414:   //iphone 6+
                    colWidth =  59;
                    break;
                case 360:   //s4, note3
                default:
                    colWidth = 52;
                    break;
            }
            return colWidth;
        }

        function getTodayNowPosition(index) {
            return getWidthPerCol()*index;
        }

        function showAlert(title, msg) {
            var alertPopup = $ionicPopup.alert({
                title: title,
                template: msg
            });
            alertPopup.then(function(res) {
                console.log('alertPopup close');
            });
        }

        function showConfirm(title, template, callback) {
            var confirmPopup = $ionicPopup.confirm({
                title: title,
                template: template
            });
            confirmPopup.then(function (res) {
                if (res) {
                    console.log('You are sure');
                } else {
                    console.log('You are not sure');
                }
                callback(res);
            });
        }

        identifyUser();

        $scope.address = "위치 찾는 중";
        $scope.currentTimeString = WeatherUtil.convertTimeString(currentTime);

        $scope.doRefresh = function() {
            updateWeatherData().finally(function (res) {
                $scope.$broadcast('scroll.refreshComplete');
            }, function (msg) {
                //update weather data
                $ionicScrollDelegate.$getByHandle('timeChart').scrollTo(getTodayNowPosition(7), 0, false);
                $ionicScrollDelegate.$getByHandle('weeklyChart').scrollTo(getTodayNowPosition(5), 0, false);
            });
        };

        $scope.onClickGuide = function() {
            if(typeof(Storage) !== "undefined") {
                localStorage.setItem("skipGuide", true);
            }
            $scope.skipGuide = true;
        };

        $ionicPlatform.ready(function() {
            //set default data or lastest saved data
            var isExist = loadStorage();
            if (isExist === false) {
                loadGuideData();
                $timeout(function() {
                    $ionicScrollDelegate.$getByHandle('timeChart').scrollTo(getTodayNowPosition(7), 0, false);
                    $ionicScrollDelegate.$getByHandle('weeklyChart').scrollTo(getTodayNowPosition(5), 0, false);
                },0);
            }

            checkForUpdates().finally(function (res) {
                loadWeatherData();
            });

            var loadWeatherData = function () {
                if (isExist === true) {
                    updateWeatherData().finally(function (res) {
                        //resolve or reject
                    }, function (msg) {
                        //update weather data
                        $ionicScrollDelegate.$getByHandle('timeChart').scrollTo(getTodayNowPosition(7), 0, false);
                        $ionicScrollDelegate.$getByHandle('weeklyChart').scrollTo(getTodayNowPosition(5), 0, false);
                    });
                }
            };
        });

        $interval(function() {
            var newDate = new Date();
            if(newDate.getMinutes() != currentTime.getMinutes()) {
                currentTime = newDate;
                $scope.currentTimeString =  WeatherUtil.convertTimeString(currentTime);
            }
        }, 1000);
    })

    .controller('SearchCtrl', function ($scope, Chats) {
        // With the new view caching in Ionic, Controllers are only called
        // when they are recreated or on app start, instead of every page change.
        // To listen for when this page is active (for example, to refresh data),
        // listen for the $ionicView.enter event:
        //
        //$scope.$on('$ionicView.enter', function(e) {
        //});

        $scope.chats = Chats.all();
        $scope.remove = function(chat) {
            Chats.remove(chat);
        };
    })

    .controller('SettingCtrl', function($scope, $interval, $ionicAnalytics, $ionicPlatform, $cordovaInAppBrowser
                , $ionicPopup, WeatherUtil) {
        // With the new view caching in Ionic, Controllers are only called
        // when they are recreated or on app start, instead of every page change.
        // To listen for when this page is active (for example, to refresh data),
        // listen for the $ionicView.enter event:
        //
        //$scope.$on('$ionicView.enter', function(e) {
        //});

        $scope.version  = '0.0.0';

        var currentTime = new Date();

        $scope.currentTimeString = WeatherUtil.convertTimeString(currentTime);

        var deploy = new Ionic.Deploy();
        deploy.info().then(function(deployInfo) {
            console.log(deployInfo);
            $scope.version = deployInfo.binary_version;
        }, function() {}, function() {});

        $scope.openMarket = function(){
            var src = '';
            if (ionic.Platform.isIOS()) {
                src = 'https://itunes.apple.com/us/app/todayweather/id1041700694';
            }
            else if (ionic.Platform.isAndroid()) {
                src = 'https://play.google.com/store/apps/details?id=net.wizardfactory.todayweather';
            }
            else {
                src = 'https://www.facebook.com/TodayWeather.WF';
            }
            var options = {
                location: 'yes',
                clearcache: 'yes',
                toolbar: 'no'
            };
            $cordovaInAppBrowser.open(src, '_blank', options)
                .then(function(event) {
                    console.log(event);
                    // success
                })
                .catch(function(event) {
                    console.log('error');
                    console.log(event);
                    // error
                });
        };

        $scope.openInfo = function () {
            var msg = '기상정보 : 기상청 <br> 대기오염정보 : 환경부/한국환경공단 <br> 인증되지 않은 실시간 자료이므로 자료 오류가 있을 수 있습니다.';
            var alertPopup = $ionicPopup.alert({
                title: 'TodayWeather',
                template: msg
            });
            alertPopup.then(function(res) {
                console.log('alertPopup close');
            });
        };
        $interval(function() {
            var newDate = new Date();
            if(newDate.getMinutes() != currentTime.getMinutes()) {
                currentTime = newDate;
                $scope.currentTimeString =  convertTimeString(currentTime);
            }
        }, 1000);

        $ionicPlatform.ready(function() {

            console.log($ionicAnalytics.globalProperties);
            console.log(ionic.Platform);
        });
    })

    .controller('TabCtrl', function($scope){

    })

    .controller('ChatDetailCtrl', function($scope, $stateParams, Chats) {
        $scope.chat = Chats.get($stateParams.chatId);
    })

    .controller('AccountCtrl', function($scope) {
        $scope.settings = {
            enableFriends: true
        };
    });

