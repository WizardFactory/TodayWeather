angular.module('controller.searchctrl', [])
    .controller('SearchCtrl', function ($scope, $rootScope, $ionicScrollDelegate, TwAds, $q, $ionicHistory,
                                        $location, WeatherInfo, WeatherUtil, Util, ionicTimePicker, Push, $ionicLoading,
                                        $translate, $ocLazyLoad) {
        $scope.search = {};
        $scope.searchResults = [];
        $scope.searchResults2 = [];
        $scope.cityList = [];
        $scope.isEditing = false;
        $scope.isSearching = false;

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

        var service;
        function _lazyLoad(url) {
            $ocLazyLoad.load(url).then(function () {
                console.log('google apis loaded');
                service = new google.maps.places.AutocompleteService();
            }, function (e) {
                Util.ga.trackEvent('window', 'error', 'lazyLoad');
                Util.ga.trackException(e, true);
                //window.alert(e);
            });
        }

        if (window.google == undefined) {
           _lazyLoad(Util.placesUrl);
        }
        else {
            service = new google.maps.places.AutocompleteService();
        }

        var callbackAutocomplete = function(predictions, status) {
            if (google == undefined) {
                Util.ga.trackEvent('address', 'error', 'autoCompleteGoogleUndefined');
                return;
            }
            if (status != google.maps.places.PlacesServiceStatus.OK) {
                if (status != google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
                    Util.ga.trackEvent('address', 'error', 'PlacesServiceStatus='+status);
                    console.log(status);
                }
                else {
                    //zero results
                }
                return;
            }
            else {
                console.log("predictions="+predictions.length);
            }

            $scope.$apply(function () {
                $scope.searchResults2 = predictions;
            });
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
                    if (
                        Util.language.indexOf("ko") != -1 ||
                        Util.language.indexOf("ja") != -1 ||
                        Util.language.indexOf("zh-CN") != -1 ||
                        Util.language.indexOf("zh-TU") != -1) {

                        address = [strCurrent+strLocation];
                    }
                    else {
                        address = [strCurrent+" "+strLocation];
                    }
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
                if (city.currentPosition) {
                    var indexOfCurrentPositionCity = i;
                    updateCurrentPosition().then(function(geoInfo) {
                        console.info(JSON.stringify({'newGeoInfo':geoInfo}));
                        WeatherInfo.updateCity(indexOfCurrentPositionCity, geoInfo);
                        WeatherInfo.reloadCity(indexOfCurrentPositionCity);
                        loadWeatherData(indexOfCurrentPositionCity);
                    });
                }
            }
          
            window.addEventListener('native.keyboardshow', function () {
                // Describe your logic which will be run each time when keyboard is about to be shown.
                Util.ga.trackEvent('window', 'show', 'keyboard');
            });
            window.addEventListener('native.keyboardhide', function () {
                // Describe your logic which will be run each time when keyboard is about to be closed.
                Util.ga.trackEvent('window', 'hide', 'keyboard');
            });

            if (WeatherInfo.getEnabledCityCount() == 0) {
                $scope.$broadcast('setInputFocus');
            }
        }

        $scope.OnChangeSearchWord = function() {
            $scope.isEditing = false;

            if ($scope.search.word === "") {
                $scope.search.word = undefined;
                $scope.searchResults = [];
                $scope.searchResults2 = [];
                return;
            }

            if ($scope.search.word == undefined) {
                console.error("search word is undefined");
                return;
            }

            $scope.searchResults = [];
            $ionicScrollDelegate.$getByHandle('cityList').scrollTop();
            searchIndex = 0;
            $scope.OnScrollResults();

            console.log($scope.search.word);
            if (!(service == undefined)) {
                service.getPlacePredictions({
                    input: $scope.search.word,
                    types: ['(regions)'],
                    componentRestrictions: {}
                }, callbackAutocomplete);
            }
        };

        $scope.OnFocusInput = function() {
            $scope.isEditing = false;
            $scope.isSearching = true;
        };

        $scope.$on('searchCurrentPositionEvent', function(event) {
            console.log(event);
            $scope.OnSearchCurrentPosition();
        });

        $scope.$on('updateCurrentPositionWeatherEvent', function(event) {
            console.log(event);
            updateCurrentPositionWeather();
        });

        $scope.OnSearchCurrentPosition = function() {
            Util.ga.trackEvent('position', 'get', 'OnSearch');
            $scope.isEditing = false;

            showLoadingIndicator();

            updateCurrentPosition().then(function(geoInfo) {
                hideLoadingIndicator();
                $scope.searchResults = [];
                $scope.searchResults2 = [];
                $scope.search.word = geoInfo.name;
                geoInfo.description = geoInfo.address;
                $scope.searchResults2.push(geoInfo);

                $ionicScrollDelegate.$getByHandle('cityList').scrollTop();
                searchIndex = -1;
            }, function(msg) {
                hideLoadingIndicator();
                if (msg !== null) {
                    $scope.showRetryConfirm(strError, msg, 'search');
                }
                else {
                    $scope.$broadcast('searchCurrentPositionEvent');
                }
            });
        };

        $scope.OnEdit = function() {
            if ($scope.isEditing) { // ok
                $scope.isEditing = false;
            } else {
                if ($scope.isSearching) { // cancel
                    $scope.isSearching = false;
                    if (window.cordova && window.cordova.plugins && window.cordova.plugins.Keyboard) {
                        if (cordova.plugins.Keyboard.isVisible) {
                            cordova.plugins.Keyboard.close();
                        }
                    }
                } else { // edit
                    $scope.isEditing = true;
                }
                $scope.search.word = undefined;
                $scope.searchResults = [];
                $scope.searchResults2 = [];
            }
        };

        $scope.OnScrollResults = function() {
            if ($scope.search.word !== undefined && searchIndex !== -1) {
                for (var i = searchIndex; i < towns.length; i++) {
                    var town = towns[i];
                    if (town.first.indexOf($scope.search.word) >= 0 || town.second.indexOf($scope.search.word) >= 0
                        || town.third.indexOf($scope.search.word) >= 0) {
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
            city.country = geoInfo.country;

            if (WeatherInfo.addCity(city) === false) {
                Util.ga.trackEvent('city error', 'add', WeatherUtil.getShortenAddress(geoInfo.address), WeatherInfo.getCityCount() - 1);
                return false;
            }
            else {
                Util.ga.trackEvent('city', 'add', WeatherUtil.getShortenAddress(geoInfo.address), WeatherInfo.getCityCount() - 1);
                return true;
            }
            //return false;
        }

        /**
         *
         * @param termList Array
         * @private
         */
        function _makeQueryString(termList) {
            if (!Array.isArray(termList)) {
                return;
            }
            termList.sort(function (a, b) {
                if (a.offset > b.offset) {
                    return 1;
                }
                else if (a.offset < b.offset) {
                    return -1;
                }
                else {
                    return 0;
                }
            });

            var str =  termList.map(function (term) {
                return term.value;
            }).toString();

            return str;
        }

        $scope.OnSelectResult = function(result) {
            if (window.cordova && window.cordova.plugins && window.cordova.plugins.Keyboard) { 
                if (cordova.plugins.Keyboard.isVisible) {
                    return cordova.plugins.Keyboard.close(); 
                }
            }

            Util.ga.trackEvent('city', 'select', $scope.search.word);
            result.name = $scope.search.word;
            $scope.search.word = undefined;
            $scope.searchResults = [];
            $scope.searchResults2 = [];
            $scope.isSearching = false;

            $ionicLoading.show();

            var geoInfo;

            if (result.hasOwnProperty('first')) {
                console.info("from town.js "+JSON.stringify(result));
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

                geoInfo = {address: address, location: {lat:result.lat, long:result.long}, country: "KR", name: name};

                var startTime = new Date().getTime();
                WeatherUtil.getWeatherByGeoInfo(geoInfo).then(function (weatherData) {
                    var endTime = new Date().getTime();
                    Util.ga.trackTiming('weather', endTime - startTime, 'get', 'info');
                    Util.ga.trackEvent('weather', 'get', address , endTime - startTime);

                    if (saveCity(weatherData, geoInfo) == false) {
                        Util.ga.trackEvent('city', 'add error', address, WeatherInfo.getCityCount() - 1);
                        $rootScope.showAlert(strError, strAlreadyTheSameLocationHasBeenAdded);
                    }
                    else {
                        Util.ga.trackEvent('city', 'add', address, WeatherInfo.getCityCount() - 1);

                        WeatherInfo.setCityIndex(WeatherInfo.getCityCount() - 1);
                        $location.path('/tab/forecast');
                    }
                    $ionicLoading.hide();
                }, function (error) {
                    var endTime = new Date().getTime();
                    Util.ga.trackTiming('weather', endTime - startTime, 'error', 'info');
                    if (error instanceof Error) {
                        Util.ga.trackEvent('weather', 'error', address +
                            '(message:' + error.message + ', code:' + error.code + ')', endTime - startTime);
                    } else {
                        Util.ga.trackEvent('weather', 'error', address +
                            '(' + error + ')', endTime - startTime);
                    }

                    $rootScope.showAlert(strError, strFailToGetWeatherInfo);

                    $ionicLoading.hide();
                });
            }
            else if (result.hasOwnProperty('matched_substrings')) {
                var queryString;
                try {
                    console.info("from google "+JSON.stringify(result));
                    if (result.matched_substrings && result.matched_substrings.length > 0) {
                        var matched_substrings_offset =  result.matched_substrings[0].offset;
                        for (var i=0; i<result.terms.length; i++) {
                            if (result.terms[i].offset == matched_substrings_offset) {
                                result.name = result.terms[i].value;
                                break;
                            }
                        }
                    }

                    queryString = _makeQueryString(result.terms);
                    if (queryString == undefined) {
                        Util.ga.trackEvent('city', 'error', 'FailMakeQueryString desc='+result.description);
                        queryString = result.description;
                    }
                }
                catch (err) {
                    Util.ga.trackEvent('city', 'error', err);
                    $ionicLoading.hide();
                    return;
                }

                Util.ga.trackEvent('city', 'query', queryString);

                WeatherUtil.getGeoInfoByAddr(queryString)
                    .then(function (geoInfo) {
                        geoInfo.name = result.name;
                        WeatherUtil.getWeatherByGeoInfo(geoInfo).then(function (weatherData) {
                            if (saveCity(weatherData, geoInfo) == false) {
                                Util.ga.trackEvent('city', 'add error', result.description, WeatherInfo.getCityCount() - 1);
                                $rootScope.showAlert(strError, strAlreadyTheSameLocationHasBeenAdded);
                            }
                            else {
                                Util.ga.trackEvent('city', 'add', result.description, WeatherInfo.getCityCount() - 1);
                                WeatherInfo.setCityIndex(WeatherInfo.getCityCount() - 1);
                                $location.path('/tab/forecast');
                            }
                            $ionicLoading.hide();
                        }, function (err) {
                            Util.ga.trackEvent('weather', 'error', err);
                            $rootScope.showAlert(strError, strFailToGetWeatherInfo);
                            $ionicLoading.hide();
                        });
                    }, function (err) {
                        Util.ga.trackEvent('weather', 'error', err);
                        $ionicLoading.hide();
                    });
            }
            else {
                console.info("from geoinfo server "+JSON.stringify(result));
                geoInfo = result;
                WeatherUtil.getWeatherByGeoInfo(geoInfo).then(function (weatherData) {
                    if (saveCity(weatherData, geoInfo) == false) {
                        Util.ga.trackEvent('city', 'add error', geoInfo.address, WeatherInfo.getCityCount() - 1);
                        $rootScope.showAlert(strError, strAlreadyTheSameLocationHasBeenAdded);
                    }
                    else {
                        Util.ga.trackEvent('city', 'add', geoInfo.address, WeatherInfo.getCityCount() - 1);
                        WeatherInfo.setCityIndex(WeatherInfo.getCityCount() - 1);
                        $location.path('/tab/forecast');
                    }
                }, function (err) {
                    Util.ga.trackEvent('weather', 'error', err);
                    $rootScope.showAlert(strError, strFailToGetWeatherInfo);
                }).finally(function () {
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

        function updateCurrentPositionWeather() {
            showLoadingIndicator();
            updateCurrentPosition().then(function(geoInfo) {
                console.log('updated current position');
                WeatherInfo.updateCity(0, geoInfo);
                updateWeatherData(0).then(function (city) {
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
                }).finally(function () {
                    hideLoadingIndicator();
                });
            }, function(msg) {
                console.log('Fail to get current position');
                hideLoadingIndicator();
                if (msg !== null) {
                    $scope.showRetryConfirm(strError, msg, 'search');
                }
                else {
                    $scope.$broadcast('updateCurrentPositionWeatherEvent');
                }
            });
        }

        /**
         *
         * @returns {boolean}
         * @constructor
         */
        $scope.OnDisableCity = function() {
            var city = $scope.cityList[0];
            Util.ga.trackEvent('city', 'disable', city.disable, 0);

            WeatherInfo.disableCity(city.disable);

            if (city.disable === false && city.t1h === '-') {
                //it is enable at first time
                updateCurrentPositionWeather();
            }
            return false; //OnDisableCity가 호출되지 않도록 이벤트 막음
        };

        /**
         *
         * @param index
         * @returns {boolean}
         * @constructor
         */
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

                        Push.updateAlarm(index, selectedTime, function (err, alarmInfo) {
                            if (err) {
                                Util.ga.trackEvent('alarm', 'error', err.message, index);
                                return;
                            }
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
                            $scope.setLocationAuthorizationStatus(status);
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
            Util.ga.trackEvent('position', 'status', 'enabled', isLocationEnabled?1:0);
            Util.ga.trackEvent('position', 'status', 'authorized', isLocationAuthorized?1:0);
            if (isLocationEnabled === true) {
                if (isLocationAuthorized === true) {
                    WeatherUtil.getCurrentPosition().then(function (data) {
                        Util.ga.trackEvent('position', 'done', data.provider);

                        var location = WeatherUtil.geolocationNormalize({lat: data.coords.latitude, long: data.coords.longitude});
                        WeatherUtil.getGeoInfoByLocation(location)
                            .then(function (geoInfo) {
                                console.log(geoInfo);
                                deferred.resolve(geoInfo);
                            }, function (err) {
                                console.error(err);
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
                }
                else if (isLocationAuthorized === false) {
                    msg = $translate.instant("LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED");
                    deferred.reject(msg);
                }
                else if (isLocationAuthorized === undefined) {
                    $ionicLoading.hide();
                    if (window.cordova && window.cordova.plugins && window.cordova.plugins.diagnostic) {
                        // ios : 앱을 사용하는 동안 '오늘날씨'에서 사용자의 위치에 접근하도록 허용하겠습니까?
                        // android : 오늘날씨의 다음 작업을 허용하시겠습니까? 이 기기의 위치에 액세스하기
                        cordova.plugins.diagnostic.requestLocationAuthorization(function (status) {
                            if (ionic.Platform.isAndroid()) {
                                $scope.setLocationAuthorizationStatus(status);
                                if (status === cordova.plugins.diagnostic.permissionStatus.DENIED) {
                                    msg = $translate.instant("LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED");
                                    deferred.reject(msg);
                                }
                                else {
                                    console.log('status='+status+ ' by request location authorization and reload by resume');
                                    deferred.reject(null);
                                }
                            }
                            else {
                                //메세지 없이 통과시키고, reload by locationOn.
                                deferred.reject(null);
                            }
                        }, function (error) {
                            Util.ga.trackEvent('position', 'error', 'request location authorization');
                            Util.ga.trackException(error, false);
                            deferred.reject(null);
                        }, cordova.plugins.diagnostic.locationAuthorizationMode.WHEN_IN_USE);
                    }
                    else {
                        deferred.reject(null);
                    }
                }
            }
            else if (isLocationEnabled === false) {
                if (window.cordova && cordova.plugins.locationAccuracy) {
                    cordova.plugins.locationAccuracy.request (
                        function (success) {
                            console.log(success);
                            Util.ga.trackEvent("position", "status", "successUserAgreed");
                            //메세지 없이 통과시키고, reload by locationOn.
                            deferred.reject(null);
                        },
                        function (error) {
                            Util.ga.trackEvent("position", "error", error.message);
                            msg = $translate.instant("LOC_PLEASE_TURN_ON_LOCATION_SERVICES_TO_FIND_YOUR_CURRENT_LOCATION");
                            deferred.reject(msg);
                        },
                        cordova.plugins.locationAccuracy.REQUEST_PRIORITY_HIGH_ACCURACY);
                }
                else {
                    Util.ga.trackEvent("plugin", "error", "loadLocationAccuracy");
                    msg = $translate.instant("LOC_PLEASE_TURN_ON_LOCATION_SERVICES_TO_FIND_YOUR_CURRENT_LOCATION");
                    deferred.reject(msg);
                }
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
                console.log('city address and location are null');
                deferred.reject();
            } else {
                var startTime = new Date().getTime();

                WeatherUtil.getWeatherByGeoInfo(cityData).then(function (weatherData) {
                    var endTime = new Date().getTime();
                    Util.ga.trackTiming('weather', endTime - startTime, 'get', 'info');
                    Util.ga.trackEvent('weather', 'get', cityData.address || cityData.location +
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

        $scope.$on('setInputFocus', function(event) {
            console.log("set input focus event="+event);

            if (ionic.Platform.isIOS() == false) {
                console.log('set focus on search input');
                setTimeout(function () {
                    document.getElementById('searchInput').focus();
                }, 100);
            }
            else {
                console.log("focus doesn't work on ios");
            }
        });

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
        }).finally(function () {
            init();
        });
    });
