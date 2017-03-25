angular.module('controller.searchctrl', [])
    .controller('SearchCtrl', function ($scope, $rootScope, $ionicScrollDelegate, TwAds, $q, $ionicHistory,
                                        $location, WeatherInfo, WeatherUtil, Util, ionicTimePicker, Push, $ionicLoading,
                                        $translate, $ocLazyLoad, $ionicPopup) {
        $scope.searchWord = undefined;
        $scope.searchResults = [];
        $scope.searchResults2 = [];
        $scope.cityList = [];
        $scope.imgPath = Util.imgPath;
        $scope.isEditing = false;

        var towns = WeatherInfo.towns;
        var searchIndex = -1;
        var isLoadingIndicator = false;

        var strFailToGetAddressInfo = "Fail to get location information";
        var strFailToGetCurrentPosition = "Fail to find your current location";
        var strFailToGetWeatherInfo = "Fail to get weather info.";
        var strPleaseTurnOnLocationWiFi = "Please turn on location and Wi-FI";
        var strError = "Error";
        var strAlreadyTheSameLocationHasBeenAdded = "Already the same location has been added.";
        var strCurrent = "Current";
        var strLocation = "Location";

        $translate(['LOC_FAIL_TO_GET_LOCATION_INFORMATION', 'LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION',
            'LOC_FAIL_TO_GET_WEATHER_INFO', 'LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI', 'LOC_ERROR',
            'LOC_ALREADY_THE_SAME_LOCATION_HAS_BEEN_ADDED', 'LOC_CURRENT', 'LOC_LOCATION']).then(function (translations) {
            strFailToGetAddressInfo = translations.LOC_FAIL_TO_GET_LOCATION_INFORMATION;
            strFailToGetCurrentPosition = translations.LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION;
            strFailToGetWeatherInfo = translations.LOC_FAIL_TO_GET_WEATHER_INFO;
            strPleaseTurnOnLocationWiFi = translations.LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI;
            strError = translations.LOC_ERROR;
            strAlreadyTheSameLocationHasBeenAdded = translations.LOC_ALREADY_THE_SAME_LOCATION_HAS_BEEN_ADDED;
            strCurrent = translations.LOC_CURRENT;
            strLocation = translations.LOC_LOCATION;
        }, function (translationIds) {
            console.log("Fail to translate : " + JSON.stringify(translationIds));
        });

        var service;
        if (window.google == undefined) {
            $ocLazyLoad.load('js!https://maps.googleapis.com/maps/api/js?libraries=places').then(function () {
                console.log('googleapis loaded');
                service = new google.maps.places.AutocompleteService();
            }, function (e) {
                console.log(e);
                Util.ga.trackEvent('load', 'error', e);
                Util.ga.trackException(e, true);
                window.alert(e);
            });
        }
        else {
            service = new google.maps.places.AutocompleteService();
        }

        var callbackAutocomplete = function(predictions, status) {
            if (google == undefined) {
                console.log('Fail to load google maps places');
                Util.ga.trackEvent('autocomplete', 'error', 'google', 0);
                return;
            }
            if (status != google.maps.places.PlacesServiceStatus.OK) {
                Util.ga.trackEvent('autocomplete', 'error', status);
                console.log(status);
                return;
            }
            else {
                console.log("predictions="+predictions.length);
            }
            $scope.searchResults2 = predictions;
        };

        function init() {
            $ionicHistory.clearHistory();

            for (var i = 0; i < WeatherInfo.getCityCount(); i += 1) {
                var city = WeatherInfo.getCityOfIndex(i);
                var address = WeatherUtil.getShortenAddress(city.address).split(",");
                var todayData;

                if (city.name) {
                    address = [city.name];
                }

                if (city.currentPosition && city.address === null) {
                    address = [strCurrent, strLocation];
                }
                if (!city.currentWeather) {
                    city.currentWeather = {};
                }
                if (!city.currentWeather.skyIcon) {
                    city.currentWeather.skyIcon = 'Sun';
                }
                if (city.currentWeather.t1h === undefined) {
                    city.currentWeather.t1h = '-';
                }

                todayData = city.currentWeather.today;
                if (todayData == undefined) {
                    todayData = [{tmn:'-', tmx:'-'}];
                }

                var data = {
                    address: address,
                    currentPosition: city.currentPosition,
                    disable: city.disable,
                    skyIcon: city.currentWeather.skyIcon,
                    t1h: city.currentWeather.t1h,
                    tmn: todayData.tmn,
                    tmx: todayData.tmx,
                    alarmInfo: Push.getAlarm(i)
                };
                $scope.cityList.push(data);
                loadWeatherData(i);
            }
          
            window.addEventListener('native.keyboardshow', function () {
                // Describe your logic which will be run each time when keyboard is about to be shown.
                console.log('keyboard will show');
                Util.ga.trackEvent('keyboard', 'show');
            });
            window.addEventListener('native.keyboardhide', function () {
                // Describe your logic which will be run each time when keyboard is about to be closed.
                console.log('keyboard will hide');
                Util.ga.trackEvent('keyboard', 'hide');
            });
          
            if (ionic.Platform.isIOS() == false) {
                if (WeatherInfo.getEnabledCityCount() == 0) {
                    setTimeout(function () {
                        console.log('set focus on search input');
                        document.getElementById('searchInput').focus();
                    }, 100);
                }
            }
            else {
                console.log("focus doesn't work on ios");
            }
        }

        $scope.OnChangeSearchWord = function() {
            $scope.isEditing = false;

            if ($scope.searchWord === "") {
                $scope.searchWord = undefined;
                $scope.searchResults = [];
                $scope.searchResults2 = [];
                return;
            }

            $scope.searchResults = [];
            $ionicScrollDelegate.$getByHandle('cityList').scrollTop();
            searchIndex = 0;
            $scope.OnScrollResults();

            console.log($scope.searchWord);
            if (!(service == undefined)) {
                service.getPlacePredictions({
                    input: $scope.searchWord,
                    types: ['(regions)'],
                    componentRestrictions: {}
                }, callbackAutocomplete);
            }
        };

        var gIsLocationAuthorized;

        $scope.OnSearchCurrentPosition = function() {
            Util.ga.trackEvent('currentPosition', 'search');
            $scope.isEditing = false;

            showLoadingIndicator();

            updateCurrentPosition().then(function(geoInfo) {
                hideLoadingIndicator();
                $scope.searchResults = [];
                $scope.searchResults2 = [];
                $scope.searchWord = geoInfo.name;
                $scope.searchResults2.push({name: geoInfo.name, description: geoInfo.googleAddress});
                $ionicScrollDelegate.$getByHandle('cityList').scrollTop();
                searchIndex = -1;
            }, function(msg) {
                hideLoadingIndicator();
                if (msg !== null) {
                    if (gIsLocationAuthorized == false) {

                        Util.ga.trackEvent('position', 'show', 'authorized', 0);

                        msg += '<br>';
                        msg += $translate.instant("LOC_OPENS_THE_APP_INFO_PAGE");
                        var confirmPopup = $ionicPopup.confirm({
                            title: strError,
                            template: msg,
                            okText: $translate.instant("LOC_SETTING"),
                            cancelText: $translate.instant("LOC_CLOSE")
                        });
                        confirmPopup.then(function (res) {
                            if (res) {
                                console.log("Opens settings page for this app.");
                                Util.ga.trackEvent('position', 'open', 'settings');
                                setTimeout(function () {
                                    cordova.plugins.diagnostic.switchToSettings(function () {
                                        console.log("Successfully switched to Settings app");
                                    }, function (error) {
                                        console.log("The following error occurred: "+error);
                                    });
                                }, 0);
                            } else {
                                console.log("Close");
                                Util.ga.trackEvent('position', 'close', 'popup');
                            }
                        });
                    }
                    else {
                        Util.ga.trackEvent('position', 'show', msg);
                        $scope.showAlert(strError, msg);
                    }
                }
            });
        };

        $scope.OnEdit = function() {
            $scope.isEditing = !$scope.isEditing;
            if ($scope.isEditing) {
                $scope.searchWord = undefined;
                $scope.searchResults = [];
                $scope.searchResults2 = [];
            }
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

        function saveCity(weatherData, geoInfo) {
            var city = WeatherUtil.convertWeatherData(weatherData);
            if (city == undefined) {
                return false;
            }
            city.name = geoInfo.name;
            city.currentPosition = false;
            city.address = geoInfo.address;
            city.location = geoInfo.location;
            city.country = geoInfo.country; //"KR"

            if (WeatherInfo.addCity(city) === false) {
                Util.ga.trackEvent('city error', 'add', WeatherUtil.getShortenAddress(geoInfo.address), WeatherInfo.getCityCount() - 1);
                return false;
            }
            else {
                Util.ga.trackEvent('city', 'add', WeatherUtil.getShortenAddress(geoInfo.address), WeatherInfo.getCityCount() - 1);
                return true;
            }
            return false;
        }

        $scope.OnSelectResult = function(result) {
            if (window.cordova && window.cordova.plugins && window.cordova.plugins.Keyboard) { 
                if (cordova.plugins.Keyboard.isVisible) {
                    return cordova.plugins.Keyboard.close(); 
                }
            }

            result.name = $scope.searchWord;
            $scope.searchWord = undefined;
            $scope.searchResults = [];
            $scope.searchResults2 = [];

            $ionicLoading.show();

            if (result.hasOwnProperty('first')) {
                var address = "대한민국"+" "+result.first;
                var name = result.first;
                if (result.second !== "") {
                    name = result.second;
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
                    name = result.third;
                    address += " " + result.third;
                }

                var geoInfo = {address: address, location: {lat:result.lat, long:result.long}, country: "KR", name: name};
                var startTime = new Date().getTime();

                WeatherUtil.getWorldWeatherInfo(geoInfo).then(function (weatherData) {
                    var endTime = new Date().getTime();
                    Util.ga.trackTiming('weather', endTime - startTime, 'get', 'info');
                    Util.ga.trackEvent('weather', 'get', WeatherUtil.getShortenAddress(address) , endTime - startTime);

                    if (saveCity(weatherData, geoInfo) == false) {
                        Util.ga.trackEvent('city', 'add error', WeatherUtil.getShortenAddress(address), WeatherInfo.getCityCount() - 1);
                        $scope.showAlert(strError, strAlreadyTheSameLocationHasBeenAdded);
                    }
                    else {
                        Util.ga.trackEvent('city', 'add', WeatherUtil.getShortenAddress(address), WeatherInfo.getCityCount() - 1);

                        WeatherInfo.setCityIndex(WeatherInfo.getCityCount() - 1);
                        $location.path('/tab/forecast');
                    }
                    $ionicLoading.hide();
                }, function (error) {
                    var endTime = new Date().getTime();
                    Util.ga.trackTiming('weather', endTime - startTime, 'error', 'info');
                    if (error instanceof Error) {
                        Util.ga.trackEvent('weather', 'error', WeatherUtil.getShortenAddress(address) +
                            '(message:' + error.message + ', code:' + error.code + ')', endTime - startTime);
                    } else {
                        Util.ga.trackEvent('weather', 'error', WeatherUtil.getShortenAddress(address) +
                            '(' + error + ')', endTime - startTime);
                    }

                    $scope.showAlert(strError, strFailToGetWeatherInfo);

                    $ionicLoading.hide();
                });
            }
            else {
                if (result.matched_substrings && result.matched_substrings.length > 0) {
                    var matched_substrings_offset =  result.matched_substrings[0].offset;
                    for (var i=0; i<result.terms.length; i++) {
                        if (result.terms[i].offset == matched_substrings_offset) {
                            result.name = result.terms[i].value;
                            break;
                        }
                    }
                }

                WeatherUtil.getGeoInfoFromAddress(result.description).then(function(geoInfo) {
                    geoInfo.name = result.name;
                    WeatherUtil.getWorldWeatherInfo(geoInfo).then(function (weatherData) {

                        if (saveCity(weatherData, geoInfo) == false) {
                            $scope.showAlert(strError, strAlreadyTheSameLocationHasBeenAdded);
                        }
                        else {
                            WeatherInfo.setCityIndex(WeatherInfo.getCityCount() - 1);
                            $location.path('/tab/forecast');
                        }
                        $ionicLoading.hide();
                    }, function () {
                        Util.ga.trackEvent('getWorldWeatherInfo', 'error', strFailToGetWeatherInfo);
                        $scope.showAlert(strError, strFailToGetWeatherInfo);
                        $ionicLoading.hide();
                    });
                }, function (err) {
                    console.log(err);
                    Util.ga.trackEvent('getGeoInfo', 'error', err);
                    $ionicLoading.hide();
                });
            }
        };

        $scope.OnSelectCity = function(index) {
            if ($scope.isEditing === true) {
                return;
            }

            if (window.cordova && window.cordova.plugins && window.cordova.plugins.Keyboard) {
                if (cordova.plugins.Keyboard.isVisible) {
                    return cordova.plugins.Keyboard.close();
                }
            }

            WeatherInfo.setCityIndex(index);
            $location.path('/tab/forecast');
        };

        $scope.OnDisableCity = function() {
            Util.ga.trackEvent('city', 'disable', $scope.cityList[0].disable, 0);

            WeatherInfo.disableCity($scope.cityList[0].disable);

            return false; //OnDisableCity가 호출되지 않도록 이벤트 막음
        };

        $scope.OnDeleteCity = function(index) {
            Util.ga.trackEvent('city', 'delete', WeatherUtil.getShortenAddress(WeatherInfo.getCityOfIndex(index).address), index);

            if ($scope.cityList[index].alarmInfo != undefined) {
                Push.removeAlarm($scope.cityList[index].alarmInfo);
            }
            $scope.cityList.splice(index, 1);
            WeatherInfo.removeCity(index);

            return false; //OnSelectCity가 호출되지 않도록 이벤트 막음
        };

        $scope.OnOpenTimePicker = function (index) {
            Util.ga.trackEvent('alarm', 'open', 'timePicker');
            var ipObj1 = {
                callback: function (val) {      //Mandatory
                    if (typeof(val) === 'undefined') {
                        Util.ga.trackEvent('alarm', 'close', 'timePicker');
                        console.log('closed');
                    } else if (val == 0) {
                        Util.ga.trackEvent('alarm', 'cancel', WeatherUtil.getShortenAddress(WeatherInfo.getCityOfIndex(index).address), index);

                        console.log('cityIndex='+index+' alarm canceled');
                        if ($scope.cityList[index].alarmInfo != undefined) {
                            Push.removeAlarm($scope.cityList[index].alarmInfo);
                            $scope.cityList[index].alarmInfo = undefined;
                        }
                    } else {
                        Util.ga.trackEvent('alarm', 'set', WeatherUtil.getShortenAddress(WeatherInfo.getCityOfIndex(index).address), index);

                        var selectedTime = new Date();
                        selectedTime.setHours(0,0,0,0);
                        selectedTime.setSeconds(val);

                        console.log('index=' + index + ' Selected epoch is : ' + val + 'and the time is ' +
                                    selectedTime.toString());

                        Push.updateAlarm(index, WeatherInfo.getCityOfIndex(index).address, selectedTime, function (err, alarmInfo) {
                            console.log('alarm='+JSON.stringify(alarmInfo));
                            $scope.cityList[index].alarmInfo = alarmInfo;
                        });
                    }
                }
            };
            if ($scope.cityList[index].alarmInfo != undefined) {
                var date = new Date($scope.cityList[index].alarmInfo.time);
                console.log(date);
                ipObj1.inputTime = date.getHours() * 60 * 60 + date.getMinutes() * 60;
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
                console.log("Fail to translate "+ JSON.stringify(translationIds));
            }).finally(function () {
                ipObj1.setLabel = strSetting;
                ipObj1.cancelLabel = strDelete;
                ipObj1.closeLabel = strClose;
                ionicTimePicker.openTimePicker(ipObj1);
            });
        };

        function showLoadingIndicator() {
            $ionicLoading.show().then(function() {
                // 위치 권한이 거부된 경우 show 후에 바로 hide를 할 때 hide의 resolve가 먼저 처리되어 LoadingIndicator가 보여지는 경우가 있음
                // 실제로 show가 되면 상태를 체크하여 hide를 다시 요청함
                if (isLoadingIndicator == false) {
                    $ionicLoading.hide();
                }
            });
            isLoadingIndicator = true;
        }

        function hideLoadingIndicator() {
            $ionicLoading.hide();
            isLoadingIndicator = false;
        }

        function updateCurrentPosition() {
            var deferred = $q.defer();

            if (window.cordova && window.cordova.plugins && window.cordova.plugins.diagnostic) {
                if (ionic.Platform.isIOS()) {
                    if (Util.isLocationEnabled()) {
                        _getCurrentPosition(deferred, true, true);
                    } else if (Util.locationStatus === cordova.plugins.diagnostic.permissionStatus.NOT_REQUESTED) {
                        // location service가 off 상태로 시작한 경우에는 denied로 설정되어 있음. on 상태인 경우에 not_requested로 들어옴
                        _getCurrentPosition(deferred, true, undefined);
                    } else {
                        _getCurrentPosition(deferred, false, undefined);
                    }
                } else if (ionic.Platform.isAndroid()) {
                    if (Util.isLocationEnabled()) {
                        cordova.plugins.diagnostic.getLocationAuthorizationStatus(function (status) {
                            if (status === cordova.plugins.diagnostic.permissionStatus.GRANTED) {
                                _getCurrentPosition(deferred, true, true);
                            } else if (status === cordova.plugins.diagnostic.permissionStatus.DENIED_ALWAYS) {
                                _getCurrentPosition(deferred, true, false);
                            } else if (status === cordova.plugins.diagnostic.permissionStatus.NOT_REQUESTED
                                || status === cordova.plugins.diagnostic.permissionStatus.DENIED) {
                                _getCurrentPosition(deferred, true, undefined);
                            }
                        }, function (error) {
                            console.error("Error getting for location authorization status: " + error);
                        });
                    } else {
                        _getCurrentPosition(deferred, false, undefined);
                    }
                }
            }
            else {
                //for browser
                _getCurrentPosition(deferred, true, true);
            }

            return deferred.promise;
        }

        function _getCurrentPosition(deferred, isLocationEnabled, isLocationAuthorized) {
            var msg;
            Util.ga.trackEvent('location', 'is', 'enable', isLocationEnabled?1:0);
            Util.ga.trackEvent('location', 'is', 'authorized', isLocationAuthorized?1:0);
            gIsLocationAuthorized = isLocationAuthorized;
            if (isLocationEnabled === true) {
                if (isLocationAuthorized === true) {
                    WeatherUtil.getCurrentPosition().then(function (coords) {
                        WeatherUtil.getGeoInfoFromGeolocation(coords.latitude, coords.longitude).then(function (geoInfo) {
                            deferred.resolve(geoInfo);
                        }, function () {
                            deferred.reject(strFailToGetAddressInfo);
                        });
                    }, function () {
                        Util.ga.trackEvent('position', 'error', 'all');
                        msg = strFailToGetCurrentPosition;
                        if (ionic.Platform.isAndroid()) {
                            msg += "<br>" + strPleaseTurnOnLocationWiFi;
                        }
                        deferred.reject(msg);
                    });
                } else if (isLocationAuthorized === false) {
                    msg = $translate.instant("LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED");
                    deferred.reject(msg);
                } else if (isLocationAuthorized === undefined) {
                    $ionicLoading.hide();
                    if (window.cordova && window.cordova.plugins && window.cordova.plugins.diagnostic) {
                        // ios : 앱을 사용하는 동안 '오늘날씨'에서 사용자의 위치에 접근하도록 허용하겠습니까?
                        // android : 오늘날씨의 다음 작업을 허용하시겠습니까? 이 기기의 위치에 액세스하기
                        cordova.plugins.diagnostic.requestLocationAuthorization(function () {
                        }, null, cordova.plugins.diagnostic.locationAuthorizationMode.WHEN_IN_USE);
                    }
                    deferred.reject(null);
                }
            } else if (isLocationEnabled === false) {
                msg = $translate.instant("LOC_PLEASE_TURN_ON_LOCATION_SERVICES_TO_FIND_YOUR_CURRENT_LOCATION");
                deferred.reject(msg);
            }
        }

        function loadWeatherData(index) {
            if (WeatherInfo.canLoadCity(index) === true) {
                updateWeatherData(index).then(function (city) {
                    index = WeatherInfo.getIndexOfCity(city);
                    if (index !== -1) {
                        WeatherInfo.updateCity(index, city);

                        var address = WeatherUtil.getShortenAddress(city.address).split(",");
                        var todayData = city.currentWeather.today;
                        var data = $scope.cityList[index];
                        if (city.name) {
                            data.address = [];
                            data.address.push(city.name);
                        }
                        else {
                            data.address = address;
                        }
                        data.skyIcon = city.currentWeather.skyIcon;
                        data.t1h = city.currentWeather.t1h;
                        data.tmn = todayData.tmn;
                        data.tmx = todayData.tmx;
                    }
                });
            }
        }

        /**
         *
         * @param index
         * @returns {*}
         */
        function updateWeatherData(index) {
            var deferred = $q.defer();
            var cityData = WeatherInfo.getCityOfIndex(index);

            // 현재 위치는 저장된 위치가 있는 경우에만 날씨 데이터를 업데이트함
            if (cityData.currentPosition === true && cityData.address === null && cityData.location === null) {
                deferred.reject();
            } else {
                var startTime = new Date().getTime();

                WeatherUtil.getWorldWeatherInfo(cityData).then(function (weatherData) {
                    var endTime = new Date().getTime();
                    Util.ga.trackTiming('weather', endTime - startTime, 'get', 'info');
                    Util.ga.trackEvent('weather', 'get', WeatherUtil.getShortenAddress(cityData.address) +
                        '(' + index + ')', endTime - startTime);

                    var city = WeatherUtil.convertWeatherData(weatherData);
                    if (city == undefined) {
                        deferred.reject();
                        return;
                    }
                    city.currentPosition = cityData.currentPosition;
                    city.name = cityData.name;
                    city.country = cityData.country;
                    city.address = cityData.address;
                    if (cityData.location) {
                        city.location = cityData.location;
                    }
                    deferred.resolve(city);
                }, function (error) {
                    var endTime = new Date().getTime();
                    Util.ga.trackTiming('weather', endTime - startTime, 'error', 'info');
                    if (error instanceof Error) {
                        Util.ga.trackEvent('weather', 'error', WeatherUtil.getShortenAddress(cityData.address) +
                            '(' + index + ', message:' + error.message + ', code:' + error.code + ')', endTime - startTime);
                    } else {
                        Util.ga.trackEvent('weather', 'error', WeatherUtil.getShortenAddress(cityData.address) +
                            '(' + index + ', ' + error + ')', endTime - startTime);
                    }

                    deferred.reject();
                });
            }

            return deferred.promise;
        }

        init();
    });
