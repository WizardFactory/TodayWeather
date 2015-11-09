
angular.module('starter.controllers', [])

    .controller('ForecastCtrl', function ($scope, $ionicPlatform, $ionicAnalytics, $ionicScrollDelegate, $ionicPopup,
                                          $q, $http, $timeout, WeatherInfo, WeatherUtil, $rootScope) {

        $scope.skipGuide = false;
        if(typeof(Storage) !== "undefined") {
            if (localStorage.getItem("skipGuide") !== null) {
                $scope.skipGuide = localStorage.getItem("skipGuide");
            }
        }
        $scope.shortForecast = true;
        $scope.forecastType = "short"; //mid, detail

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

        //String
        var fullAddress = null;
        var currentTime = new Date();

        //{date: String, sky: String, tmx: Number, tmn: Number, reh: Number}
        var dailyInfoArray = [];

        //{"lat": Number, "long": Number};
        var location;

        var colWidth;

        var city;

        $scope.$on('$ionicView.beforeEnter', function() {
            $rootScope.viewColor = '#22a1db';
        });

        $scope.changeForecastType = function() {
            if ($scope.forecastType === 'short') {
                $scope.forecastType = 'mid';
                $rootScope.viewColor = '#0fbe96';
                $ionicScrollDelegate.$getByHandle("weeklyChart").scrollTo(getTodayNowPosition(5), 0, false);
            }
            else if ($scope.forecastType === 'mid') {
                $scope.forecastType = 'detail';
                $rootScope.viewColor = '#8dc63f';
            }
            else if ($scope.forecastType === 'detail') {
                $scope.forecastType = 'short';
                $rootScope.viewColor = '#22a1db';
                $ionicScrollDelegate.$getByHandle("timeChart").scrollTo(getTodayNowPosition(7), 0, false);
            }
        };

        var deploy = new Ionic.Deploy();
        // "dev" is the channel tag for the Dev channel.
        //deploy.setChannel("Dev");
        // Check Ionic Deploy for new code
        function checkForUpdates() {
            var deferred = $q.defer();

            console.log("Ionic Deploy: Checking for updates");
            deploy.info().then(function(deployInfo) {
                console.log(deployInfo);
            }, function() {}, function() {});

            deploy.check().then(function(hasUpdate) {
                console.log("Ionic Deploy: Update available: " + hasUpdate);
                if (hasUpdate) {
                    showConfirm("업데이트", "새로운 버전이 확인되었습니다. 업데이트 하시겠습니까?", function (res) {
                        if (res)   {
                            // Update app code with new release from Ionic Deploy
                            $scope.currentWeather.summary = "업데이트 시작";
                            deploy.update().then(function (res) {
                                $scope.currentWeather.summary = "최신버젼으로 업데이트 되었습니다! " + res;
                                deferred.resolve();
                            }, function (err) {
                                $scope.currentWeather.summary = "업데이트 실패 " + err;
                                deferred.reject();
                            }, function (prog) {
                                $scope.currentWeather.summary = "업데이트중 " + prog + "%";
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
                console.log("Ionic Deploy: Unable to check for updates", err);
                deferred.reject();
            });

            return deferred.promise;
        }

        /**
         * Identifies a user with the Ionic User service
         */
        function identifyUser() {
            console.log("User: Identifying with User service");

            // kick off the platform web client
            Ionic.io();

            // this will give you a fresh user or the previously saved 'current user'
            var user = Ionic.User.current();

            // if the user doesn't have an id, you'll need to give it one.
            if (!user.id) {
                user.id = Ionic.User.anonymousId();
                // user.id = "your-custom-user-id";
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
                console.log("Fail to get shorten from ="+fullAddress);
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
            //var url = "town";
            //var url = "https://todayweather1-wizardfactory.rhcloud.com/town";
            //var url = "https://todayweather2-wizardfactory.rhcloud.com/town";
            var url = "https://d2ibo8bwl7ifj5.cloudfront.net/town";

            if (!Array.isArray(addressArray) || addressArray.length === 0) {
                return callback(new Error("addressArray is NOT array"));
            }

            var town = WeatherUtil.getTownFromFullAddress(addressArray);
            url += "/"+town.first+"/"+town.second+"/"+town.third;

            console.log(url);
            setUserDefaults({"TownWeatherUrl": url});

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
         *
         * @param {Object} current
         * @param {Object} yesterday
         * @returns {String}
         */
        function makeSummary(current, yesterday) {
            var str = "어제";
            var diffTemp = current.t1h - yesterday.t3h;

            if (diffTemp == 0) {
               str += "와 동일";
            }
            else {
                str += "보다 " + Math.abs(diffTemp);
                if (diffTemp < 0) {
                    str += "도 낮음";
                }
                else if (diffTemp > 0) {
                    str += "도 높음";
                }
            }

            //current.arpltn = {};
            //current.arpltn.pm10Value = 80;
            //current.arpltn.pm10Str = "나쁨";
            if (current.arpltn && current.arpltn.pm10Value && current.arpltn.pm10Value >= 80) {
                str += ", " + "미세먼지 " + current.arpltn.pm10Str;
            }

            //current.ultrv = 6;
            //current.ultrvStr = "높음";
            if (current.ultrv && current.ultrv >= 6) {
                str += ", " + "자외선 " + current.ultrvStr;
            }

            //current.sensorytmp = -10;
            //current.sensorytmeStr = "관심";
            if (current.sensorytem && current.sensorytem <= -10) {
                str += ", " + "체감온도 " + current.sensorytemStr;
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

            $scope.timeTable = parsedWeather.timeTable;
            $scope.timeChart = parsedWeather.timeChart;

            /*
            parseMidTownWeather에서 currentForecast에 자외선지수를 추가 함
             */
            $scope.dayTable = WeatherUtil.parseMidTownWeather(weatherData.midData, dailyInfoArray, currentTime, currentForecast);

            currentForecast.summary = makeSummary(currentForecast, parsedWeather.timeTable[0]);
            $scope.currentWeather = currentForecast;

            $scope.dayChart = [{
                values: $scope.dayTable,
                temp: $scope.currentWeather.t1h
            }];

            setUserDefaults({"Temperature": String(currentForecast.t1h)});
            setUserDefaults({"WeatherComment": currentForecast.summary});
            setUserDefaults({"WeatherImage": currentForecast.sky});

            var yesterDay;
            var findToday = false;

            var timeString = "";
            timeString += currentTime.getFullYear();
            if(currentTime.getMonth()<9) {
                timeString += '0';
            }
            timeString += currentTime.getMonth()+1;
            if(currentTime.getDate()<10) {
                timeString += '0';
            }
            timeString += currentTime.getDate();

            dailyInfoArray.forEach(function(dailyInfo){
                if(dailyInfo.date === timeString) {
                    findToday = true;
                    setUserDefaults({"TodayMaxTemp": String(dailyInfo.tmx)});
                    setUserDefaults({"TodayMinTemp": String(dailyInfo.tmn)});
                    setUserDefaults({"YesterdayMaxTemp": String(yesterDay.tmx)});
                    setUserDefaults({"YesterdayMinTemp": String(yesterDay.tmn)});
                }

                if(findToday) {
                    setUserDefaults({"TomorrowMaxTemp": String(dailyInfo.tmx)});
                    setUserDefaults({"TomorrowMinTemp": String(dailyInfo.tmn)});
                    findToday = false;
                }

                yesterDay = dailyInfo;
            });

            city.address = fullAddress;
            city.location = location;
            city.currentWeather = currentForecast;
            city.timeTable = parsedWeather.timeTable;
            city.timeChart = parsedWeather.timeChart;
            city.dayTable = $scope.dayTable;
            city.dayChart = $scope.dayChart;
            WeatherInfo.saveCities();
            //localStorage.setItem("currentWeather", JSON.stringify(currentForecast));
            //localStorage.setItem("timeTable", JSON.stringify(parsedWeather.timeTable));
            //localStorage.setItem("timeChart", JSON.stringify(parsedWeather.timeChart));
            //localStorage.setItem("dayTable", JSON.stringify($scope.dayTable));
            //localStorage.setItem("dayChart", JSON.stringify($scope.dayChart));

            console.log($scope.currentWeather);
            console.log($scope.timeChart.length);
            console.log($scope.timeChart);
        }

        function setUserDefaults(obj) {
            applewatch.sendUserDefaults(function() {
                console.log("Succeeded to sendUserDefaults(4)");
            }, function() {
                console.log("Failed to sendUserDefault");
            }, obj, "group.net.wizardfactory.todayweather");
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
                        setUserDefaults({"Location": $scope.address});
                        setWeatherData(weatherData);
                        deferred.notify();
                    }
                    if (addressUpdate === true) {
                        deferred.resolve();
                    }
                });
            }

            if (city.currentPosition === false) {
                return;
            }

            getCurrentPosition().then(function (coords) {
                location = {"lat": coords.latitude, "long": coords.longitude};
                //localStorage.setItem("location", JSON.stringify(location));
                console.log(location);

                WeatherUtil.getAddressFromGeolocation(coords.latitude, coords.longitude).then(function (address) {
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

                        //localStorage.setItem("fullAddress", fullAddress);
                        $scope.address = getShortenAddress(fullAddress);

                        getWeatherInfo(splitAddress(fullAddress), function (error, weatherData) {
                            if (error) {
                                deferred.reject();
                            }
                            else {
                                $scope.address = getShortenAddress(fullAddress);
                                setUserDefaults({"Location": $scope.address});
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
                var str = "현재 위치를 찾을 수 없습니다.";
                if (ionic.Platform.isAndroid()) {
                    str += "<br>WIFI와 위치정보를 켜주세요.";
                }
                showAlert("에러", str);
                deferred.reject();
            });

            return deferred.promise;
        }

        function getWidthPerCol() {
            if (colWidth)  {
                return colWidth;
            }

            var bodyWidth =  angular.element(document).find("body")[0].offsetWidth;
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
                console.log("alertPopup close");
            });
        }

        function showConfirm(title, template, callback) {
            var confirmPopup = $ionicPopup.confirm({
                title: title,
                template: template
            });
            confirmPopup.then(function (res) {
                if (res) {
                    console.log("You are sure");
                } else {
                    console.log("You are not sure");
                }
                callback(res);
            });
        }

        identifyUser();

        $scope.address = "위치 찾는 중";

        $scope.doRefresh = function() {
            updateWeatherData().finally(function (res) {
                $scope.$broadcast("scroll.refreshComplete");
            }, function (msg) {
                //update weather data
                $ionicScrollDelegate.$getByHandle("timeChart").scrollTo(getTodayNowPosition(7), 0, false);
                $ionicScrollDelegate.$getByHandle("weeklyChart").scrollTo(getTodayNowPosition(5), 0, false);
            });
        };

        $scope.onClickGuide = function() {
            if(typeof(Storage) !== "undefined") {
                localStorage.setItem("skipGuide", true);
            }
            $scope.skipGuide = true;
        };

        $ionicPlatform.ready(function() {
            console.log($ionicAnalytics.globalProperties);
            console.log(ionic.Platform);

            city = WeatherInfo.getCityOfIndex(0);
            if (city) {
                fullAddress = city.address;
                $scope.address = getShortenAddress(fullAddress);
                console.log($scope.address);
                location = city.location;
                console.log($scope.location);
                $scope.currentWeather = city.currentWeather;
                console.log($scope.currentWeather);
                $scope.timeTable = city.timeTable;
                console.log($scope.timeTable);
                $scope.timeChart = city.timeChart;
                console.log($scope.timeChart);
                $scope.dayTable = city.dayTable;
                console.log($scope.dayTable);
                $scope.dayChart = city.dayChart;
                console.log($scope.dayChart);
                $timeout(function() {
                    $ionicScrollDelegate.$getByHandle("timeChart").scrollTo(getTodayNowPosition(7), 0, false);
                    $ionicScrollDelegate.$getByHandle("weeklyChart").scrollTo(getTodayNowPosition(5), 0, false);
                },0);
            }

            checkForUpdates().finally(function (res) {
                loadWeatherData();
            });

            var loadWeatherData = function () {
                if (location !== null) {
                    updateWeatherData().finally(function (res) {
                        //resolve or reject
                    }, function (msg) {
                        //update weather data
                        $ionicScrollDelegate.$getByHandle("timeChart").scrollTo(getTodayNowPosition(7), 0, false);
                        $ionicScrollDelegate.$getByHandle("weeklyChart").scrollTo(getTodayNowPosition(5), 0, false);
                    });
                }
            };
        });
    })

    .controller('SearchCtrl', function ($scope, $ionicPlatform, $ionicAnalytics, $q, $http, WeatherInfo, WeatherUtil,$rootScope) {
        $scope.$on('$ionicView.beforeEnter', function() {
            $rootScope.viewColor = '#ec72a8';
        });
        $scope.searchWord = undefined;
        $scope.searchResults = [];
        $scope.cityList = WeatherInfo.cities;
        var towns = WeatherInfo.towns;
        var city = {};

        $scope.changeSearchWord = function() {
            if ($scope.searchWord === "") {
                $scope.searchWord = undefined;
                $scope.searchResults = [];
                return;
            }

            $scope.searchResults = towns.filter(function (town) {
                if (town.first.indexOf($scope.searchWord) >= 0 || town.second.indexOf($scope.searchWord) >= 0
                    || town.third.indexOf($scope.searchWord) >= 0) {
                    return true;
                }
                return false;
            });
        };

        $scope.cancleSearchWord = function() {
            $scope.searchWord = undefined;
            $scope.searchResults = [];
        };

        $scope.selectResult = function(city) {
            var address = city.first;
            if (city.second !== "") {
                address += "+" + city.second;
            }
            if (city.third !== "") {
                address += "+" + city.third;
            }

            WeatherUtil.getAddressToGeolocation(address).then(function (location) {
                WeatherUtil.getAddressFromGeolocation(location.lat, location.long).then(function (address) {
                    city.currentPosition = false;
                    city.address = address;
                    city.location = location;

                    getWeatherInfo(splitAddress(address), function (error, weatherData) {
                        if (error) {
                            //deferred.reject();
                        }
                        else {
                            setWeatherData(weatherData);
                            //deferred.notify();
                            //deferred.resolve();
                        }
                    });
                }, function (err) {
                    //deferred.reject();
                });
            }, function (err) {
                //deferred.reject();
            });
            $scope.searchWord = undefined;
            $scope.searchResults = [];
        };

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
         *
         * @param {Object} current
         * @param {Object} yesterday
         * @returns {String}
         */
        function makeSummary(current, yesterday) {
            var str = "어제";
            var diffTemp = current.t1h - yesterday.t3h;

            if (diffTemp == 0) {
                str += "와 동일";
            }
            else {
                str += "보다 " + Math.abs(diffTemp);
                if (diffTemp < 0) {
                    str += "도 낮음";
                }
                else if (diffTemp > 0) {
                    str += "도 높음";
                }
            }

            //current.arpltn = {};
            //current.arpltn.pm10Value = 80;
            //current.arpltn.pm10Str = "나쁨";
            if (current.arpltn && current.arpltn.pm10Value && current.arpltn.pm10Value >= 80) {
                str += ", " + "미세먼지 " + current.arpltn.pm10Str;
            }

            //current.ultrv = 6;
            //current.ultrvStr = "높음";
            if (current.ultrv && current.ultrv >= 6) {
                str += ", " + "자외선 " + current.ultrvStr;
            }

            //current.sensorytmp = -10;
            //current.sensorytmeStr = "관심";
            if (current.sensorytem && current.sensorytem <= -10) {
                str += ", " + "체감온도 " + current.sensorytemStr;
            }

            return str;
        }

        /**
         *
         * @param {String[]} addressArray
         * @param {cbWeatherInfo} callback
         */
        function getWeatherInfo(addressArray, callback) {
            //var url = "town";
            //var url = "https://todayweather1-wizardfactory.rhcloud.com/town";
            //var url = "https://todayweather2-wizardfactory.rhcloud.com/town";
            var url = "https://d2ibo8bwl7ifj5.cloudfront.net/town";

            if (!Array.isArray(addressArray) || addressArray.length === 0) {
                return callback(new Error("addressArray is NOT array"));
            }

            var town = WeatherUtil.getTownFromFullAddress(addressArray);
            url += "/"+town.first+"/"+town.second+"/"+town.third;

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
         *
         * @param weatherData
         */
        function setWeatherData(weatherData) {
            var currentTime = new Date();
            var currentForecast = WeatherUtil.parseCurrentTownWeather(weatherData.current);

            var dailyInfoArray = WeatherUtil.parsePreShortTownWeather(weatherData.short);

            /*
             parseShortWeather에서 currentForcast에 체감온도를 추가 함, scope에 적용전에 parseShortTownWeather를 해야 함
             */
            var parsedWeather = WeatherUtil.parseShortTownWeather(weatherData.short, currentForecast, currentTime, dailyInfoArray);

            $scope.timeTable = parsedWeather.timeTable;
            $scope.timeChart = parsedWeather.timeChart;

            /*
             parseMidTownWeather에서 currentForecast에 자외선지수를 추가 함
             */
            $scope.dayTable = WeatherUtil.parseMidTownWeather(weatherData.midData, dailyInfoArray, currentTime, currentForecast);

            currentForecast.summary = makeSummary(currentForecast, parsedWeather.timeTable[0]);
            $scope.currentWeather = currentForecast;

            $scope.dayChart = [{
                values: $scope.dayTable,
                temp: $scope.currentWeather.t1h
            }];

            //data.address = fullAddress;
            //data.location = location;
            city.currentWeather = currentForecast;
            city.timeTable = parsedWeather.timeTable;
            city.timeChart = parsedWeather.timeChart;
            city.dayTable = $scope.dayTable;
            city.dayChart = $scope.dayChart;
            //WeatherInfo.addCity(city);
            //WeatherInfo.saveCities();
            $scope.cityList.push(city);
            //localStorage.setItem("currentWeather", JSON.stringify(currentForecast));
            //localStorage.setItem("timeTable", JSON.stringify(parsedWeather.timeTable));
            //localStorage.setItem("timeChart", JSON.stringify(parsedWeather.timeChart));
            //localStorage.setItem("dayTable", JSON.stringify($scope.dayTable));
            //localStorage.setItem("dayChart", JSON.stringify($scope.dayChart));

            console.log($scope.currentWeather);
            console.log($scope.timeChart.length);
            console.log($scope.timeChart);
        }

        $ionicPlatform.ready(function() {
            console.log($ionicAnalytics.globalProperties);
            console.log(ionic.Platform);
        });
    })

    .controller('SettingCtrl', function($scope, $ionicPlatform, $ionicAnalytics, $ionicPopup, $cordovaInAppBrowser, $rootScope) {
        $scope.$on('$ionicView.beforeEnter', function() {
            $rootScope.viewColor = '#ea9623';
        });

        $scope.version  = "0.0.0";

        var deploy = new Ionic.Deploy();
        deploy.info().then(function(deployInfo) {
            console.log(deployInfo);
            $scope.version = deployInfo.binary_version;
        }, function() {}, function() {});

        $scope.openMarket = function() {
            var src = "";
            if (ionic.Platform.isIOS()) {
                src = "https://itunes.apple.com/us/app/todayweather/id1041700694";
            }
            else if (ionic.Platform.isAndroid()) {
                src = "https://play.google.com/store/apps/details?id=net.wizardfactory.todayweather";
            }
            else {
                src = "https://www.facebook.com/TodayWeather.WF";
            }

            var options = {
                location: "yes",
                clearcache: "yes",
                toolbar: "no"
            };

            $cordovaInAppBrowser.open(src, "_blank", options)
                .then(function(event) {
                    console.log(event);
                    // success
                })
                .catch(function(event) {
                    console.log("error");
                    console.log(event);
                    // error
                });
        };

        $scope.openInfo = function () {
            var msg = "기상정보 : 기상청 <br> 대기오염정보 : 환경부/한국환경공단 <br> 인증되지 않은 실시간 자료이므로 자료 오류가 있을 수 있습니다.";
            var alertPopup = $ionicPopup.alert({
                title: "TodayWeather",
                template: msg
            });
            alertPopup.then(function(res) {
                console.log("alertPopup close");
            });
        };

        $ionicPlatform.ready(function() {
            console.log($ionicAnalytics.globalProperties);
            console.log(ionic.Platform);
        });
    })

    .controller('TabCtrl', function ($scope, $ionicPlatform, $interval, WeatherInfo, WeatherUtil) {
        // With the new view caching in Ionic, Controllers are only called
        // when they are recreated or on app start, instead of every page change.
        // To listen for when this page is active (for example, to refresh data),
        // listen for the $ionicView.enter event:
        //
        //$scope.$on('$ionicView.enter', function(e) {
        //});

        var currentTime = new Date();

        $scope.currentTimeString = WeatherUtil.convertTimeString(currentTime); // 10월 8일(수) 12:23 AM
        $interval(function() {
            var newDate = new Date();
            if(newDate.getMinutes() != currentTime.getMinutes()) {
                currentTime = newDate;
                $scope.currentTimeString = WeatherUtil.convertTimeString(currentTime);
            }
        }, 1000);

        $ionicPlatform.ready(function() {
            WeatherInfo.loadCities();
            WeatherInfo.loadTowns();
        });
    });

