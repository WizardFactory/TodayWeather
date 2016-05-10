
angular.module('starter.controllers', [])
    .controller('ForecastCtrl', function ($scope, $rootScope, $ionicPlatform, $ionicAnalytics, $ionicScrollDelegate,
                                          $ionicNavBarDelegate, $q, $http, $timeout, WeatherInfo, WeatherUtil, Util,
                                          $stateParams, $location, $ionicHistory) {

        var deploy = new Ionic.Deploy();
        var bodyWidth = window.innerWidth;
        var colWidth;
        var cityData;

        $scope.forecastType = "short"; //mid, detail
        $scope.address = "";

        //{time: Number, t1h: Number, skyIcon: String, tmn: Number, tmx: Number, summary: String};
        $scope.currentWeather;
        //{day: String, time: Number, t3h: Number, skyIcon: String, pop: Number, tempIcon: String, tempInfo: String, tmn: Number, tmx: Number}
        $scope.timeTable = [];
        //{week: String, skyIcon:String, pop: Number, humidityIcon: String, reh: Number, tmn: Number, tmx: Number};
        $scope.dayTable = [];
        //[{name: String, values:[{name: String, value: Number}]}]
        $scope.timeChart;
        //[{values: Object, temp: Number}]
        $scope.dayChart;

        $scope.timeWidth; //total width of timeChart and timeTable
        $scope.dayWidth; //total width of dayChart and dayTable

        $scope.imgPath = Util.imgPath;

        function init() {
            Util.ga.trackEvent('page', 'tab', 'forecast');

            //identifyUser();
            $ionicHistory.clearHistory();

            var padding = 1;
            console.log("Height:" + window.innerHeight + ", Width:" + window.innerWidth + ", PixelRatio:" + window.devicePixelRatio);
            console.log("OuterHeight:" + window.outerHeight + ", OuterWidth:" + window.outerWidth);

            //iphone 4 480-20(status bar)
            if ((window.innerHeight === 460 || window.innerHeight === 480) && window.innerWidth === 320) {
                padding = 1.125;
            }
            //iphone 5 568-20(status bar)
            if ((window.innerHeight === 548 || window.innerHeight === 568) && window.innerWidth === 320) {
                padding = 1.125;
            }
            //iphone 6 667-20
            if ((window.innerHeight === 647 || window.innerHeight === 667) && window.innerWidth === 375) {
                padding = 1.0625;
            }

            var mainHeight = window.innerHeight - 100;

            var topTimeSize = mainHeight * 0.026;
            $scope.topTimeSize = topTimeSize<16.8?topTimeSize:16.8;

            var regionSize = mainHeight * 0.0408 * padding; //0.051
            $scope.regionSize = regionSize<33.04?regionSize:33.04;

            var regionSumSize = mainHeight * 0.0376 * padding; //0.047
            $scope.regionSumSize = regionSumSize<30.45?regionSumSize:30.45;

            var bigDigitSize = mainHeight * 0.17544 * padding; //0.2193
            $scope.bigDigitSize = bigDigitSize<142.1?bigDigitSize:142.1;

            var bigTempPointSize = mainHeight * 0.03384 * padding; //0.0423
            $scope.bigTempPointSize = bigTempPointSize<27.4?bigTempPointSize:27.4;

            //injection img url after setting imgSize.
            $scope.reddot = 'reddot';

            var bigSkyStateSize = mainHeight * 0.11264 * padding; //0.1408
            $scope.bigSkyStateSize = bigSkyStateSize<91.2?bigSkyStateSize:91.2;

            var smallTimeSize = mainHeight * 0.0299;
            $scope.smallTimeSize = smallTimeSize<19.37?smallTimeSize:19.37;

            var smallImageSize = mainHeight * 0.0512;
            $scope.smallImageSize = smallImageSize<33.17?smallImageSize:33.17;

            var smallDigitSize = mainHeight * 0.0320;
            $scope.smallDigitSize = smallDigitSize<20.73?smallDigitSize:20.73;

            $scope.isIOS = function() {
                return ionic.Platform.isIOS();
            };
        }

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
                    $scope.showConfirm("업데이트", "새로운 버전이 확인되었습니다. 업데이트 하시겠습니까?", function (res) {
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
        //function identifyUser() {
        //    console.log("User: Identifying with User service");
        //
        //    // kick off the platform web client
        //    Ionic.io();
        //
        //    // this will give you a fresh user or the previously saved 'current user'
        //    var user = Ionic.User.current();
        //
        //    // if the user doesn't have an id, you'll need to give it one.
        //    if (!user.id) {
        //        user.id = Ionic.User.anonymousId();
        //        // user.id = "your-custom-user-id";
        //    }
        //
        //    //persist the user
        //    user.save();
        //}

        function loadWeatherData() {
            cityData = WeatherInfo.getCityOfIndex(WeatherInfo.cityIndex);
            if (cityData === null) {
                console.log("fail to getCityOfIndex");
                return;
            }

            console.log("start");

            $scope.timeWidth = getWidthPerCol() * cityData.timeTable.length;
            $scope.dayWidth = getWidthPerCol() * cityData.dayTable.length;

            $scope.address = WeatherUtil.getShortenAddress(cityData.address);
            console.log($scope.address);
            $scope.currentWeather = cityData.currentWeather;
            console.log($scope.currentWeather);
            $scope.timeTable = cityData.timeTable;
            console.log($scope.timeTable);
            $scope.timeChart = cityData.timeChart;
            console.log($scope.timeChart);
            $scope.dayTable = cityData.dayTable;
            console.log($scope.dayTable);
            $scope.dayChart = cityData.dayChart;
            console.log($scope.dayChart);

            $scope.currentPosition = cityData.currentPosition;

            // To share weather information for apple watch.
            // AppleWatch.setWeatherData(cityData);

            $timeout(function() {
                if ($scope.forecastType === 'short') {
                    $ionicScrollDelegate.$getByHandle("timeChart").scrollTo(getTodayPosition(), 0, false);
                }
                else if ($scope.forecastType === 'mid') {
                    $ionicScrollDelegate.$getByHandle("weeklyChart").scrollTo(getTodayPosition(), 0, false);
                }
            },0);

            Util.ga.trackEvent('weather', 'load', $scope.address, WeatherInfo.cityIndex);
        }

        function updateWeatherData(isForce) {
            var deferred = $q.defer();

            if (cityData === null) {
                deferred.resolve();
                return deferred.promise;
            }

            var preUpdate = false;
            var addressUpdate = false;

            if (cityData.location === null && isForce === false) {
                deferred.resolve();
                return deferred.promise;
            }
            if (cityData.currentPosition === false) {
                addressUpdate = true;
            }

            WeatherUtil.getWeatherInfo(cityData.address, WeatherInfo.towns).then(function (weatherDatas) {
                // 1: resolved, 2: rejected
                if (deferred.promise.$$state.status === 1 || deferred.promise.$$state.status === 2) {
                    return;
                }
                preUpdate = true;
                var city = WeatherUtil.convertWeatherData(weatherDatas);
                WeatherInfo.updateCity(WeatherInfo.cityIndex, city);
                loadWeatherData();
                deferred.notify();

                if (addressUpdate === true) {
                    deferred.resolve();
                }
                else {
                    $scope.address = "위치 찾는 중";
                }
            }, function () {
                // 1: resolved, 2: rejected
                if (deferred.promise.$$state.status === 1 || deferred.promise.$$state.status === 2) {
                    return;
                }
                if (addressUpdate === true) {
                    if (cityData.currentPosition === false) {
                        var msg = "위치 정보 업데이트를 실패하였습니다.";
                        $scope.showAlert("에러", msg);
                        deferred.reject();
                    }
                    else {
                        deferred.resolve();
                    }
                }
            });

            if (cityData.currentPosition === true) {
                $scope.address = "위치 찾는 중";

                WeatherUtil.getCurrentPosition().then(function (coords) {
                    WeatherUtil.getAddressFromGeolocation(coords.latitude, coords.longitude).then(function (address) {
                        if (cityData.address === address) {
                            addressUpdate = true;
                            if (preUpdate === true) {
                                console.log("Already updated current position weather data");
                                deferred.resolve();
                            }
                        }
                        else {
                            WeatherUtil.getWeatherInfo(address, WeatherInfo.towns).then(function (weatherDatas) {
                                var city = WeatherUtil.convertWeatherData(weatherDatas);
                                city.address = address;
                                city.location = {"lat": coords.latitude, "long": coords.longitude};
                                WeatherInfo.updateCity(WeatherInfo.cityIndex, city);
                                loadWeatherData();
                                deferred.notify();
                                deferred.resolve();
                            }, function () {
                                var msg = "현재 위치 정보 업데이트를 실패하였습니다.";
                                $scope.showAlert("에러", msg);
                                deferred.reject();
                            });
                        }
                    }, function () {
                        var msg = "현재 위치에 대한 정보를 찾을 수 없습니다.";
                        $scope.showAlert("에러", msg);
                        deferred.reject();
                    });
                }, function () {
                    var msg = "현재 위치를 찾을 수 없습니다.";
                    if (ionic.Platform.isAndroid()) {
                        msg += "<br>WIFI와 위치정보를 켜주세요.";
                    }
                    $scope.showAlert("에러", msg);
                    deferred.reject();
                });
            }

            return deferred.promise;
        }

        function getWidthPerCol() {
            if (colWidth)  {
                return colWidth;
            }

            console.log("body of width="+bodyWidth);

            switch (bodyWidth) {
                case 320:   //iphone 4,5
                    colWidth = 53;
                    break;
                case 375:   //iphone 6
                    colWidth = 53;
                    break;
                case 412:   //SS note5
                    colWidth = 58.85;
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

        function getTodayPosition() {
            var time = new Date();
            var index = 0;

            if ($scope.forecastType === 'short') {
                var hours = time.getHours();
                index = 6; //yesterday 21h

                if(hours >= 3) {
                    //start today
                    index+=1;
                }
                if (hours >= 6) {
                    index+=1;
                }
                if (hours >= 9) {
                    index += 1;
                }
                if (hours > 15 && bodyWidth < 360) {
                    index += 1;
                }
                return getWidthPerCol()*index;
            }
            else if ($scope.forecastType === 'mid') {

                //monday는 토요일부터 표시
                var day = time.getDay();
                var dayPadding = 2;

                if (day === 1) {
                    index = 5;
                }
                else {

                    //sunday는 monday까지 보이게
                    if (day === 0) {
                        day = 7;
                        dayPadding += 1;
                    }

                    // 6 cells 에서는 수요일부터는 화,수,목,금,토,일 표시
                    if (day > 2 && bodyWidth < 360) {
                        dayPadding += 1;
                    }
                    index = 6 + dayPadding - day;
                }
                return getWidthPerCol()*index;
            }
            return getWidthPerCol()*index;
        }

        $scope.changeForecastType = function() {
            if ($scope.forecastType === 'short') {
                $scope.forecastType = 'mid';
                $rootScope.viewColor = '#8BC34A';
                if (window.StatusBar) {
                    StatusBar.backgroundColorByHexString('#689F38');
                }
                //async drawing for preventing screen cut #544
                setTimeout(function () {
                    $ionicScrollDelegate.$getByHandle("weeklyChart").scrollTo(getTodayPosition(), 0, false);
                }, 0);
            }
            else if ($scope.forecastType === 'mid') {
                $scope.forecastType = 'detail';
                $rootScope.viewColor = '#00BCD4';
                if (window.StatusBar) {
                    StatusBar.backgroundColorByHexString('#0097A7');
                }
            }
            else if ($scope.forecastType === 'detail') {
                $scope.forecastType = 'short';
                $rootScope.viewColor = '#03A9F4';
                if (window.StatusBar) {
                    StatusBar.backgroundColorByHexString('#0288D1');
                }
                setTimeout(function () {
                    $ionicScrollDelegate.$getByHandle("timeChart").scrollTo(getTodayPosition(), 0, false);
                }, 0);
            }
        };

        $scope.doRefresh = function() {
            $scope.isLoading = true;
            updateWeatherData(true).finally(function () {
                $scope.address = WeatherUtil.getShortenAddress(cityData.address);
                $scope.isLoading = false;
            });
        };

        $scope.onSwipeLeft = function() {
            if (WeatherInfo.getCityCount() === 1) {
                return;
            }

            if (WeatherInfo.cityIndex === WeatherInfo.getCityCount() - 1) {
                WeatherInfo.setCityIndex(0);
            }
            else {
                WeatherInfo.setCityIndex(WeatherInfo.cityIndex + 1);
            }

            loadWeatherData();
        };

        $scope.onSwipeRight = function() {
            if (WeatherInfo.getCityCount() === 1) {
                return;
            }

            if (WeatherInfo.cityIndex === 0) {
                WeatherInfo.setCityIndex(WeatherInfo.getCityCount() - 1);
            }
            else {
                WeatherInfo.setCityIndex(WeatherInfo.cityIndex - 1);
            }

            loadWeatherData();
        };

        $scope.getDayText = function (value) {
            return value.fromTodayStr + ' ' + value.date.substr(4,2) + '.' + value.date.substr(6,2);
        };

        $scope.getDayForecast = function (value) {
            var str = '';
            if (value.fromToday === 0 || value.fromToday === 1) {
                if (value.dustForecast && value.dustForecast.PM10Str) {
                   str +=  '미세예보:'+value.dustForecast.PM10Str + ',';
                }

                if (value.ultrvStr) {
                    str += '자외선:'+value.ultrvStr;
                }
                return str;
            }

            return str;
        };

        $scope.$on('$ionicView.loaded', function() {
            $rootScope.viewColor = '#22a1db';
            if (window.StatusBar) {
                StatusBar.backgroundColorByHexString('#0288D1');
            }
        });

        $scope.$on('updateWeatherEvent', function(event) {
            console.log('called by update weather event');
            $scope.doRefresh();
        });

        $ionicPlatform.ready(function() {
            console.log($ionicAnalytics.globalProperties);
            console.log(ionic.Platform);

            $rootScope.viewColor = '#22a1db';
            if (window.StatusBar) {
                StatusBar.backgroundColorByHexString('#0288D1');
            }

            WeatherInfo.loadCities();
            WeatherInfo.loadTowns().then(function () {
                WeatherInfo.updateCities();

                if ($stateParams.fav !== undefined && $stateParams.fav < WeatherInfo.getCityCount()) {
                    WeatherInfo.setCityIndex($stateParams.fav);
                }

                loadWeatherData();
                checkForUpdates().finally(function () {
                    updateWeatherData(false).finally(function () {
                        $scope.address = WeatherUtil.getShortenAddress(cityData.address);
                    });
                });
            });
        });

        init();
    })

    .controller('SearchCtrl', function ($scope, $rootScope, $ionicPlatform, $ionicAnalytics, $ionicScrollDelegate,
                                        $location, WeatherInfo, WeatherUtil, Util, ionicTimePicker, Push) {
        $scope.searchWord = undefined;
        $scope.searchResults = [];
        $scope.cityList = [];
        $scope.isLoading = false;
        $scope.imgPath = Util.imgPath;

        var towns = WeatherInfo.towns;
        var searchIndex = -1;

        function init() {
            Util.ga.trackEvent('page', 'tab', 'search');

            WeatherInfo.cities.forEach(function (city, index) {
                var address = WeatherUtil.getShortenAddress(city.address).split(",");
                var todayData = city.dayTable.filter(function (data) {
                    return (data.fromToday === 0);
                });

                if (!city.currentWeather) {
                    city.currentWeather = {};
                }
                if (!city.currentWeather.skyIcon) {
                    city.currentWeather.skyIcon = 'Sun';
                }
                if (city.currentWeather.t1h === undefined) {
                    city.currentWeather.t1h = '-';
                }

                if (!todayData || todayData.length === 0) {
                    todayData.push({tmn:'-', tmx:'-'});
                }

                var data = {
                    address: address,
                    currentPosition: city.currentPosition,
                    skyIcon: city.currentWeather.skyIcon,
                    t1h: city.currentWeather.t1h,
                    tmn: todayData[0].tmn,
                    tmx: todayData[0].tmx,
                    delete: false
                };
                $scope.cityList.push(data);
                $scope.cityList[index].alarmInfo = Push.getAlarm(index);
            });
        }

        $scope.OnChangeSearchWord = function() {
            if ($scope.searchWord === "") {
                $scope.searchWord = undefined;
                $scope.searchResults = [];
                return;
            }

            $scope.searchResults = [];
            $ionicScrollDelegate.$getByHandle('cityList').scrollTop();
            searchIndex = 0;
            $scope.OnScrollResults();
        };

        $scope.OnScrollResults = function() {
            if ($scope.searchWord !== undefined && searchIndex !== -1) {
                for (var i = searchIndex; i < towns.length; i++) {
                    var town = towns[i];
                    if (town.first.indexOf($scope.searchWord) >= 0 || town.second.indexOf($scope.searchWord) >= 0
                        || town.third.indexOf($scope.searchWord) >= 0) {
                        $scope.searchResults.push(town);
                        if ($scope.searchResults.length % 10 === 0) {
                            searchIndex = i + 1;
                            return;
                        }
                    }
                }
                searchIndex = -1;
            }
        };

        $scope.OnSelectResult = function(result) {
            if (window.cordova && window.cordova.plugins && window.cordova.plugins.Keyboard) { 
                if (cordova.plugins.Keyboard.isVisible) {
                    return cordova.plugins.Keyboard.close(); 
                }
            }

            $scope.searchWord = undefined;
            $scope.searchResults = [];
            $scope.isLoading = true;

            var address = "대한민국"+" "+result.first;
            if (result.second !== "") {
                if (result.first.slice(-1) === '도' && result.second.slice(-1) === '구') {
                    if (result.second.indexOf(' ') > 0) {
                        //si gu
                        var aTemp = result.second.split(" ");
                        address = " " + aTemp[0];
                        address = " " + aTemp[1];
                    }
                    else {
                        //sigu
                        address += " " + result.second.substr(0, result.second.indexOf('시')+1);
                        address += " " + result.second.substr(result.second.indexOf('시')+1, result.second.length);
                    }
                }
                else {
                    address += " " + result.second;
                }
            }
            if (result.third !== "") {
                address += " " + result.third;
            }

            WeatherUtil.getWeatherInfo(address, WeatherInfo.towns).then(function (weatherDatas) {
                var city = WeatherUtil.convertWeatherData(weatherDatas);
                city.currentPosition = false;
                city.address = address;
                city.location = location;

                if (WeatherInfo.addCity(city) === false) {
                    var msg = "이미 동일한 지역이 추가되어 있습니다.";
                    $scope.showAlert("에러", msg);
                }
                else {
                    WeatherInfo.setCityIndex(WeatherInfo.getCityCount() - 1);
                    $location.path('/tab/forecast');
                }
                $scope.isLoading = false;
            }, function () {
                var msg = "현재 위치 정보 업데이트를 실패하였습니다.";
                $scope.showAlert("에러", msg);
                $scope.isLoading = false;
            });
        };

        $scope.OnSwipeCity = function(city) {
            // 현재 위치인 경우에는 삭제되면 안됨
            if (city.currentPosition === false) {
                city.delete = !city.delete;
            }
        };

        $scope.OnSelectCity = function(index) {
            if (window.cordova && window.cordova.plugins && window.cordova.plugins.Keyboard) {
                if (cordova.plugins.Keyboard.isVisible) {
                    return cordova.plugins.Keyboard.close();
                }
            }

            WeatherInfo.setCityIndex(index);
            $location.path('/tab/forecast');
        };

        $scope.OnDeleteCity = function(index) {
            Push.removeAlarm($scope.cityList[index].alarmInfo);
            $scope.cityList.splice(index, 1);
            WeatherInfo.removeCity(index);

            if (WeatherInfo.cityIndex === WeatherInfo.getCityCount()) {
                WeatherInfo.setCityIndex(0);
            }
            return false; //OnSelectCity가 호출되지 않도록 이벤트 막음
        };

        $scope.openTimePicker = function (index) {
            var ipObj1 = {
                callback: function (val) {      //Mandatory
                    if (typeof (val) === 'undefined') {
                        console.log('Time not selected');
                        Push.removeAlarm($scope.cityList[index].alarmInfo);
                        $scope.cityList[index].alarmInfo = undefined;
                    } else {
                        var selectedTime = new Date();
                        selectedTime.setHours(0,0,0,0);
                        selectedTime.setSeconds(val);

                        console.log('index=' + index + ' Selected epoch is : ' + val + 'and the time is ' +
                                    selectedTime.toString());

                        Push.updateAlarm(index, WeatherInfo.cities[index].address, selectedTime, function (err, alarmInfo) {
                            console.log('alarm='+JSON.stringify(alarmInfo));
                            $scope.cityList[index].alarmInfo = alarmInfo;
                        });
                    }
                }
            };
            if ($scope.cityList[index].alarmInfo != undefined) {
                var date = new Date($scope.cityList[index].alarmInfo.time);
                console.log(date);
                console.log(date.toString);
                ipObj1.inputTime = date.getHours() * 60 * 60 + date.getMinutes() * 60;
                console.log('inputTime='+ipObj1.inputTime);
            }
            else {
                ipObj1.inputTime = 8*60*60; //AM 8:00
            }

            ionicTimePicker.openTimePicker(ipObj1);
        };

        $scope.$on('$ionicView.loaded', function() {
            $rootScope.viewColor = '#ec72a8';
            if (window.StatusBar) {
                StatusBar.backgroundColorByHexString('#EC407A');
            }
        });

        $ionicPlatform.ready(function() {
            console.log($ionicAnalytics.globalProperties);
            console.log(ionic.Platform);
        });

        init();
    })

    .controller('SettingCtrl', function($scope, $rootScope, $ionicPlatform, $ionicAnalytics, $http,
                                        $cordovaInAppBrowser, Util) {
        //sync with config.xml
        $scope.version  = "0.7.11";

        //it doesn't work after ionic deploy
        //var deploy = new Ionic.Deploy();
        //deploy.info().then(function(deployInfo) {
        //    console.log("DeployInfo" + deployInfo);
        //    $scope.version = deployInfo.binary_version;
        //}, function() {}, function() {});
        //
        //deploy.getVersions().then(function(versions) {
        //    console.log("version:" + versions);
        //}, function() {}, function() {});

        function init() {
            Util.ga.trackEvent('page', 'tab', 'setting');

            //for chrome extension
            if (window.chrome && chrome.extension) {
                $http({method: 'GET', url: chrome.extension.getURL("manifest.json"), timeout: 3000}).success(function (manifest) {
                    console.log("Version: " + manifest.version);
                    $scope.version = manifest.version;
                }).error(function (err) {
                    console.log(err);
                });
            }
        }

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
            $scope.showAlert("TodayWeather", msg);
        };

        $scope.$on('$ionicView.loaded', function() {
            $rootScope.viewColor = '#FFA726';
            if (window.StatusBar) {
                StatusBar.backgroundColorByHexString('#FB8C00');
            }
        });

        $ionicPlatform.ready(function() {
            console.log($ionicAnalytics.globalProperties);
            console.log(ionic.Platform);
        });

        init();
    })

    .controller('TabCtrl', function ($scope, $ionicPlatform, $ionicPopup, $interval, WeatherInfo, WeatherUtil,
                                     $location, $cordovaSocialSharing, TwAds, $rootScope, Util) {
        // With the new view caching in Ionic, Controllers are only called
        // when they are recreated or on app start, instead of every page change.
        // To listen for when this page is active (for example, to refresh data),
        // listen for the $ionicView.enter event:
        //
        //$scope.$on('$ionicView.enter', function(e) {
        //});

        var currentTime;

        function init() {
            currentTime = new Date();
            $scope.currentTimeString = WeatherUtil.convertTimeString(currentTime); // 10월 8일(수) 12:23 AM
            $interval(function() {
                var newDate = new Date();
                if(newDate.getMinutes() != currentTime.getMinutes()) {
                    currentTime = newDate;
                    $scope.currentTimeString = WeatherUtil.convertTimeString(currentTime);
                }
            }, 1000);
        }

        $scope.doTabForecast = function() {
            if ($location.path() === '/tab/forecast') {
                $scope.$broadcast('updateWeatherEvent');

                Util.ga.trackEvent('page', 'tab', 'reload');
            }
            else {
                $location.path('/tab/forecast');
            }
        };

        $scope.doTabShare = function() {
            var message = '';

            if ($location.path() === '/tab/forecast') {
                var cityData = WeatherInfo.getCityOfIndex(WeatherInfo.cityIndex);
                if (cityData !== null && cityData.location !== null) {
                    message += WeatherUtil.getShortenAddress(cityData.address)+'\n';
                    message += '현재 '+cityData.currentWeather.t1h+'˚ ';
                    message += WeatherUtil.getWeatherEmoji(cityData.currentWeather.skyIcon)+'\n';
                    cityData.dayTable.forEach(function(data) {
                        if (data.fromToday === 0) {
                            message += '최고 '+data.tmx+'˚, 최저 '+data.tmn+'˚\n';
                        }
                    });
                    message += cityData.currentWeather.summary+'\n\n';
                }
            }

            $cordovaSocialSharing
                .share(message + '오늘날씨 다운로드 >\nhttp://onelink.to/dqud4w', null, null, null)
                .then(function(result) {
                    // Success!
                }, function(err) {
                    // An error occured
                });

            Util.ga.trackEvent('page', 'tab', 'share');
        };

        $scope.showAlert = function(title, msg) {
            var alertPopup = $ionicPopup.alert({
                title: title,
                template: msg
            });
            alertPopup.then(function() {
                console.log("alertPopup close");
            });
        };

        $scope.showConfirm = function(title, template, callback) {
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
        };

        $ionicPlatform.ready(function() {
            //WeatherInfo.loadCities();
            //WeatherInfo.loadTowns().then(function () {
            //    WeatherInfo.updateCities();
            //});
        });

        init();
    })

    .controller('GuideCtrl', function($scope, $rootScope, $ionicSlideBoxDelegate, $ionicNavBarDelegate,
                                      $location, $ionicHistory, Util, TwAds)
    {
        function init() {
            //for fast close ads when first loading
            TwAds.setShowAds(false);
            Util.ga.trackEvent('page', 'tab', 'guide');

            $scope.bigFont = (window.innerHeight - 56) * 0.0512;
            $scope.smallFont = (window.innerHeight - 56) * 0.0299;
            update();
        }

        function close() {
            TwAds.setShowAds(true);

            if(typeof(Storage) !== "undefined") {
                var guideVersion = localStorage.getItem("guideVersion");
                if (guideVersion !== null && Util.guideVersion == Number(guideVersion)) {
                    $location.path('/tab/setting');
                    return;
                }
                localStorage.setItem("guideVersion", Util.guideVersion.toString());
            }

            $location.path('/tab/forecast');
        }

        function update() {
            if ($ionicSlideBoxDelegate.currentIndex() == $ionicSlideBoxDelegate.slidesCount() - 1) {
                $scope.leftText = "<";
                $scope.rightText = "CLOSE";
            } else {
                $scope.leftText = "SKIP";
                $scope.rightText = ">";
            }
        }

        $scope.onSlideChanged = function() {
            update();
        };

        $scope.onLeftClick = function() {
            if ($ionicSlideBoxDelegate.currentIndex() == $ionicSlideBoxDelegate.slidesCount() - 1) {
                $ionicSlideBoxDelegate.previous();
            } else {
                close();
            }
        };

        $scope.onRightClick = function() {
            if ($ionicSlideBoxDelegate.currentIndex() == $ionicSlideBoxDelegate.slidesCount() - 1) {
                close();
            } else {
                $ionicSlideBoxDelegate.next();
            }
        };

        $scope.$on('$ionicView.enter', function() {
            TwAds.setShowAds(false);
            if (window.StatusBar) {
                StatusBar.backgroundColorByHexString('#0288D1');
            }
            $ionicSlideBoxDelegate.slide(0);
        });

        init();
    });

