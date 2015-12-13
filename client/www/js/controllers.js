
angular.module('starter.controllers', [])

    .controller('ForecastCtrl', function ($scope, $rootScope, $ionicPlatform, $ionicAnalytics, $ionicScrollDelegate,
                                          $ionicPopup, $q, $http, $timeout, WeatherInfo, WeatherUtil,
                                          $ionicNavBarDelegate) {

        $scope.skipGuide = false;
        if(typeof(Storage) !== "undefined") {
            if (localStorage.getItem("skipGuide") !== null) {
                $scope.skipGuide = localStorage.getItem("skipGuide");
            }
        }
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

        var colWidth;
        var cityData;
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

        function setUserDefaults(obj) {
            if (window.applewatch) {
                applewatch.sendUserDefaults(function() {
                    console.log(obj);
                }, function() {
                    console.log("Failed to sendUserDefault");
                }, obj, "group.net.wizardfactory.todayweather");
            }
        }

        function loadWeatherData() {
            cityData = WeatherInfo.getCityOfIndex(WeatherInfo.cityIndex);
            if (cityData === null) {
                console.log("fail to getCityOfIndex");
                return;
            }

            console.log("start");

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
            if (ionic.Platform.isIOS()) {
                var shortestAddress = $scope.address.split(",")[1];
                if (!shortestAddress) { shortestAddress = $scope.address.split(",")[0];
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

                for (var i = 0; i < $scope.dayTable.length; i++) {
                    if ($scope.dayTable[i].week === "오늘") {
                        setUserDefaults({"TodayMaxTemp": String($scope.dayTable[i - 1].tmx || 99)});
                        setUserDefaults({"TodayMinTemp": String($scope.dayTable[i - 1].tmn || 0)});
                        setUserDefaults({"YesterdayMaxTemp": String($scope.dayTable[i].tmx || 99)});
                        setUserDefaults({"YesterdayMinTemp": String($scope.dayTable[i].tmn || 0)});
                        setUserDefaults({"TomorrowMaxTemp": String($scope.dayTable[i + 1].tmx || 99)});
                        setUserDefaults({"TomorrowMinTemp": String($scope.dayTable[i + 1].tmn || 0)});
                        break;
                    }
                }
            }
            // end for apple watch

            $timeout(function() {
                $ionicScrollDelegate.$getByHandle("timeChart").scrollTo(getTodayNowPosition(7), 0, false);
                $ionicScrollDelegate.$getByHandle("weeklyChart").scrollTo(getTodayNowPosition(5), 0, false);
            },0);
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
                    deferred.resolve();
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
                                deferred.reject();
                            });
                        }
                    }, function () {
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
            }

            return deferred.promise;
        }

        function getWidthPerCol() {
            if (colWidth)  {
                return colWidth;
            }

            var bodyWidth =  window.innerWidth;
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

        function getTodayNowPosition(index) {
            return getWidthPerCol()*index;
        }

        function showAlert(title, msg) {
            var alertPopup = $ionicPopup.alert({
                title: title,
                template: msg
            });
            alertPopup.then(function() {
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

        $scope.$on('$ionicView.enter', function() {
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

        $scope.$on('updateWeatherEvent', function(event) {
            console.log('called by update weather event');
            $scope.doRefresh();
        });

        var isShowingBar = false;

        $scope.doRefresh = function() {

            $ionicNavBarDelegate.title("위치,날씨정보 업데이트 중");
            isShowingBar = !isShowingBar;
            $ionicNavBarDelegate.showBar(isShowingBar);
            updateWeatherData(true).finally(function () {
                $scope.address = WeatherUtil.getShortenAddress(cityData.address);

                isShowingBar = !isShowingBar;
                $ionicNavBarDelegate.showBar(isShowingBar);
            });
        };

        $scope.onClickGuide = function() {
            if(typeof(Storage) !== "undefined") {
                localStorage.setItem("skipGuide", true);
            }
            $scope.skipGuide = true;
        };

        $scope.onSwipeLeft = function() {
            if (WeatherInfo.getCityCount() === 1) {
                return;
            }

            if (WeatherInfo.cityIndex === WeatherInfo.getCityCount() - 1) {
                WeatherInfo.cityIndex = 0;
            }
            else {
                WeatherInfo.cityIndex += 1;
            }

            loadWeatherData();
        };

        $scope.onSwipeRight = function() {
            if (WeatherInfo.getCityCount() === 1) {
                return;
            }

            if (WeatherInfo.cityIndex === 0) {
                WeatherInfo.cityIndex = WeatherInfo.getCityCount() - 1;
            }
            else {
                WeatherInfo.cityIndex -= 1;
            }

            loadWeatherData();
        };

        $ionicPlatform.ready(function() {
            console.log($ionicAnalytics.globalProperties);
            console.log(ionic.Platform);

            WeatherInfo.loadCities();
            WeatherInfo.loadTowns().then(function () {
                WeatherInfo.updateCities();
                loadWeatherData();
                checkForUpdates().finally(function () {
                    updateWeatherData(false).finally(function () {
                        $scope.address = WeatherUtil.getShortenAddress(cityData.address);
                    });
                });
            });

            var runLocalNotification = false;

            if (runLocalNotification) {
                //todo: notification setting on settings, load setting info from local storage, make user story
                //todo: move to service or app(consider updateWeatherData func)
                if (cordova && cordova.plugins && cordova.plugins.notification && cordova.plugins.notification.local) {
                    cordova.plugins.notification.local.hasPermission(function (granted) {
                        console.log('hasPermission '+ granted ? 'Yes' : 'No');
                    });

                    cordova.plugins.notification.local.registerPermission(function (granted) {
                        console.log('registerPermission '+ granted ? 'Yes' : 'No');

                        cordova.plugins.notification.local.schedule({
                            id: 1,
                            text: 'My first notification',
                            //firstAt: today_at_1_am,
                            every: "minute"
                        });
                    });

                    cordova.plugins.notification.local.on('trigger', function (notification) {
                        console.log('triggered: ' + notification.id);

                        updateWeatherData(true).finally(function () {
                            cordova.plugins.notification.local.update({
                                id: 1,
                                text: $scope.currentWeather.summary
                            });
                        });
                    }, this);

                    cordova.plugins.notification.local.on('click', function (notification) {
                        console.log('clicked: ' + notification.id);
                    }, this);
                }
                else {
                    console.log('local notification plugin was unloaded');
                }
            }
        });

        identifyUser();
    })

    .controller('SearchCtrl', function ($scope, $rootScope, $ionicPlatform, $ionicAnalytics, $ionicPopup, $location,
                                        $ionicScrollDelegate, WeatherInfo, WeatherUtil) {
        $scope.searchWord = undefined;
        $scope.searchResults = [];
        $scope.cityList = [];
        $scope.isLoading = false;
        var towns = WeatherInfo.towns;
        var searchIndex = -1;

        WeatherInfo.cities.forEach(function (city) {
            var address = WeatherUtil.getShortenAddress(city.address).split(",");
            var todayData = city.dayTable.filter(function (data) {
                return (data.week === "오늘");
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
        });

        $scope.$on('$ionicView.enter', function() {
            $rootScope.viewColor = '#ec72a8';
        });

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
            $scope.searchWord = undefined;
            $scope.searchResults = [];
            $scope.isLoading = true;

            var address = result.first;
            if (result.second !== "") {
                address += "+" + result.second;
            }
            if (result.third !== "") {
                address += "+" + result.third;
            }

            WeatherUtil.getAddressToGeolocation(address).then(function (location) {
                WeatherUtil.getAddressFromGeolocation(location.lat, location.long).then(function (address) {
                    WeatherUtil.getWeatherInfo(address, WeatherInfo.towns).then(function (weatherDatas) {
                        var city = WeatherUtil.convertWeatherData(weatherDatas);
                        city.currentPosition = false;
                        city.address = address;
                        city.location = location;

                        if (WeatherInfo.addCity(city) === false) {
                            var msg = "이미 동일한 지역이 추가되어 있습니다.";
                            var alertPopup = $ionicPopup.alert({
                                title: "에러",
                                template: msg
                            });
                            alertPopup.then(function() {
                                console.log("alertPopup close");
                            });
                        }
                        else {
                            WeatherInfo.cityIndex = WeatherInfo.getCityCount() - 1;
                            $location.path('/tab/forecast');
                        }
                        $scope.isLoading = false;
                    }, function () {
                        $scope.isLoading = false;
                    });
                }, function () {
                    $scope.isLoading = false;
                });
            }, function () {
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
            WeatherInfo.cityIndex = index;
            $location.path('/tab/forecast');
        };

        $scope.OnDeleteCity = function(index) {
            $scope.cityList.splice(index, 1);
            WeatherInfo.removeCity(index);

            if (WeatherInfo.cityIndex === WeatherInfo.getCityCount()) {
                WeatherInfo.cityIndex = 0;
            }
            return false; //OnSelectCity가 호출되지 않도록 이벤트 막음
        };

        $ionicPlatform.ready(function() {
            console.log($ionicAnalytics.globalProperties);
            console.log(ionic.Platform);
        });
    })

    .controller('SettingCtrl', function($scope, $rootScope, $ionicPlatform, $ionicAnalytics, $ionicPopup,
                                        $http, $cordovaInAppBrowser) {
        //sync with config.xml
        $scope.version  = "0.6.7";

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

        //for chrome extension
        if (window.chrome) {
            if (chrome.extension) {
                $http({method: 'GET', url: chrome.extension.getURL("manifest.json"), timeout: 3000}).success(function (manifest) {
                    console.log("Version: " + manifest.version);
                    $scope.version = manifest.version;
                })
                    .error(function (err) {
                        console.log(err);
                    });
            }
        }

        $scope.$on('$ionicView.enter', function() {
            $rootScope.viewColor = '#ea9623';
        });

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
            alertPopup.then(function() {
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

        $scope.doTabRefresh = function() {
            //send event
            $scope.$broadcast('updateWeatherEvent');
        };

        //$ionicPlatform.ready(function() {
        //    WeatherInfo.loadCities();
        //    WeatherInfo.loadTowns().then(function () {
        //        WeatherInfo.updateCities();
        //    });
        //});
    });

