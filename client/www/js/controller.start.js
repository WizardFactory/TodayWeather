/**
 * Created by aleckim on 2017. 4. 3..
 */

var start = angular.module('controller.start', []);

start.controller('StartCtrl', function($scope, $rootScope, $location, TwAds, Purchase, $ocLazyLoad, Util, $ionicLoading,
                                       $q, WeatherUtil, WeatherInfo, $translate, $ionicPopup, TwStorage) {
    var strError = "Error";
    var strAddLocation = "Add locations";
    var strOkay = "OK";
    var strCancel = "Cancel";
    $translate(['LOC_ERROR', 'LOC_ADD_LOCATIONS', 'LOC_OK', 'LOC_CANCEL']).then(function (translations) {
        strError = translations.LOC_ERROR;
        strAddLocation = translations.LOC_ADD_LOCATIONS;
        strOkay = translations.LOC_OK;
        strCancel = translations.LOC_CANCEL;
    }, function (translationIds) {
        console.log("Fail to translate : "+JSON.stringify(translationIds));
    });

    var strFailToGetAddressInfo = "Fail to get location information";
    var strFailToGetCurrentPosition = "Fail to find your current location";
    var strFailToGetWeatherInfo = "Fail to get weather info.";
    var strPleaseTurnOnLocationWiFi = "Please turn on location and Wi-FI";
    var strAlreadyTheSameLocationHasBeenAdded = "Already the same location has been added.";
    var strCurrent = "Current";
    var strLocation = "Location";

    $translate(['LOC_FAIL_TO_GET_LOCATION_INFORMATION', 'LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION',
        'LOC_FAIL_TO_GET_WEATHER_INFO', 'LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI',
        'LOC_ALREADY_THE_SAME_LOCATION_HAS_BEEN_ADDED', 'LOC_CURRENT', 'LOC_LOCATION']).then(function (translations) {
        strFailToGetAddressInfo = translations.LOC_FAIL_TO_GET_LOCATION_INFORMATION;
        strFailToGetCurrentPosition = translations.LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION;
        strFailToGetWeatherInfo = translations.LOC_FAIL_TO_GET_WEATHER_INFO;
        strPleaseTurnOnLocationWiFi = translations.LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI;
        strAlreadyTheSameLocationHasBeenAdded = translations.LOC_ALREADY_THE_SAME_LOCATION_HAS_BEEN_ADDED;
        strCurrent = translations.LOC_CURRENT;
        strLocation = translations.LOC_LOCATION;
    }, function (translationIds) {
        console.log("Fail to translate : " + JSON.stringify(translationIds));
    });

    var service;

    if (window.google == undefined) {
        $ocLazyLoad.load(Util.placesUrl).then(function () {
            console.log('googleapis loaded');
            service = new google.maps.places.AutocompleteService();
        }, function (e) {
            Util.ga.trackEvent('window', 'error', 'lazyLoad');
            Util.ga.trackException(e, true);
            //window.alert(e);
        });
    }
    else {
        service = new google.maps.places.AutocompleteService();
    }

    //var searchIndex = -1;

    $scope.search = {};
    $scope.searchResults2 = [];

    function _setShowAds(show) {
        if (show == true && Purchase.accountLevel == Purchase.ACCOUNT_LEVEL_FREE) {
            TwAds.setShowAds(true);
        }
        else if (show == false) {
            TwAds.setShowAds(false);
        }
    }

    var callbackAutocomplete = function(predictions, status) {
        if (google == undefined) {
            Util.ga.trackEvent('address', 'error', 'autoCompleteGoogleUndefined');
            return;
        }
        if (status != google.maps.places.PlacesServiceStatus.OK) {
            if (status != google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
                Util.ga.trackEvent('address', 'error', 'PlacesServiceStatus=' + status);
            }
            return;
        }
        else {
            console.log("predictions="+predictions.length);
            Util.ga.trackEvent('address', 'predictions', $scope.search.word, predictions.length);
        }

        $scope.$apply(function () {
            $scope.searchResults2 = predictions;
        });
    };

    $scope.OnChangeSearchWord = function() {
        if ($scope.search.word === "") {
            $scope.search.word = undefined;
            $scope.searchResults2 = [];
            return;
        }

        //searchIndex = 0;
        //$scope.OnScrollResults();

        if ($scope.search.word == undefined) {
            console.error("search.word is undefined");
            return;
        }

        console.log($scope.search.word);

        if (!(service == undefined)) {
            service.getPlacePredictions({
                input: $scope.search.word,
                types: ['(regions)'],
                componentRestrictions: {}
            }, callbackAutocomplete);
        }
        else {
            Util.ga.trackEvent('address', 'warn', 'ServiceNotReady');
        }
    };

    $scope.OnCancel = function() {
        $scope.search.word = undefined;
        $scope.searchResults2 = [];
    };

    function close() {
        TwStorage.set("startVersion", Util.startVersion);
        _setShowAds(true);
        WeatherInfo.setCityIndex(WeatherInfo.getCityCount() - 1);

        if (clientConfig.package === 'todayWeather') {
            $location.path('/tab/forecast');
        }
        else if (clientConfig.package === 'todayAir') {
            $location.path('/tab/air');
        }
        else {
            console.error('unknown package='+clientConfig.package);
        }
    }

    function _makeFavoriteList() {
        var favoriteList1 = [
            {name: "서울", country: "KR", address: "대한민국 서울특별시", location: {lat: 37.567, long: 126.978}},
            {name: "New York", country: "US", address: "New York, NY, United States", location: {lat: 43.299, long: -74.218}},
            {name: "東京", country: "JP", address: "日本 東京", location: {lat: 35.709, long: 139.732}},
            {name: "Berlin", country: "DE", address: "Berlin, Deutschland", location: {lat: 52.520, long: 13.405}},
            {name: "北京", country: "CN", address: "中国北京市", location: {lat: 39.904, long: 116.407}}, //beijing
            {name: "臺北市", country: "TW", address: "台灣臺北市", location: {lat: 25.033, long: 121.565}}, //taiwan
        ];

        var favoriteList2 = [
            {name: "दिल्ली", country: "IN", address: "दिल्ली, भारत", location: {lat: 28.704, long: 77.102}}, //delhi
            {name: "Hồ Chí Minh", country: "VN", address: "Hồ Chí Minh, Việt Nam", location: {lat: 10.823, long: 106.630}},
            {name: "Москва", country: "RU", address: "Москва, Россия", location: {lat: 55.756, long: 37.617}},
            {name: "Roma", country: "IT", address: "Roma, Italia", location: {lat: 41.903, long: 12.496}},
            {name: "İstanbul", country: "TR", address: "İstanbul, Türkiye", location: {lat: 41.008, long: 28.978}},
        ];

        var favoriteList3 = [
            {name: "香港", country: "HK", address: "香港香港島", location: {lat: 22.259, long: 114.191}}, //hongkong
            {name: "São Paulo", country: "BR", address: "São Paulo, Brasil", location: {lat: -23.551, long: -46.633}},
            {name: "กรุงเทพมหานคร", country: "TH", address: "กรุงเทพมหานคร ประเทศไทย", location: {lat: 13.756, long: 100.502}}, //bangkok
            {name: "Madrid", country: "ES", address: "Madrid, España", location: {lat: 40.417, long: -3.704}},
            {name: "Warszawa", country: "PL", address: "Warszawa, Polska", location: {lat: 52.230, long: 21.012}},
            {name: "كراچى", country: "PK", address: "کراچی, سندھ, پاکستان", location: {lat: 24.861, long: 67.010}}, //Karachi
        ];

        var favoriteList4 = [
            {name: "وهران", country: "DZ", address: "وهران‎, الجزائر", location: {lat: 35.698, long: -0.634}}, //Oran
            {name: "Sydney", country: "AU", address: "Sydney, New South Wales, Australia", location: {lat: -33.869, long: 151.209}},
            {name: "London", country: "GB", address: "London, United Kingdom", location: {lat: 51.507, long: -0.128}},
            {name: "Paris", country: "FR", address: "Paris, France", location: {lat: 48.857, long: 2.352}},
            {name: "Kinshasa", country: "CG", address: "Kinshasa, République démocratique du Congo", location: {lat: -4.441, long: 15.266}},
            {name: "القاهرة", country: "EG", address: "القاهرة, مصر", location: {lat: 30.044, long: 31.236}}, //kario
            {name: "Jakarta", country: "ID", address: "Jakarta, DKI Jakarta, Indonesia", location: {lat: -6.209, long: 106.846}},
            {name: "Ciudad de México", country: "MX", address: "Ciudad de México, México", location: {lat: 19.432, long: -99.133}},
            {name: "تهران", country: "IR", address: "تهران, استان تهران, ایران", location: {lat: 35.689, long: 51.389}},  // Teheran
        ];

        var bodyHeight = window.screen.height;

        $scope.favoriteCityList = favoriteList1;
        //iphone5
        if (bodyHeight >= 568) {
            $scope.favoriteCityList = $scope.favoriteCityList.concat(favoriteList2);
        }
        //note5
        if (bodyHeight >= 731) {
            $scope.favoriteCityList = $scope.favoriteCityList.concat(favoriteList3);
        }
        //tablet
        if (bodyHeight >= 960) {
            $scope.favoriteCityList = $scope.favoriteCityList.concat(favoriteList4);
        }
    }

    function init() {
        _setShowAds(false);
        _makeFavoriteList();

        if (clientConfig.package === 'todayWeather') {
            $scope.imgAppIcon = 'img/app_icon.png';
        }
        else if (clientConfig.package === 'todayAir') {
            $scope.imgAppIcon = 'img/ta_app_icon.png';
        }
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
        //$scope.searchResults = [];
        $scope.searchResults2 = [];

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
                    close();
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

            WeatherUtil.getGeoInfoByAddr(result.description)
                .then(function (geoInfo) {
                    geoInfo.name = result.name;
                    WeatherUtil.getWeatherByGeoInfo(geoInfo).then(function (weatherData) {
                        if (saveCity(weatherData, geoInfo) == false) {
                            Util.ga.trackEvent('city', 'add error', result.description, WeatherInfo.getCityCount() - 1);
                            $rootScope.showAlert(strError, strAlreadyTheSameLocationHasBeenAdded);
                        }
                        else {
                            Util.ga.trackEvent('city', 'add', result.description, WeatherInfo.getCityCount() - 1);
                            close();
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
                    close();
                }
            }, function (err) {
                Util.ga.trackEvent('weather', 'error', err);
                $rootScope.showAlert(strError, strFailToGetWeatherInfo);
            }).finally(function () {
                $ionicLoading.hide();
            });
        }
    };

    var isLoadingIndicator = false;

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
                    $scope.setLocationAuthorizationStatus(Util.locationStatus);
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
            if (isLocationAuthorized === true) {
                if (window.cordova && cordova.plugins.locationAccuracy) {
                    cordova.plugins.locationAccuracy.request(
                        function (success) {
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
            else if (isLocationAuthorized === false) {
                msg = $translate.instant("LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED");
                deferred.reject(msg);
            }
            else if (isLocationAuthorized === undefined) {
                if (window.cordova && window.cordova.plugins && window.cordova.plugins.diagnostic) {
                    // ios : 앱을 사용하는 동안 '오늘날씨'에서 사용자의 위치에 접근하도록 허용하겠습니까?
                    // android : 오늘날씨의 다음 작업을 허용하시겠습니까? 이 기기의 위치에 액세스하기

                    cordova.plugins.diagnostic.getLocationAuthorizationStatus(function(status){
                        switch(status){
                            case cordova.plugins.diagnostic.permissionStatus.DENIED:
                                console.log("Permission denied");
                                $scope.setLocationAuthorizationStatus(status);
                                msg = $translate.instant("LOC_ACCESS_TO_LOCATION_SERVICES_HAS_BEEN_DENIED");
                                deferred.reject(msg);
                                break;
                            case cordova.plugins.diagnostic.permissionStatus.GRANTED:
                                console.error("Permission granted always");
                                break;
                            case cordova.plugins.diagnostic.permissionStatus.GRANTED_WHEN_IN_USE:
                                console.error("Permission granted only when in use");
                                break;
                            case cordova.plugins.diagnostic.permissionStatus.NOT_REQUESTED:
                                console.log("Permission not requested");
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
                                break;
                        }
                    }, function(error){
                        console.error("The following error occurred: "+error);
                    });
                }
                else {
                    deferred.reject(null);
                }
            }
        }
    }

    function saveCity(weatherData, geoInfo, currentPosition) {
        var city = WeatherUtil.convertWeatherData(weatherData);
        if (city == undefined) {
            console.error("Fail to convert weather data");
            return false;
        }
        city.name = geoInfo.name;
        city.address = geoInfo.address;
        city.location = geoInfo.location;
        city.country = geoInfo.country;
        if (currentPosition) {
            city.currentPosition = true;
            WeatherInfo.updateCity(WeatherInfo.getCityIndex(), city);
            Util.ga.trackEvent('city', 'add', geoInfo.address, WeatherInfo.getCityCount() - 1);
            return true;
        }
        else {
            city.currentPosition = false;
            if (WeatherInfo.addCity(city) === false) {
                Util.ga.trackEvent('city error', 'add', geoInfo.address, WeatherInfo.getCityCount() - 1);
                return false;
            }
            else {
                Util.ga.trackEvent('city', 'add', geoInfo.address, WeatherInfo.getCityCount() - 1);
                return true;
            }
        }
        return false;
    }

    $scope.OnGetWeather = function (index) {
        Util.ga.trackEvent('action', 'click', 'OnGetWeather', index);
        $ionicLoading.show();
        var geoInfo = $scope.favoriteCityList[index];
        WeatherUtil.getWeatherByGeoInfo(geoInfo).then(function (weatherData) {

            if (saveCity(weatherData, geoInfo) == false) {
                $rootScope.showAlert(strError, strAlreadyTheSameLocationHasBeenAdded);
            }
            else {
                close();
            }
            $ionicLoading.hide();
        }, function (err) {
            Util.ga.trackEvent('weather', 'error', err);
            $rootScope.showAlert(strError, strFailToGetWeatherInfo);
            $ionicLoading.hide();
        });
    };

    function _onUseLocationService() {
        showLoadingIndicator();

        updateCurrentPosition().then(function(geoInfo) {

            WeatherUtil.getWeatherByGeoInfo(geoInfo).then(function (weatherData) {

                WeatherInfo.disableCity(false);
                if (saveCity(weatherData, geoInfo, true) == false) {
                    WeatherInfo.disableCity(true);
                    $rootScope.showAlert(strError, strAlreadyTheSameLocationHasBeenAdded);
                }
                else {
                    close();
                }
                $ionicLoading.hide();
            }, function (err) {
                Util.ga.trackEvent('weather', 'error', err);
                $rootScope.showAlert(strError, strFailToGetWeatherInfo);
                $ionicLoading.hide();
            });
        }, function(msg) {
            hideLoadingIndicator();
            if (msg !== null) {
                $scope.showRetryConfirm(strError, msg, 'useLocationService');
            }
            else {
                $scope.$broadcast('useLocationService');
            }
        });
    }

    $scope.$on('useLocationService', function(event) {
        _onUseLocationService();
    });

    $scope.OnUseLocationService = function() {
        Util.ga.trackEvent('action', 'click', 'OnUseLocationService');
        _onUseLocationService();
    };

    var gLocationAuthorizationStatus;
    $scope.setLocationAuthorizationStatus = function (status) {
        gLocationAuthorizationStatus = status;
    };

    var confirmPopup;
    $scope.getConfirmPopup = function () {
        return confirmPopup;
    };

    /**
     * android 6.0이상에서 처음 현재위치 사용시에, android 현재위치 접근에 대한 popup때문에 앱 pause->resume이 됨.
     * 그래서 init와 reloadevent가 둘다 오게 되는데 retry confirm이 두개 뜨지 않게 한개 있는 경우 닫았다가 새롭게 열게 함.
     * @param title
     * @param template
     * @param callback
     */
    $scope.showRetryConfirm = function fShowRetryConfirm(title, template, ctrl) {
        if (confirmPopup) {
            confirmPopup.close();
        }

        var strClose;
        var strSearch;
        var strSetting;
        var strOpensTheAppInfoPage;

        $translate(['LOC_CLOSE', 'LOC_SEARCH', 'LOC_SETTING',
            'LOC_OPENS_THE_APP_INFO_PAGE']).then(function (translations) {
            strClose = translations.LOC_CLOSE;
            strSearch = translations.LOC_SEARCH;
            strSetting = translations.LOC_SETTING;
            strOpensTheAppInfoPage = translations.LOC_OPENS_THE_APP_INFO_PAGE;
        }, function (translationIds) {
            console.log("Fail to translate : " + JSON.stringify(translationIds));
            Util.ga.trackEvent("translate", "error", "ShowRetryConfirm");
        }).finally(function () {
            var buttons = [];
            buttons.push({
                text: strClose,
                onTap: function () {
                    return 'close';
                }
            });

            if (gLocationAuthorizationStatus == cordova.plugins.diagnostic.permissionStatus.DENIED_ALWAYS) {
                template += '<br>';
                template += strOpensTheAppInfoPage;

                buttons.push({
                    text: strSetting,
                    type: 'button-positive',
                    onTap: function () {
                        return 'settings';
                    }
                });
                Util.ga.trackEvent('window', 'show', 'deniedAlwaysPopup');
            }
            else if (gLocationAuthorizationStatus == cordova.plugins.diagnostic.permissionStatus.DENIED) {
                buttons.push({
                    text: strSetting,
                    type: 'button-positive',
                    onTap: function () {
                        return 'settings';
                    }
                });

                Util.ga.trackEvent('window', 'show', 'deniedPopup');
            }
            else if (Util.isLocationEnabled() == false) {
                if (ionic.Platform.isAndroid()) {
                    buttons.push({
                        text: strSetting,
                        onTap: function () {
                            return 'locationSettings';
                        }
                    });
                }
                else if (ionic.Platform.isIOS()) {
                    buttons.push({
                        text: strSetting,
                        type: 'button-positive',
                        onTap: function () {
                            return 'settings';
                        }
                    });

                }

                Util.ga.trackEvent('window', 'show', 'locationDisabledPopup');
            }
            else {
                Util.ga.trackEvent('window', 'show', 'retryPopup');
            }

            buttons.push({
                text: strOkay,
                type: 'button-positive',
                onTap: function () {
                    return 'retry';
                }
            });

            confirmPopup = $ionicPopup.show({
                title: title,
                template: template,
                buttons: buttons
            });

            confirmPopup
                .then(function (res) {
                    if (res == 'retry') {
                        Util.ga.trackEvent('action', 'click', 'reloadEvent');
                        setTimeout(function () {
                            if (ctrl == 'search') {
                                $scope.$broadcast('searchCurrentPositionEvent');
                            }
                            else {
                                $scope.$broadcast('useLocationService');
                            }
                        }, 0);
                    }
                    else if (res == 'settings') {
                        //for get app permission
                        Util.ga.trackEvent('action', 'click', 'settings');
                        setTimeout(function () {
                            cordova.plugins.diagnostic.switchToSettings(function () {
                                console.log("Successfully switched to Settings app");
                            }, function (error) {
                                console.log("The following error occurred: " + error);
                            });
                        }, 0);
                    }
                    else if (res == 'locationSettings') {
                        //to turn on location service
                        setTimeout(function () {
                            cordova.plugins.diagnostic.switchToLocationSettings();
                        }, 0);
                    }
                    else {
                        Util.ga.trackEvent('action', 'click', 'close');
                    }
                })
                .finally(function () {
                    console.log('called finally');
                    confirmPopup = undefined;
                });
        });
    };

    init();
});

