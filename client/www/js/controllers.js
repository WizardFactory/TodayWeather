
angular.module('starter.controllers', [])
    .controller('ForecastCtrl', function ($scope, $rootScope, $ionicPlatform, $ionicScrollDelegate,
                                          $ionicNavBarDelegate, $q, $http, $timeout, WeatherInfo, WeatherUtil, Util,
                                          $stateParams, $location, $ionicHistory, $sce, $ionicLoading) {

        var bodyWidth = window.innerWidth;
        var colWidth;
        var cityData = null;

        $scope.forecastType = "short"; //mid, detail
        var shortenAddress = "";

        //{time: Number, t1h: Number, skyIcon: String, tmn: Number, tmx: Number, summary: String};
        $scope.currentWeather;
        //{day: String, time: Number, t3h: Number, skyIcon: String, pop: Number, tempIcon: String, tempInfo: String, tmn: Number, tmx: Number}
        //$scope.timeTable = [];
        //{week: String, skyIcon:String, pop: Number, humidityIcon: String, reh: Number, tmn: Number, tmx: Number};
        //$scope.dayTable = [];
        //[{name: String, values:[{name: String, value: Number}]}]
        $scope.timeChart;
        //[{values: Object, temp: Number}]
        $scope.dayChart;

        $scope.timeWidth; //total width of timeChart and timeTable
        $scope.dayWidth; //total width of dayChart and dayTable

        var regionSize;
        var regionSumSize;
        var bigDigitSize;
        var bigTempPointSize;
        var bigSkyStateSize;
        var smallTimeSize;
        var smallImageSize;
        var smallDigitSize;

        function init() {
            Util.ga.trackEvent('page', 'tab', 'forecast');

            //identifyUser();
            $ionicHistory.clearHistory();

            var padding = 1;
            var smallPadding = 1;
            console.log("Height:" + window.innerHeight + ", Width:" + window.innerWidth + ", PixelRatio:" + window.devicePixelRatio);
            console.log("OuterHeight:" + window.outerHeight + ", OuterWidth:" + window.outerWidth);

            //iphone 4 480-20(status bar)
            if ((window.innerHeight === 460 || window.innerHeight === 480) && window.innerWidth === 320) {
                padding = 1.125;
                smallPadding = 1.1;
            }
            //iphone 5 568-20(status bar)
            if ((window.innerHeight === 548 || window.innerHeight === 568) && window.innerWidth === 320) {
                smallPadding = 1.1;
            }
            //iphone 6 667-20
            //if ((window.innerHeight === 647 || window.innerHeight === 667) && window.innerWidth === 375) {
            //    padding = 1.0625;
            //}

            var mainHeight = window.innerHeight - 100;

            //var topTimeSize = mainHeight * 0.026;
            //$scope.topTimeSize = topTimeSize<16.8?topTimeSize:16.8;

            regionSize = mainHeight * 0.0408 * padding; //0.051
            regionSize = regionSize<33.04?regionSize:33.04;

            regionSumSize = mainHeight * 0.0376 * padding; //0.047
            regionSumSize = regionSumSize<30.45?regionSumSize:30.45;

            bigDigitSize = mainHeight * 0.17544 * padding; //0.2193
            bigDigitSize = bigDigitSize<142.1?bigDigitSize:142.1;

            bigTempPointSize = mainHeight * 0.03384 * padding; //0.0423
            bigTempPointSize = bigTempPointSize<27.4?bigTempPointSize:27.4;

            bigSkyStateSize = mainHeight * 0.11264 * padding; //0.1408
            bigSkyStateSize = bigSkyStateSize<91.2?bigSkyStateSize:91.2;

            smallTimeSize = mainHeight * 0.0299 * smallPadding;
            smallTimeSize = smallTimeSize<19.37?smallTimeSize:19.37;

            smallImageSize = mainHeight * 0.0512 * smallPadding;
            smallImageSize = smallImageSize<33.17?smallImageSize:33.17;

            smallDigitSize = mainHeight * 0.0320 * smallPadding;
            smallDigitSize = smallDigitSize<20.73?smallDigitSize:20.73;

            if ($stateParams.fav !== undefined && $stateParams.fav < WeatherInfo.getCityCount()) {
                WeatherInfo.setCityIndex($stateParams.fav);
            }
            if (WeatherInfo.getEnabledCityCount() === 0) {
                $scope.showAlert('에러', '도시를 추가해주세요');
                return;
            }

            $ionicLoading.show();
            applyWeatherData();
            loadWeatherData();
        }

        //<p class="textFont" ng-style="::{'font-size':regionSize+'px'}" style="margin: 0">
        //    <a class="icon ion-ios-location-outline" style="color: white;" ng-if="currentPosition"></a>{{address}}</p>
        //<div class="row row-no-padding">
        //    <div style="margin: auto">
        //        <div class="row row-no-padding">
        //            <p ng-style="::{'font-size':bigDigitSize+'px'}" style="margin: 0">{{currentWeather.t1h}}</p>
        //            <div style="text-align: left; margin: auto">
        //                <img ng-if="currentWeather.t1h!==undefined" ng-style="::{'height':bigTempPointSize+'px'}"  ng-src="img/{{::reddot}}.png">
        //                <br>
        //                <img ng-style="::{'height':bigSkyStateSize+'px'}" ng-src="{{::imgPath}}/{{currentWeather.skyIcon}}.png">
        //            </div>
        //        </div>
        //    </div>
        //</div>
        //<p class="textFont" ng-style="::{'font-size':regionSumSize+'px'}" style="margin: 0;">{{currentWeather.summary}}</p>
        function getTopMainBox() {
            var str = '';
            console.log('address='+shortenAddress);
            if (ionic.Platform.isIOS()) {
                str += '<div style="height: 20px"></div>';
            }
            str += '<p class="textFont" style="font-size:'+regionSize+'px; margin: 0">';
            if (cityData.currentPosition) {
                str += '<a class="icon ion-ios-location-outline" style="color: white;"></a>';
            }
            str += shortenAddress+'</p>';
            str += '<div class="row row-no-padding"> <div style="margin: auto"> <div class="row row-no-padding">';
            str +=      '<p style="font-size: '+bigDigitSize+'px; margin: 0">'+cityData.currentWeather.t1h+'</p>';
            str +=      '<div style="text-align: left; margin: auto">';
            str +=          '<img style="height: '+bigTempPointSize+'px" src="img/reddot.png">';
            str +=          '<br>';
            str +=          '<img style="height: '+bigSkyStateSize+'px" src="'+Util.imgPath+'/'+
                                cityData.currentWeather.skyIcon+'.png">';
            str +=      '</div>';
            str += '</div></div></div>';
            str += '<p class="textFont" style="font-size: '+regionSumSize+'px; margin: 0;">'+
                $scope.currentWeather.summary+'</p>';
            return str;
        }
        //<div class="row row-no-padding">
        //                        <div style="width: 26px;"></div>
        //                        <div class="col"
        //                             ng-if="value.date > timeTable[0].date && value.date <= timeTable[timeTable.length-1].date"
        //                             ng-repeat="value in dayTable">
        //                                <p ng-style="::{'font-size':smallTimeSize+'px'}"
        //                                   style="margin: 0; opacity: 0.84">
        //                                    {{getDayText(value)}} <span style="font-size: 13px; opacity: 0.54">{{getDayForecast(value)}}</span>
        //                                </p>
        //                        </div>
        //                        <div style="width: 26px;"></div>
        //                    </div>
        //                    <hr style="margin: 0; border: 0; border-top:1px solid rgba(255,255,255,0.6);">
        //                    <div class="row row-no-padding" style="flex: 1">
        //                        <div class="col table-items" ng-repeat="value in timeTable">
        //                            <p ng-style="::{'font-size':smallTimeSize+'px'}" style="margin: auto">{{value.time}}</p>
        //                            <img ng-style="::{'width':smallImageSize+'px'}" style="margin: auto" ng-src="img/{{value.tempIcon}}.png">
        //                            <p ng-style="::{'font-size':smallDigitSize +'px'}" style="margin: auto">{{value.t3h}}˚</p>
        //                            <img ng-style="::{'width':smallImageSize+'px'}" style="margin: auto" ng-src="{{::imgPath}}/{{value.skyIcon}}.png">
        //                            <p ng-if="value.rn1 === undefined" ng-style="::{'font-size':smallDigitSize +'px'}" style="margin: auto">{{value.pop}}<small>%</small></p>
        //                            <p ng-if="value.rn1 !== undefined" ng-style="::{'font-size':smallDigitSize +'px'}" style="margin: auto">{{value.rn1}}<span
        //                                    style="font-size:10px" ng-if="value.pty !== 3">mm</span><span
        //                                    style="font-size:10px" ng-if="value.pty === 3">cm</span></p>
        //                        </div>
        //                    </div>
        function getShortTable() {
            var i;
            var value;
            var str = '';

            str += '<div class="row row-no-padding"> <div style="width: '+colWidth/2+'px;"></div>';
            for (i=0; i<cityData.dayTable.length; i++) {
                value = cityData.dayTable[i];
                if (value.date > cityData.timeTable[0].date && value.date <= cityData.timeTable[cityData.timeTable.length-1].date) {
                    str += '<div class="col">';
                    str +=   '<p style="font-size: '+smallTimeSize+'px; margin: 0; opacity: 0.84">';
                    str +=       $scope.getDayText(value);
                    str +=       ' <span style="font-size: 13px; opacity: 0.54">';
                    str +=           $scope.getDayForecast(value);
                    str +=       '</span></p></div>';
                }
            }
            str += '<div style="width: '+colWidth/2+'px;"></div> </div>';

            str += '<hr style="margin: 0; border: 0; border-top:1px solid rgba(255,255,255,0.6);">';

            str += '<div class="row row-no-padding" style="flex: 1; text-align: center">';
            for (i=0; i<cityData.timeTable.length; i++) {
                value = cityData.timeTable[i];
                str += '<div class="col table-items">';
                str += '<p style="font-size: '+smallTimeSize+'px; margin:auto">'+value.timeStr+'</p>';
                str += '<img width='+smallImageSize+'px style="margin: auto" src="img/'+value.tempIcon+'.png">';
                str += '<p style="font-size: '+smallDigitSize+'px; margin: auto">'+value.t3h+'˚</p>';
                str += '<img width='+smallImageSize+'px style="margin: auto" src="'+Util.imgPath+'/'+
                        value.skyIcon+'.png">';
                if (value.rn1 != undefined &&
                    (value.date < cityData.currentWeather.date || value.time <= cityData.currentWeather.time))
                {
                    str += '<p style="font-size: '+smallDigitSize+'px; margin: auto">'+value.rn1;
                    str += '<span style="font-size:10px">';
                    if (value.pty === 3) {
                        str += 'cm';
                    }
                    else {
                        str += 'mm';
                    }
                    str += '</span></p>'
                }
                else {
                    str += '<p style="font-size: '+smallDigitSize+'px; margin: auto">'+value.pop+
                            '<small>%</small></p>';
                }
                str += '</div>';
            }
            str += '</div>';
            return str;
        }

        //<hr style="margin: 0; border: 0; border-top:1px solid rgba(255,255,255,0.6);">
        //<div class="row row-no-padding" style="flex: 1">
        //    <div class="col table-items" ng-repeat="value in dayTable">
        //        <p ng-style="::{'font-size':smallTimeSize+'px',
        //                'border-bottom':value.fromToday === 0 ? '1px solid rgba(255,255,255,0.8)':'',
        //                'opacity':value.fromToday===0?'1':'0.84'}" style="margin: auto">{{value.week}}</p>

        //        <img ng-style="::{'width':smallImageSize+'px'}" style="margin: auto;" ng-src="{{::imgPath}}/{{value.skyIcon}}.png">
        //        <p ng-if="value.rn1 === undefined" ng-style="::{'font-size':smallDigitSize+'px'}" style="margin: auto">{{value.pop}}<small>%</small></p>
        //        <p ng-if="value.rn1 !== undefined" ng-style="::{'font-size':smallDigitSize+'px'}" style="margin: auto">
        //            {{value.rn1}}
        //            <span style="font-size:10px" ng-if="value.pty !== 3">mm</span>
        //            <span style="font-size:10px" ng-if="value.pty === 3">cm</span>
        //        </p>
        //        <img ng-style="::{'width':smallImageSize+'px'}" style="margin: auto" ng-src="img/{{value.humidityIcon}}.png">
        //        <p ng-style="::{'font-size':smallDigitSize+'px'}" style="margin: auto">{{value.reh}}<small>%</small></p>
        //    </div>
        //</div>
        function getMidTable() {
            var str = '';
            var i;
            var value;
            var tmpStr = '-';
            str += '<hr style="margin: 0; border: 0; border-top:1px solid rgba(255,255,255,0.6);">';
            str += '<div class="row row-no-padding" style="flex: 1; text-align: center">';
            for (i=0; i<cityData.dayTable.length; i++) {
                value = cityData.dayTable[i];
                str += '<div class="col table-items">';
                str +=  '<p style="margin: auto; font-size: '+smallTimeSize+'px;';
                if (value.fromToday === 0)  {
                    str += ' border-bottom: 1px solid rgba(255,255,255,0.8);';
                    str += ' opacity: 1;">';
                }
                else {
                    str += ' opacity: 0.84;">';
                }
                str +=  value.week + '</p>';
                str += '<img style="width: '+smallImageSize+'px; margin: auto;" src="'+
                            Util.imgPath+'/'+value.skyIcon+'.png">';
                if (value.rn1 != undefined) {
                    str += '<p style="font-size: '+smallDigitSize+'px; margin: auto">'+value.rn1;
                    str += '<span style="font-size:10px">';
                    if (value.pty === 3) {
                       str += 'cm';
                    }
                    else {
                       str += 'mm';
                    }
                    str += '</span></p>';
                }
                else {
                    tmpStr = value.pop == undefined?'-':value.pop+'<small>%</small>';
                    str += '<p style="font-size: '+smallDigitSize+'px; margin: auto">'+tmpStr+'</p>';
                }
                str += '<img style="width: '+smallImageSize+'px; margin: auto" src="img/'+value.humidityIcon+'.png">';
                tmpStr = value.reh == undefined?'-':value.reh+'<small>%</small>';
                str += '<p style="font-size: '+smallDigitSize+'px; margin: auto">'+tmpStr+'</p>';
                str += '</div>';
            }
            str += '</div>';
            return str;
        }

        function applyWeatherData() {
            cityData = WeatherInfo.getCityOfIndex(WeatherInfo.getCityIndex());
            if (cityData === null || cityData.address === null) {
                return;
            }

            $scope.timeWidth = getWidthPerCol() * cityData.timeTable.length;
            $scope.dayWidth = getWidthPerCol() * cityData.dayTable.length;

            shortenAddress = WeatherUtil.getShortenAddress(cityData.address);
            console.log(shortenAddress);
            $scope.currentWeather = cityData.currentWeather;
            //console.log($scope.currentWeather);
            //$scope.timeTable = cityData.timeTable;
            //console.log($scope.timeTable);
            $scope.timeChart = cityData.timeChart;
            //console.log($scope.timeChart);
            //$scope.dayTable = cityData.dayTable;
            //console.log($scope.dayTable);
            $scope.dayChart = cityData.dayChart;
            //console.log($scope.dayChart);

            $scope.currentPosition = cityData.currentPosition;

            // To share weather information for apple watch.
            // AppleWatch.setWeatherData(cityData);

            setTimeout(function () {
                $scope.topMainBox = $sce.trustAsHtml(getTopMainBox());
                $scope.shortTable =  $sce.trustAsHtml(getShortTable());
                $scope.midTable = $sce.trustAsHtml(getMidTable());

                if ($scope.forecastType === 'short') {
                    $ionicScrollDelegate.$getByHandle("timeChart").scrollTo(getTodayPosition(), 0, false);
                }
                else if ($scope.forecastType === 'mid') {
                    $ionicScrollDelegate.$getByHandle("weeklyChart").scrollTo(getTodayPosition(), 0, false);
                }
            }, 100);
        }

        function loadWeatherData() {
            if (WeatherInfo.isLoadComplete === false) {
                return;
            }

            if (cityData.address === null || WeatherInfo.canLoadCity(WeatherInfo.getCityIndex()) === true) {
                $ionicLoading.show();

                updateWeatherData().finally(function () {
                    shortenAddress = WeatherUtil.getShortenAddress(cityData.address);
                    $ionicLoading.hide();
                    Util.ga.trackEvent('weather', 'load', shortenAddress, WeatherInfo.getCityIndex());
                });
                return;
            }

            $ionicLoading.hide();
            Util.ga.trackEvent('weather', 'load', shortenAddress, WeatherInfo.getCityIndex());
        }

        function updateWeatherData() {
            var deferred = $q.defer();

            if (cityData.currentPosition === true) {
                WeatherUtil.getCurrentPosition().then(function (coords) {
                    WeatherUtil.getAddressFromGeolocation(coords.latitude, coords.longitude).then(function (address) {
                        WeatherUtil.getWeatherInfo(address, WeatherInfo.towns).then(function (weatherDatas) {
                            var city = WeatherUtil.convertWeatherData(weatherDatas);
                            city.address = address;
                            city.location = {"lat": coords.latitude, "long": coords.longitude};
                            WeatherInfo.updateCity(WeatherInfo.getCityIndex(), city);
                            applyWeatherData();
                            deferred.resolve();
                        }, function () {
                            var msg = "현재 위치 정보 업데이트를 실패하였습니다.";
                            $scope.showAlert("에러", msg);
                            deferred.reject();
                        });
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
            } else {
                WeatherUtil.getWeatherInfo(cityData.address, WeatherInfo.towns).then(function (weatherDatas) {
                    var city = WeatherUtil.convertWeatherData(weatherDatas);
                    WeatherInfo.updateCity(WeatherInfo.getCityIndex(), city);
                    applyWeatherData();
                    deferred.resolve();
                }, function () {
                    var msg = "위치 정보 업데이트를 실패하였습니다.";
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
            colWidth = bodyWidth/7;
            if (colWidth > 60) {
                colWidth = 60;
            }
            return colWidth;
        }

        function getTodayPosition() {
            var time = new Date();
            var index = 0;

            if ($scope.forecastType === 'short') {
                var hours = time.getHours();
                index = 7; //yesterday 21h

                //large tablet
                if (bodyWidth >= 720) {
                    return getWidthPerCol()*index;
                }

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

                return getWidthPerCol()*index;
            }
            else if ($scope.forecastType === 'mid') {

                //large tablet
                if (bodyWidth >= 720) {
                    return 0;
                }

                // Sunday is 0
                var day = time.getDay();
                var dayPadding = 1;

                //monday는 토요일부터 표시
                if (day === 1) {
                    index = 5;
                }
                else {

                    //sunday는 monday까지 보이게
                    if (day === 0) {
                        day = 7;
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

        $scope.onSwipeLeft = function() {
            if (WeatherInfo.getEnabledCityCount() === 1) {
                return;
            }

            WeatherInfo.setNextCityIndex();
            applyWeatherData();
            loadWeatherData();
        };

        $scope.onSwipeRight = function() {
            if (WeatherInfo.getEnabledCityCount() === 1) {
                return;
            }

            WeatherInfo.setPrevCityIndex();
            applyWeatherData();
            loadWeatherData();
        };

        $scope.getDayText = function (value) {
            return value.fromTodayStr + ' ' + value.date.substr(4,2) + '.' + value.date.substr(6,2);
        };

        $scope.getDayForecast = function (value) {
            var str = [];
            if (value.fromToday === 0 || value.fromToday === 1) {
                if (value.dustForecast && value.dustForecast.PM10Str) {
                   str.push('미세예보:'+value.dustForecast.PM10Str);
                }

                if (value.ultrvStr) {
                    str.push('자외선:'+value.ultrvStr);
                }
                return str.toString();
            }

            return str.toString();
        };

        $scope.$on('loadCompleteEvent', function(event) {
            console.log('called by load complete event');
            loadWeatherData();
        });

        $scope.$on('reloadEvent', function(event) {
            console.log('called by update weather event');
            WeatherInfo.reloadCity(WeatherInfo.getCityIndex());
            loadWeatherData();
        });

        init();
    })

    .controller('SearchCtrl', function ($scope, $rootScope, $ionicPlatform, $ionicScrollDelegate,
                                        $location, WeatherInfo, WeatherUtil, Util, ionicTimePicker, Push, $ionicLoading) {
        $scope.searchWord = undefined;
        $scope.searchResults = [];
        $scope.cityList = [];
        $scope.imgPath = Util.imgPath;
        $scope.isEditing = false;

        var towns = WeatherInfo.towns;
        var searchIndex = -1;

        var service = new google.maps.places.AutocompleteService();
        var callback = function(predictions, status) {
            if (status != google.maps.places.PlacesServiceStatus.OK) {
                return;
            }

            predictions.forEach(function(prediction) {
                if (prediction.types.indexOf('sublocality_level_4') < 0) { // 도로명 주소 제외. 영어 검색 제외 안됨
                    var addressArray = WeatherUtil.convertAddressArray(prediction.description);
                    var townAddress = WeatherUtil.getTownFromFullAddress(addressArray);
                    if (townAddress.first !== "" || townAddress.second !== "" || townAddress.third !== "") {
                        $scope.searchResults.push(townAddress);
                    }
                }
            });
        };

        function init() {
            Util.ga.trackEvent('page', 'tab', 'search');

            for (var i = 0; i < WeatherInfo.getCityCount(); i += 1) {
                var city = WeatherInfo.getCityOfIndex(i);
                var address = WeatherUtil.getShortenAddress(city.address).split(",");
                var todayData = null;

                if (city.currentPosition && city.address === null) {
                    address = ['현재', '위치'];
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
                if (city.dayTable != null) {
                    todayData = city.dayTable.filter(function (data) {
                        return (data.fromToday === 0);
                    });
                }
                if (!todayData || todayData.length === 0) {
                    todayData = [{tmn:'-', tmx:'-'}];
                }

                var data = {
                    address: address,
                    currentPosition: city.currentPosition,
                    disable: city.disable,
                    skyIcon: city.currentWeather.skyIcon,
                    t1h: city.currentWeather.t1h,
                    tmn: todayData[0].tmn,
                    tmx: todayData[0].tmx,
                    alarmInfo: Push.getAlarm(i)
                };
                $scope.cityList.push(data);
            }
        }

        $scope.OnChangeSearchWord = function() {
            $scope.isEditing = false;

            if ($scope.searchWord === "") {
                $scope.searchWord = undefined;
                $scope.searchResults = [];
                return;
            }

            $scope.searchResults = [];
            $ionicScrollDelegate.$getByHandle('cityList').scrollTop();
            searchIndex = 0;
            $scope.OnScrollResults();
            service.getPlacePredictions(
                {
                    input: $scope.searchWord,
                    types: ['(regions)'],
                    componentRestrictions: {}
                }, callback);
        };

        $scope.OnSearchCurrentPosition = function() {
            $scope.isEditing = false;

            $ionicLoading.show();

            WeatherUtil.getCurrentPosition().then(function (coords) {
                WeatherUtil.getAddressFromGeolocation(coords.latitude, coords.longitude).then(function (address) {
                    var addressArray = WeatherUtil.convertAddressArray(address);
                    var townAddress = WeatherUtil.getTownFromFullAddress(addressArray);
                    if (townAddress.first === "" && townAddress.second === "" && townAddress.third === "") {
                        var msg = "현재 위치에 대한 정보를 찾을 수 없습니다.";
                        $scope.showAlert("에러", msg);
                    } else {
                        if (townAddress.third === "") {
                            if (townAddress.second === "") {
                                $scope.searchWord = townAddress.first;
                            } else {
                                $scope.searchWord = townAddress.second;
                            }
                        } else {
                            $scope.searchWord = townAddress.third;
                        }
                        $scope.searchResults = [];
                        $scope.searchResults.push(townAddress);
                        $ionicScrollDelegate.$getByHandle('cityList').scrollTop();
                        searchIndex = -1;
                    }
                    $ionicLoading.hide();
                }, function () {
                    var msg = "현재 위치에 대한 정보를 찾을 수 없습니다.";
                    $scope.showAlert("에러", msg);
                    $ionicLoading.hide();
                });
            }, function () {
                var msg = "현재 위치를 찾을 수 없습니다.";
                if (ionic.Platform.isAndroid()) {
                    msg += "<br>WIFI와 위치정보를 켜주세요.";
                }
                $scope.showAlert("에러", msg);
                $ionicLoading.hide();
            });
        };

        $scope.OnEdit = function() {
            $scope.isEditing = !$scope.isEditing;
            if ($scope.isEditing) {
                $scope.searchWord = undefined;
                $scope.searchResults = [];
            }
        };

        $scope.OnScrollResults = function() {
            //if ($scope.searchWord !== undefined && searchIndex !== -1) {
            //    for (var i = searchIndex; i < towns.length; i++) {
            //        var town = towns[i];
            //        if (town.first.indexOf($scope.searchWord) >= 0 || town.second.indexOf($scope.searchWord) >= 0
            //            || town.third.indexOf($scope.searchWord) >= 0) {
            //            $scope.searchResults.push(town);
            //            if ($scope.searchResults.length % 10 === 0) {
            //                searchIndex = i + 1;
            //                return;
            //            }
            //        }
            //    }
            //    searchIndex = -1;
            //}
        };

        $scope.OnSelectResult = function(result) {
            if (window.cordova && window.cordova.plugins && window.cordova.plugins.Keyboard) { 
                if (cordova.plugins.Keyboard.isVisible) {
                    return cordova.plugins.Keyboard.close(); 
                }
            }

            $scope.searchWord = undefined;
            $scope.searchResults = [];
            $ionicLoading.show();

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
                $ionicLoading.hide();
            }, function () {
                var msg = "현재 위치 정보 업데이트를 실패하였습니다.";
                $scope.showAlert("에러", msg);
                $ionicLoading.hide();
            });
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
            WeatherInfo.disableCity($scope.cityList[0].disable);

            return false; //OnDisableCity가 호출되지 않도록 이벤트 막음
        };

        $scope.OnDeleteCity = function(index) {
            if ($scope.cityList[index].alarmInfo != undefined) {
                Push.removeAlarm($scope.cityList[index].alarmInfo);
            }
            $scope.cityList.splice(index, 1);
            WeatherInfo.removeCity(index);

            return false; //OnSelectCity가 호출되지 않도록 이벤트 막음
        };

        $scope.OnOpenTimePicker = function (index) {
            var ipObj1 = {
                callback: function (val) {      //Mandatory
                    if (typeof(val) === 'undefined') {
                        console.log('closed');
                    } else if (val == 0) {
                        console.log('cityIndex='+index+' alarm canceled');
                        if ($scope.cityList[index].alarmInfo != undefined) {
                            Push.removeAlarm($scope.cityList[index].alarmInfo);
                            $scope.cityList[index].alarmInfo = undefined;
                        }
                    } else {
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

            ionicTimePicker.openTimePicker(ipObj1);
        };

        init();
    })

    .controller('SettingCtrl', function($scope, $http, $cordovaInAppBrowser, Util) {
        $scope.version = Util.version;

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

        $scope.openInfo = function() {
            var msg = "기상정보 : 기상청 <br> 대기오염정보 : 환경부/한국환경공단 <br> 인증되지 않은 실시간 자료이므로 자료 오류가 있을 수 있습니다.";
            $scope.showAlert("TodayWeather", msg);
        };

        init();
    })

    .controller('TabCtrl', function($scope, $ionicPlatform, $ionicPopup, $interval, WeatherInfo, WeatherUtil,
                                     $location, $cordovaSocialSharing, TwAds, $rootScope, Util) {
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
            if (WeatherInfo.getEnabledCityCount() === 0) {
                $scope.showAlert('에러', '도시를 추가해주세요');
                return;
            }
            if ($location.path() === '/tab/forecast') {
                $scope.$broadcast('reloadEvent');

                Util.ga.trackEvent('page', 'tab', 'reload');
            }
            else {
                $location.path('/tab/forecast');
            }
        };

        $scope.doTabShare = function() {
            var message = '';

            if ($location.path() === '/tab/forecast') {
                var cityData = WeatherInfo.getCityOfIndex(WeatherInfo.getCityIndex());
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
            $rootScope.viewAdsBanner = TwAds.enableAds;
            $rootScope.contentBottom = TwAds.enableAds? 100 : 50;
            angular.element(document.getElementsByClassName('tabs')).css('margin-bottom', TwAds.showAds?'50px':'0px');
        });

        init();
    })

    .controller('GuideCtrl', function($scope, $rootScope, $ionicSlideBoxDelegate, $ionicNavBarDelegate,
                                      $location, $ionicHistory, Util, TwAds, $ionicPopup, WeatherInfo) {
        var guideVersion = null;

        $scope.data = { 'autoSearch': false };

        function init() {
            //for fast close ads when first loading
            TwAds.setShowAds(false);
            Util.ga.trackEvent('page', 'tab', 'guide');

            $scope.bigFont = (window.innerHeight - 56) * 0.0512;
            $scope.smallFont = (window.innerHeight - 56) * 0.0299;

            guideVersion = localStorage.getItem("guideVersion");

            update();
        }

        function close() {
            if (guideVersion === null) {
                showPopup();
            } else {
                if (Util.guideVersion == Number(guideVersion)) {
                    TwAds.setShowAds(true);
                    $location.path('/tab/setting');
                } else {
                    localStorage.setItem("guideVersion", Util.guideVersion.toString());
                    TwAds.setShowAds(true);
                    $location.path('/tab/forecast');
                }
            }
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

        function showPopup() {
            var popup = $ionicPopup.show({
                template: '<ion-list>' +
                    '<ion-radio ng-model="data.autoSearch" ng-value="true">현 위치 자동 검색</ion-radio>' +
                    '<ion-radio ng-model="data.autoSearch" ng-value="false">직접 도시 검색</ion-radio>' +
                    '</ion-list>',
                title: '도시 검색 방법을 선택하세요.',
                scope: $scope,
                cssClass: 'ionic_popup',
                buttons: [
                    {
                        text: '취소',
                        type: 'button_cancel'
                    },
                    {
                        text: '확인',
                        type: 'button_close',
                        onTap: function() {
                            return $scope.data.autoSearch;
                        }
                    }
                ]
            });

            popup.then(function(res) {
                if (res === undefined) { // cancel button
                    return;
                }

                localStorage.setItem("guideVersion", Util.guideVersion.toString());
                TwAds.setShowAds(true);
                if (res === true) { // autoSearch
                    WeatherInfo.disableCity(false);
                    $location.path('/tab/forecast');
                } else {
                    $location.path('/tab/search');
                }
            });
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

        $scope.$on('$ionicView.leave', function() {
            TwAds.setShowAds(true);
        });

        $scope.$on('$ionicView.enter', function() {
            TwAds.setShowAds(false);
            $ionicSlideBoxDelegate.slide(0);
        });

        init();
    });

