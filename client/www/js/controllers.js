
angular.module('starter.controllers', [])
    .controller('ForecastCtrl', function ($scope, $rootScope, $ionicPlatform, $ionicScrollDelegate,
                                          $ionicNavBarDelegate, $q, $http, $timeout, WeatherInfo, WeatherUtil, Util,
                                          Purchase, $stateParams, $location, $ionicHistory, $sce, $ionicLoading,
                                          $ionicPopup, $translate) {
        var TABLET_WIDTH = 720;
        var ASPECT_RATIO_16_9 = 1.7;
        var bodyWidth;
        var bodyHeight;
        var colWidth;
        var cityData = null;

        $scope.showDetailWeather = false;
        if ($location.path() === '/tab/dailyforecast') {
            $scope.forecastType = "mid"; //mid, detail(aqi)
        }
        else {
            $scope.forecastType = "short"; //mid, detail(aqi)
        }

        var shortenAddress = "";

        $scope.imgPath = Util.imgPath;

        var dayStr = [];
        $translate(['LOC_SUN', 'LOC_MON', 'LOC_TUE', 'LOC_WED', 'LOC_THU', 'LOC_FRI', 'LOC_SAT']).then(function (translations) {
            dayStr.push(translations.LOC_SUN);
            dayStr.push(translations.LOC_MON);
            dayStr.push(translations.LOC_TUE);
            dayStr.push(translations.LOC_WED);
            dayStr.push(translations.LOC_THU);
            dayStr.push(translations.LOC_FRI);
            dayStr.push(translations.LOC_SAT);
        }, function (translationIds) {
            dayStr.push(translationIds.LOC_SUN);
            dayStr.push(translationIds.LOC_MON);
            dayStr.push(translationIds.LOC_TUE);
            dayStr.push(translationIds.LOC_WED);
            dayStr.push(translationIds.LOC_THU);
            dayStr.push(translationIds.LOC_FRI);
            dayStr.push(translationIds.LOC_SAT);
        });

        $scope.dayToString = function(day) {
            return dayStr[day];
        };

        var dayFullStr = [];
        $translate(['LOC_SUNDAY', 'LOC_MONDAY', 'LOC_TUESDAY', 'LOC_WEDNESDAY', 'LOC_THURSDAY', 'LOC_FRIDAY', 'LOC_SATURDAY']).then(function (translations) {
            dayFullStr.push(translations.LOC_SUNDAY);
            dayFullStr.push(translations.LOC_MONDAY);
            dayFullStr.push(translations.LOC_TUESDAY);
            dayFullStr.push(translations.LOC_WEDNESDAY);
            dayFullStr.push(translations.LOC_THURSDAY);
            dayFullStr.push(translations.LOC_FRIDAY);
            dayFullStr.push(translations.LOC_SATURDAY);
        }, function (translationIds) {
            dayFullStr.push(translationIds.LOC_SUNDAY);
            dayFullStr.push(translationIds.LOC_MONDAY);
            dayFullStr.push(translationIds.LOC_TUESDAY);
            dayFullStr.push(translationIds.LOC_WEDNESDAY);
            dayFullStr.push(translationIds.LOC_THURSDAY);
            dayFullStr.push(translationIds.LOC_FRIDAY);
            dayFullStr.push(translationIds.LOC_SATURDAY);
        });

        $scope.dayToFullString = function(day) {
            return dayFullStr[day];
        };

        var dayFromTodayStr = [];
        $translate(['LOC_A_COUPLE_OF_DAYS_AGO', 'LOC_THE_DAY_BEFORE_YESTERDAY', 'LOC_YESTERDAY', 'LOC_TODAY', 'LOC_TOMORROW', 'LOC_THE_DAY_AFTER_TOMORROW', 'LOC_TWO_DAYS_AFTER_TOMORROW', 'LOC_FROM_TODAY']).then(function (translations) {
            dayFromTodayStr.push(translations.LOC_A_COUPLE_OF_DAYS_AGO);
            dayFromTodayStr.push(translations.LOC_THE_DAY_BEFORE_YESTERDAY);
            dayFromTodayStr.push(translations.LOC_YESTERDAY);
            dayFromTodayStr.push(translations.LOC_TODAY);
            dayFromTodayStr.push(translations.LOC_TOMORROW);
            dayFromTodayStr.push(translations.LOC_THE_DAY_AFTER_TOMORROW);
            dayFromTodayStr.push(translations.LOC_TWO_DAYS_AFTER_TOMORROW);
            dayFromTodayStr.push(translations.LOC_FROM_TODAY);
        }, function (translationIds) {
            dayFromTodayStr.push(translationIds.LOC_A_COUPLE_OF_DAYS_AGO);
            dayFromTodayStr.push(translationIds.LOC_THE_DAY_BEFORE_YESTERDAY);
            dayFromTodayStr.push(translationIds.LOC_YESTERDAY);
            dayFromTodayStr.push(translationIds.LOC_TODAY);
            dayFromTodayStr.push(translationIds.LOC_TOMORROW);
            dayFromTodayStr.push(translationIds.LOC_THE_DAY_AFTER_TOMORROW);
            dayFromTodayStr.push(translationIds.LOC_TWO_DAYS_AFTER_TOMORROW);
            dayFromTodayStr.push(translationIds.LOC_FROM_TODAY);
        });

        $scope.getDayString = function (day) {
            if (-3 <= day && day <= 3) {
                return dayFromTodayStr[day + 3];
            }
            else {
                return day+dayFromTodayStr[dayFromTodayStr.length-1];
            }
            console.error("Fail to get day string day=" + day);
            return "";
        };

        $scope.getSentimentIcon = function (grade) {
           switch (grade) {
               case 1:
                   return 'ic_sentiment_satisfied_white_24px.svg';
               case 2:
                   return 'ic_sentiment_neutral_white_24px.svg';
               case 3:
                   return 'ic_sentiment_dissatisfied_white_24px.svg';
               case 4:
                   return 'ic_sentiment_very_dissatisfied_white_24px.svg';
               case 5:
                   return 'ic_sentiment_very_dissatisfied_white_24px.svg';
               default:
                   console.log('Fail to find grade='+grade);
           }
            return 'ic_sentiment_very_dissatisfied_white_24px.svg';
        };

        var regionSize;
        var regionSumSize;
        var bigDigitSize;
        //var bigTempPointSize;
        var bigSkyStateSize;
        //var smallTimeSize;
        var smallImageSize;
        //var smallDigitSize;
        var headerRatio = 0.4;
        var contentRatio = 0.6;
        var showAqi = false;

        /* The height of a toolbar by default in Angular Material */
        var legacyToolbarH = 58;
        var startHeight;
        var headerE;
        var picture;
        var alphaBar;
        var pBigDigit;
        var imgBigSkyStateSize;

        function init() {
            //identifyUser();
            $ionicHistory.clearHistory();

            if (window.screen.height) {
                bodyHeight = window.screen.height;
                bodyWidth = window.screen.width;
            }
            else if (window.innerHeight) {
                //crosswalk에서 늦게 올라옴.
                bodyHeight = window.innerHeight;
                bodyWidth = window.innerWidth;
            }
            else if (window.outerHeight) {
                //ios에서는 outer가 없음.
                bodyHeight = window.outerHeight;
                bodyWidth = window.outerWidth;
            }
            else {
                console.log("Fail to get window width, height");
                bodyHeight = 640;
                bodyWidth = 360;
            }

            if (bodyWidth >= TABLET_WIDTH && bodyWidth < bodyHeight) {
                headerRatio = 0.4;
                contentRatio = 0.6;
            }
            else if (bodyHeight >= 730) {
                //note5, nexus5x, iphone 5+
                if (ionic.Platform.isIOS()) {
                    headerRatio = 0.40;
                    contentRatio = 0.60;
                }
                else {
                    headerRatio = 0.33;
                    contentRatio = 0.67;
                }
            }
            else {
                if (ionic.Platform.isIOS()) {
                    headerRatio = 0.33;
                    contentRatio = 0.67;
                }
                else {
                    //0.32는 되어야, top main box가 16:9비율이 나옴.
                    //차후 top main box에 사진 들어가는 것을 고려.
                    headerRatio = 0.32;
                    contentRatio = 0.68;
                }
            }

            /* The height of a toolbar by default in Angular Material */
            legacyToolbarH = 58;
            startHeight = bodyHeight * headerRatio;
            headerE         = angular.element(document.querySelector('[md-page-header]'));
            picture        = angular.element(document.querySelector('[md-header-picture]'));
            alphaBar        = angular.element(document.getElementById('alphaBar'));

            //console.log(headerE);
            //console.log(picture);
            //console.log("startHeight=", startHeight);

            headerE.css('height', startHeight+'px');
            picture.css('height', startHeight+'px');
            //빠르게 변경될때, header가 disable-user-behavior class가 추가되면서 화면이 올라가는 문제
            $scope.headerHeight = startHeight;

            var padding = 1;
            var smallPadding = 1;

            //iphone 4 480-20(status bar)
            if ((bodyHeight === 460 || bodyHeight === 480) && bodyWidth === 320) {
                padding = 1.125;
                smallPadding = 1.1;
            }
            //iphone 5 568-20(status bar)
            if ((bodyHeight === 548 || bodyHeight === 568) && bodyWidth === 320) {
                smallPadding = 1.1;
            }

            if (bodyHeight >= 640) {
                //대부분의 android와 iPhone6부터 aqi보여줌.
                showAqi = true;
            }
            else if (Purchase.accountLevel != Purchase.ACCOUNT_LEVEL_FREE
                && bodyHeight / bodyWidth >= ASPECT_RATIO_16_9) {
                //free이상의 유저이며, 16:9 이상 비율은 aqi보여줌.
                showAqi = true;
            }

            var mainHeight = bodyHeight - 100;

            //var topTimeSize = mainHeight * 0.026;
            //$scope.topTimeSize = topTimeSize<16.8?topTimeSize:16.8;

            regionSize = mainHeight * 0.0306 * padding; //0.051
            regionSize = regionSize<33.04?regionSize:33.04;

            regionSumSize = mainHeight * 0.0336 * padding; //0.047
            regionSumSize = regionSumSize<30.45?regionSumSize:30.45;

            bigDigitSize = mainHeight * 0.16544 * padding; //0.2193
            bigDigitSize = bigDigitSize<142.1?bigDigitSize:142.1;

            //bigTempPointSize = mainHeight * 0.03384 * padding; //0.0423
            //bigTempPointSize = bigTempPointSize<27.4?bigTempPointSize:27.4;

            bigSkyStateSize = mainHeight * 0.11264 * padding; //0.1408
            bigSkyStateSize = bigSkyStateSize<91.2?bigSkyStateSize:91.2;

            //smallTimeSize = mainHeight * 0.0299 * smallPadding;
            //smallTimeSize = smallTimeSize<19.37?smallTimeSize:19.37;

            smallImageSize = mainHeight * 0.0512 * smallPadding;
            smallImageSize = smallImageSize<33.17?smallImageSize:33.17;
            $scope.smallImageSize = smallImageSize;

            //smallDigitSize = mainHeight * 0.0320 * smallPadding;
            //smallDigitSize = smallDigitSize<20.73?smallDigitSize:20.73;

            var fav = parseInt($stateParams.fav);
            if (!isNaN(fav)) {
                if (fav === 0) {
                    var city = WeatherInfo.getCityOfIndex(0);
                    if (city !== null && !city.disable) {
                        WeatherInfo.setCityIndex(fav);
                    }
                } else {
                    WeatherInfo.setCityIndex(fav);
                }
            }
            if (WeatherInfo.getEnabledCityCount() === 0) {
                $translate(['LOC_ERROR', 'LOC_ADD_LOCATIONS']).then(function (translations) {
                    var strError = translations.LOC_ERROR;
                    var message = translations.LOC_ADD_LOCATIONS;
                    $scope.showAlert(strError, message, function() {
                        $location.path('/tab/search');
                    });
                }, function (translationIds) {
                    var strError = translationIds.LOC_ERROR;
                    var message = translationIds.LOC_ADD_LOCATIONS;
                    $scope.showAlert(strError, message, function() {
                        $location.path('/tab/search');
                    });
                });
                return;
            }
            $scope.cityCount = WeatherInfo.getEnabledCityCount();

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
            str += '<p id="cityInfo" class="textFont" style="font-size:'+regionSize+'px; margin: 8px 0">';
            if (cityData.currentPosition) {
                str += '<a class="icon ion-ios-location-outline" style="color: white;"></a>';
            }
            str += shortenAddress+'</p>';
            str += '<div class="row row-no-padding"> <div id="weatherInfo" style="margin: auto"> <div class="row row-no-padding">';
            str +=      '<p id="pBigDigit" style="font-size: '+bigDigitSize+'px; margin: 0; font-weight:300">'+Math.round(cityData.currentWeather.t1h);
            str +=      '<span style="font-size: '+bigDigitSize/2+'px;vertical-align: super;">˚</span></p>';
            str +=      '<div style="text-align: left; margin: auto">';
            //str +=          '<img id="imgBigTempPointSize" style="height: '+bigTempPointSize+'px; width: '+bigTempPointSize+'px" src="img/reddot.png">';
            //str +=          '<br>';
            str +=          '<img id="imgBigSkyStateSize" style="height: '+bigSkyStateSize+'px; width: '+bigSkyStateSize+'px" src="'+Util.imgPath+'/'+
                                cityData.currentWeather.skyIcon+'.png">';
            str +=      '</div>';
            str += '</div></div></div>';
            str += '<p id="summary" class="textFont" style="font-size: '+regionSumSize+'px; margin: 0;">'+
                $scope.currentWeather.summary+'</p>';
            return str;
        }

        /**
         * 실제 강우량과, 예보 강우량을 구분하는데 all인 경우 두개 모두 표시
         * @param pty
         * @param rn1
         * @param r06
         * @param s06
         * @param all
         * @returns {string}
         * @private
         */
        function _makeRainSnowFallValueStr(pty, rn1, r06, s06, all) {
            var ret = "";
            var frcst = 0;
            var rsf = 0;

            if (r06 != undefined && r06 > 0) {
                frcst = r06>=10?Math.round(r06):r06;
            }
            else if (r06 != undefined && s06 > 0) {
                frcst = s06>=10?Math.round(s06):s06;
            }

            if (rn1 != undefined && rn1 > 0) {
                rsf = rn1>=10?Math.round(rn1):rn1;
            }

            if (rn1 != undefined && rn1 > 0) {
                if ((r06 != undefined || s06 != undefined) && all) {
                    ret += rsf+'/'+frcst;
                }
                else {
                    ret += rsf;
                }
                return ret;
            }
            else if ((r06 != undefined && r06 > 0) || (r06 != undefined && s06 > 0)) {
                if (rn1 != undefined && all) {
                    ret += rsf+'/'+frcst;
                }
                else {
                    ret += frcst;
                }
                return ret;
            }
            if (pty > 0) {
               ret = "0";
            }
            return ret;
        }

        /**
         * 적설량과, 강우량 구분
         * @param pty
         * @param rn1
         * @param r06
         * @param s06
         * @returns {*}
         * @private
         */
        function _makeRainSnowFallSymbol(pty, rn1, r06, s06) {
            if (pty != undefined && pty === 3) {
                return "cm";
            }
            else if (pty != undefined && pty > 0) {
                return "mm";
            }

            if (r06 != undefined && r06 > 0) {
                return "mm";
            }
            if (s06 != undefined && s06 > 0) {
                return "cm";
            }

            if (rn1 != undefined && rn1 > 0) {
                return "mm";
            }
            return "";
        }

        /**
         * pty가 0이라도 예보상으로 비가 온다고 했거나, 비가 오지 않는다고 했지만 실제로 비가 온 경우도 있음.
         * @param day
         * @returns {boolean}
         */
        $scope.haveRainSnowFall = function (day) {
            return !!((day.pty != undefined && day.pty > 0) ||
            (day.rn1 != undefined && day.rn1 > 0) ||
            (day.r06 != undefined && day.r06 > 0) ||
            (day.s06 != undefined && day.s06 > 0));
        };

        $scope.getRainSnowFall = function (value) {
            var ret = _makeRainSnowFallValueStr(value.pty, value.rn1, value.r06, value.s06);
            if (ret == "") {
                ret = "0";
            }
            return ret;
        };

        $scope.getRainSnowFallSymbol = function (value) {
            var ret = _makeRainSnowFallSymbol(value.pty, value.rn1, value.r06, value.s06);
            if (ret == "") {
                ret = "mm";
            }
            return ret;
        };

        /**
         * display item을 count하여 table pixel을 구함.
         * 0.9.1까지 displayItemCount가 없음.
         * @param displayItemCount
         * @returns {number}
         */
        function getShortTableHeight(displayItemCount) {
            var val = 0;
            if (displayItemCount >= 1) {
                //sky
                val += $scope.smallImageSize;
            }
            if (displayItemCount >= 2) {
                //pop body1
                val += 15;
            }
            if (displayItemCount >= 3) {
                //rn1 - caption
                val += 13;
            }
            return val;
        }

        $scope.getShortTableHeight = getShortTableHeight;

        /**
         * display item을 count하여 table pixel을 구함.
         * @param displayItemCount
         * @returns {number}
         */
        function getMidTableHeight(displayItemCount) {
            var val = 17; //day  - subheading
            if (displayItemCount == undefined || displayItemCount == 0) {
                displayItemCount = 7;
            }
            //최소한 한개의 이미지는 존재함.
            val += $scope.smallImageSize*0.8;

            if (displayItemCount & 4) {
                val += $scope.smallImageSize*0.8;
            }
            else {
                val += $scope.smallImageSize*0.8/2;
            }
            if (displayItemCount & 2) {
                //pop - body1
                val += 15;
            }
            if (displayItemCount & 1) {
                //rns - caption
                val += 13;
            }
            return val;
        }

        $scope.getMidTableHeight = getMidTableHeight;

        //<div class="row row-no-padding">
        //    <div style="width: 26px;"></div>
        //    <div class="col"
        //         ng-if="value.date > timeTable[0].date && value.date <= timeTable[timeTable.length-1].date"
        //         ng-repeat="value in dayTable">
        //            <p ng-style="::{'font-size':smallTimeSize+'px'}"
        //               style="margin: 0; opacity: 0.84">
        //                {{getDayText(value)}} <span style="font-size: 13px; opacity: 0.54">{{getDayForecast(value)}}</span>
        //            </p>
        //    </div>
        //    <div style="width: 26px;"></div>
        //</div>
        //<hr style="margin: 0; border: 0; border-top:1px solid rgba(255,255,255,0.6);">
        //<div class="row row-no-padding" style="flex: 1">
        //    <div class="col table-items" ng-repeat="value in timeTable">
        //        <p ng-style="::{'font-size':smallTimeSize+'px'}" style="margin: auto">{{value.time}}</p>
        //        <img ng-style="::{'width':smallImageSize+'px'}" style="margin: auto" ng-src="img/{{value.tempIcon}}.png">
        //        <p ng-style="::{'font-size':smallDigitSize +'px'}" style="margin: auto">{{value.t3h}}˚</p>
        //        <img ng-style="::{'width':smallImageSize+'px'}" style="margin: auto" ng-src="{{::imgPath}}/{{value.skyIcon}}.png">
        //        <p ng-if="value.rn1 === undefined" ng-style="::{'font-size':smallDigitSize +'px'}" style="margin: auto">{{value.pop}}<small>%</small></p>
        //        <p ng-if="value.rn1 !== undefined" ng-style="::{'font-size':smallDigitSize +'px'}" style="margin: auto">{{value.rn1}}<span
        //                style="font-size:10px" ng-if="value.pty !== 3">mm</span><span
        //                style="font-size:10px" ng-if="value.pty === 3">cm</span></p>
        //    </div>
        //</div>
        var strHour;
        $translate('LOC_HOUR').then(function (translations) {
            strHour = translations;
        }, function (translationIds) {
            strHour = translationIds;
        });

        function getShortTable() {
            var i;
            var value;
            var str = '';

            str += '<div class="row row-no-padding"> <div style="width: '+colWidth/2+'px;"></div>';
            for (i=0; i<cityData.dayTable.length; i++) {
                value = cityData.dayTable[i];
                if (value.date > cityData.timeTable[0].date && value.date <= cityData.timeTable[cityData.timeTable.length-1].date) {
                    str += '<div class="col">';
                    str +=   '<p class="caption" style="margin: 0;">';
                    str +=       $scope.getDayText(value);
                    str += '</p></div>';
                }
            }
            str += '<div class="table-border" style="width: '+colWidth/2+'px;"></div> </div>';

            str += '<div class="row row-no-padding" style="border-bottom : 1px solid rgba(254,254,254,0.5);">';
            for (i=0; i<cityData.timeTable.length; i++) {
                value = cityData.timeTable[i];
                str += '<div class="col table-items" style="text-align: center;">';
                if (value.time == 24) {
                    str += '<p class="subheading" style="letter-spacing: 0; margin: auto; padding: 2px;">' + '0'+strHour+ '</p>';
                }
                else {
                    str += '<p class="subheading" style="letter-spacing: 0; margin: auto; padding: 2px;">' + value.time+strHour + '</p>';
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
            str += '<div class="row row-no-padding" style="flex: 1; text-align: center; border-bottom: 1px solid rgba(254,254,254,0.5);">';
            for (i=0; i<cityData.dayTable.length; i++) {
                value = cityData.dayTable[i];
                str += '<div class="col table-items">';
                str +=  '<p class="body1" style="margin: 0;';
                if (value.fromToday === 0)  {
                    str += ' opacity: 1;">';
                }
                else {
                    str += ' opacity: 0.84;">';
                }
                str +=  $scope.dayToString(value.dayOfWeek) + '</p>';
                str += '</div>';
            }
            str += '</div>';
            return str;
        }

        function applyWeatherData() {
            console.log('apply weather data');
            cityData = WeatherInfo.getCityOfIndex(WeatherInfo.getCityIndex());
            if (cityData === null || cityData.address === null) {
                console.log("fail to getCityOfIndex");
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

            $scope.topMainBox = $sce.trustAsHtml(getTopMainBox());

            $scope.updateTime = (function () {
               if (cityData.currentWeather) {
                   if (cityData.currentWeather.stnDateTime) {
                       return cityData.currentWeather.stnDateTime;
                   }
                   else {
                       var tmpDate = cityData.currentWeather.date;
                       return tmpDate.substr(0,4)+"-"+tmpDate.substr(4,2)+"-" +tmpDate.substr(6,2) +
                           " " + cityData.currentWeather.time + ":00";
                   }
               }
            })();
            // To share weather information for apple watch.
            // AppleWatch.setWeatherData(cityData);

            setTimeout(function () {
                //var mainHeight = document.getElementById('ionContentBody').offsetHeight;
                var mainHeight = bodyHeight * contentRatio;
                var padding = 0;

                //의미상으로 배너 여부이므로, TwAds.enabledAds가 맞지만 loading이 느려, account level로 함.
                //광고 제거 버전했을 때, AQI가 보이게 padding맞춤. 나머지 14px는 chart에서 사용됨.
                if (Purchase.accountLevel == Purchase.ACCOUNT_LEVEL_FREE) {
                    padding += 36;
                }

                if (bodyHeight === 480) {
                    //iphone4
                    padding -= 32;
                }
                else if (ionic.Platform.isAndroid()) {
                   //status bar
                    padding += 24;
                    if (bodyHeight <= 512) {
                        //view2 4:3
                        padding -= 32;
                    }
                }

                if($scope.forecastType == 'short') {
                    //topMainBox height is startHeight
                    if (showAqi && cityData.currentWeather.arpltn) {
                        padding+=36;
                    }
                    var chartShortHeight = mainHeight - (143+padding);
                    $scope.chartShortHeight = chartShortHeight < 300 ? chartShortHeight : 300;
                    $scope.shortTable =  $sce.trustAsHtml(getShortTable());

                    setTimeout(function () {
                        // ios에서 ionic native scroll 사용시에 화면이 제대로 안그려지는 경우가 있어서 animation 필수.
                        if (ionic.Platform.isAndroid()) {
                            $ionicScrollDelegate.$getByHandle("timeChart").scrollTo(getTodayPosition(), 0, false);
                        } else {
                            $ionicScrollDelegate.$getByHandle("timeChart").scrollTo(getTodayPosition(), 0, true);
                        }
                    }, 0);
                }
                else {
                    if (showAqi && cityData.dayTable[7].dustForecast) {
                        padding+=36;
                    }
                    var chartMidHeight = mainHeight - (128+padding);
                    $scope.chartMidHeight = chartMidHeight < 300 ? chartMidHeight : 300;
                    $scope.midTable = $sce.trustAsHtml(getMidTable());

                    setTimeout(function () {
                        if (ionic.Platform.isAndroid()) {
                            $ionicScrollDelegate.$getByHandle("weeklyChart").scrollTo(getTodayPosition(), 0, false);
                            $ionicScrollDelegate.$getByHandle("weeklyTable").scrollTo(300, 0, false);
                        } else {
                            $ionicScrollDelegate.$getByHandle("weeklyChart").scrollTo(getTodayPosition(), 0, true);
                            $ionicScrollDelegate.$getByHandle("weeklyTable").scrollTo(300, 0, true);
                        }
                    }, 0);
                }

                $scope.showDetailWeather = true;
            });
        }

        /**
         * retry popup이 없는 경우 항상 undefined여야 함.
         */
        var confirmPopup;
        var strError, strClose, strRetry;
        $translate(['LOC_ERROR', 'LOC_CLOSE', 'LOC_RETRY']).then(function (translations) {
            strError = translations.LOC_ERROR;
            strClose = translations.LOC_CLOSE;
            strRetry = translations.LOC_RETRY;
        }, function (translationIds) {
            strError = translationIds.LOC_ERROR;
            strClose = translationIds.LOC_CLOSE;
            strRetry = translationIds.LOC_RETRY;
        });

        function loadWeatherData() {
            if (cityData.address === null || WeatherInfo.canLoadCity(WeatherInfo.getCityIndex()) === true) {
                if (confirmPopup) {
                    confirmPopup.close();
                    confirmPopup = undefined;
                }
                $ionicLoading.show();
                updateWeatherData().then(function () {
                    $ionicLoading.hide();
                }, function (msg) {
                    $ionicLoading.hide();
                    showRetryConfirm(strError, msg, function (retry) {
                        if (retry) {
                            setTimeout(function () {
                                loadWeatherData();
                            }, 0);
                        }
                    });
                }).finally(function () {
                    console.log('finish update weather data');
                    shortenAddress = WeatherUtil.getShortenAddress(cityData.address);
                });
                return;
            }

            $ionicLoading.hide();
        }

        /**
         * android 6.0이상에서 처음 현재위치 사용시에, android 현재위치 접근에 대한 popup때문에 앱 pause->resume이 됨.
         * 그래서 init와 reloadevent가 둘다 오게 되는데 retry confirm이 두개 뜨지 않게 한개 있는 경우 닫았다가 새롭게 열게 함.
         * @param title
         * @param template
         * @param callback
         */
        function showRetryConfirm(title, template, callback) {
            if (confirmPopup) {
                confirmPopup.close();
            }
            confirmPopup = $ionicPopup.show({
                title: title,
                template: template,
                buttons: [
                    { text: strClose,
                        onTap: function () {
                            return false;
                        }
                    },
                    { text: strRetry,
                        type: 'button-positive',
                        onTap: function () {
                            return true;
                        }
                    }
                ]
            });
            confirmPopup
                .then(function (res) {
                    if (res) {
                        console.log("Retry");
                    } else {
                        console.log("Close");
                    }
                    callback(res);
                })
                .finally(function () {
                    console.log('called finally');
                    confirmPopup = undefined;
                });
        }

        function updateWeatherData() {
            var deferred = $q.defer();
            var strFailToGetAddressInfo;
            var strFailToGetCurrentPostion;
            var strFailToGetWeatherInfo;
            var strPleaseTurnOnLocationWiFi;

            $translate(['LOC_FAIL_TO_GET_LOCATION_INFORMATION', 'LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION', 'LOC_FAIL_TO_GET_WEATHER_INFO', 'LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI']).then(function (translations) {
                strFailToGetAddressInfo = translations.LOC_FAIL_TO_GET_LOCATION_INFORMATION;
                strFailToGetCurrentPostion = translations.LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION;
                strFailToGetWeatherInfo = translations.LOC_FAIL_TO_GET_WEATHER_INFO;
                strPleaseTurnOnLocationWiFi = translations.LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI;
            }, function (translationIds) {
                strFailToGetAddressInfo = translationIds.LOC_FAIL_TO_GET_LOCATION_INFORMATION;
                strFailToGetCurrentPostion = translationIds.LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION;
                strFailToGetWeatherInfo = translationIds.LOC_FAIL_TO_GET_WEATHER_INFO;
                strPleaseTurnOnLocationWiFi = translationIds.LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI;
            });

            if (cityData.currentPosition === true) {
                WeatherUtil.getCurrentPosition().then(function (coords) {
                    WeatherUtil.getAddressFromGeolocation(coords.latitude, coords.longitude).then(function (address) {
                        var startTime = new Date().getTime();

                        WeatherUtil.getWeatherInfo(address, WeatherInfo.towns).then(function (weatherDatas) {
                            var endTime = new Date().getTime();
                            Util.ga.trackTiming('weather', endTime - startTime, 'get', 'info');
                            Util.ga.trackEvent('weather', 'get', WeatherUtil.getShortenAddress(address) +
                                '(' + WeatherInfo.getCityIndex() + ')', endTime - startTime);

                            var city = WeatherUtil.convertWeatherData(weatherDatas);
                            city.address = address;
                            city.location = {"lat": coords.latitude, "long": coords.longitude};
                            WeatherInfo.updateCity(WeatherInfo.getCityIndex(), city);
                            applyWeatherData();
                            deferred.resolve();
                        }, function (error) {
                            var endTime = new Date().getTime();
                            Util.ga.trackTiming('weather', endTime - startTime, 'error', 'info');
                            if (error instanceof Error) {
                                Util.ga.trackEvent('weather', 'error', WeatherUtil.getShortenAddress(address) +
                                    '(' + WeatherInfo.getCityIndex() + ', message:' + error.message + ', code:' + error.code + ')', endTime - startTime);
                            } else {
                                Util.ga.trackEvent('weather', 'error', WeatherUtil.getShortenAddress(address) +
                                    '(' + WeatherInfo.getCityIndex() + ', ' + error + ')', endTime - startTime);
                            }

                            var msg = "날씨 정보를 가져오지 못하였습니다.";
                            deferred.reject(msg);
                        });
                    }, function () {
                        deferred.reject(strFailToGetAddressInfo);
                    });
                }, function () {
                    Util.ga.trackEvent('position', 'error', 'all');
                    var msg = strFailToGetCurrentPostion;
                    if (ionic.Platform.isAndroid()) {
                        msg += "<br>" + strPleaseTurnOnLocationWiFi;
                    }
                    deferred.reject(msg);
                });
            } else {
                var startTime = new Date().getTime();

                WeatherUtil.getWeatherInfo(cityData.address, WeatherInfo.towns).then(function (weatherDatas) {
                    var endTime = new Date().getTime();
                    Util.ga.trackTiming('weather', endTime - startTime, 'get', 'info');
                    Util.ga.trackEvent('weather', 'get', WeatherUtil.getShortenAddress(cityData.address) +
                        '(' + WeatherInfo.getCityIndex() + ')', endTime - startTime);

                    var city = WeatherUtil.convertWeatherData(weatherDatas);
                    WeatherInfo.updateCity(WeatherInfo.getCityIndex(), city);
                    applyWeatherData();
                    deferred.resolve();
                }, function (error) {
                    var endTime = new Date().getTime();
                    Util.ga.trackTiming('weather', endTime - startTime, 'error', 'info');
                    if (error instanceof Error) {
                        Util.ga.trackEvent('weather', 'error', WeatherUtil.getShortenAddress(cityData.address) +
                            '(' + WeatherInfo.getCityIndex() + ', message:' + error.message + ', code:' + error.code + ')', endTime - startTime);
                    } else {
                        Util.ga.trackEvent('weather', 'error', WeatherUtil.getShortenAddress(cityData.address) +
                            '(' + WeatherInfo.getCityIndex() + ', ' + error + ')', endTime - startTime);
                    }
                    deferred.reject(strFailToGetWeatherInfo);
                });
            }

            return deferred.promise;
        }

        function getWidthPerCol() {
            if (colWidth)  {
                return colWidth;
            }

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
                if (bodyWidth >= TABLET_WIDTH) {
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
                //today is 3th.
                index = 5;
                return getWidthPerCol()*index;
            }
            return getWidthPerCol()*index;
        }

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
            return $scope.getDayString(value.fromToday) + ' ' + value.date.substr(4,2) + '.' + value.date.substr(6,2);
        };

        $scope.convertMMDD = function (value) {
            return value.substr(4,2)+'/'+value.substr(6,2);
        };

        $scope.diffTodayYesterday = function () {
            return cityData.currentWeather.diffTempStr;
        };

        $scope.$on('reloadEvent', function(event, sender) {
            if (sender == 'resume') {
               if (confirmPopup)  {
                   console.log('skip event when retry load popup is shown');
                   return;
               }
            }
            console.log('called by update weather event');
            WeatherInfo.reloadCity(WeatherInfo.getCityIndex());
            loadWeatherData();
        });

        $scope.headerScroll = function drawShadow() {
            var rect = $ionicScrollDelegate.$getByHandle("body").getScrollPosition();
            if (!(rect == undefined) && rect.hasOwnProperty('top') && rect.top > 0) {
                alphaBar.css('box-shadow','0px 1px 5px 0 rgba(0, 0, 0, 0.26)');
            }
            else {
                alphaBar.css('box-shadow','initial');
            }
        };

        init();
    })

    .controller('SearchCtrl', function ($scope, $rootScope, $ionicPlatform, $ionicScrollDelegate, TwAds, $q, $ionicHistory,
                                        $location, WeatherInfo, WeatherUtil, Util, ionicTimePicker, Push, $ionicLoading, $translate) {
        $scope.searchWord = undefined;
        $scope.searchResults = [];
        $scope.cityList = [];
        $scope.imgPath = Util.imgPath;
        $scope.isEditing = false;

        var towns = WeatherInfo.towns;
        var searchIndex = -1;

        function init() {
            $ionicHistory.clearHistory();

            var strCurrent;
            var strLocation;
            $translate(['LOC_CURRENT', 'LOC_LOCATION']).then(function (translations) {
                strCurrent = translations.LOC_CURRENT;
                strLocation = translations.LOC_LOCATION;
            }, function (translationIds) {
                strCurrent = translationIds.LOC_CURRENT;
                strLocation = translationIds.LOC_LOCATION;
            }).finally(function () {
                for (var i = 0; i < WeatherInfo.getCityCount(); i += 1) {
                    var city = WeatherInfo.getCityOfIndex(i);
                    var address = WeatherUtil.getShortenAddress(city.address).split(",");
                    var todayData = null;

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
                    loadWeatherData(i);
                }
            });
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
        };

        $scope.OnSearchCurrentPosition = function() {
            $scope.isEditing = false;

            $ionicLoading.show();

            var strFailToGetAddressInfo;
            var strFailToGetCurrentPostion;
            var strFailToGetWeatherInfo;
            var strPleaseTurnOnLocationWiFi;
            var strError;

            $translate(['LOC_FAIL_TO_GET_LOCATION_INFORMATION', 'LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION', 'LOC_FAIL_TO_GET_WEATHER_INFO', 'LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI', 'LOC_ERROR']).then(function (translations) {
                strFailToGetAddressInfo = translations.LOC_FAIL_TO_GET_LOCATION_INFORMATION;
                strFailToGetCurrentPostion = translations.LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION;
                strFailToGetWeatherInfo = translations.LOC_FAIL_TO_GET_WEATHER_INFO;
                strPleaseTurnOnLocationWiFi = translations.LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI;
                strError = translations.LOC_ERROR;
            }, function (translationIds) {
                strFailToGetAddressInfo = translationIds.LOC_FAIL_TO_GET_LOCATION_INFORMATION;
                strFailToGetCurrentPostion = translationIds.LOC_FAIL_TO_FIND_YOUR_CURRENT_LOCATION;
                strFailToGetWeatherInfo = translationIds.LOC_FAIL_TO_GET_WEATHER_INFO;
                strPleaseTurnOnLocationWiFi = translationIds.LOC_PLEASE_TURN_ON_LOCATION_AND_WIFI;
                strError = translationIds.LOC_ERROR;
            });

            WeatherUtil.getCurrentPosition().then(function (coords) {
                WeatherUtil.getAddressFromGeolocation(coords.latitude, coords.longitude).then(function (address) {
                    var addressArray = WeatherUtil.convertAddressArray(address);
                    var townAddress = WeatherUtil.getTownFromFullAddress(addressArray);
                    if (townAddress.first === "" && townAddress.second === "" && townAddress.third === "") {
                        $scope.showAlert(strError, strFailToGetAddressInfo);
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
                    $scope.showAlert(strError, strFailToGetAddressInfo);
                    $ionicLoading.hide();
                });
            }, function () {
                Util.ga.trackEvent('position', 'error', 'all');
                var msg = strFailToGetCurrentPostion;
                if (ionic.Platform.isAndroid()) {
                    msg += "<br>" + strPleaseTurnOnLocationWiFi;
                }
                $scope.showAlert(strError, msg);
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

            var startTime = new Date().getTime();

            WeatherUtil.getWeatherInfo(address, WeatherInfo.towns).then(function (weatherDatas) {
                var endTime = new Date().getTime();
                Util.ga.trackTiming('weather', endTime - startTime, 'get', 'info');
                Util.ga.trackEvent('weather', 'get', WeatherUtil.getShortenAddress(address) , endTime - startTime);

                var city = WeatherUtil.convertWeatherData(weatherDatas);
                city.currentPosition = false;
                city.address = address;
                //검색하는 경우 location 정보가 없음. 업데이트 필요.
                //city.location = location;

                if (WeatherInfo.addCity(city) === false) {
                    Util.ga.trackEvent('city', 'add error', WeatherUtil.getShortenAddress(address), WeatherInfo.getCityCount() - 1);
                    $translate("LOC_ERROR", "LOC_ALREADY_THE_SAME_LOCATION_HAS_BEEN_ADDED").then(function (translations) {
                        $scope.showAlert(translations.LOC_ERROR, translations.LOC_ALREADY_THE_SAME_LOCATION_HAS_BEEN_ADDED);
                    }, function (translationIds) {
                        $scope.showAlert(translationIds.LOC_ERROR, translationIds.LOC_ALREADY_THE_SAME_LOCATION_HAS_BEEN_ADDED);
                    });
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

                $translate("LOC_ERROR", "LOC_FAIL_TO_GET_WEATHER_INFO").then(function (translations) {
                    $scope.showAlert(translations.LOC_ERROR, translations.LOC_FAIL_TO_GET_WEATHER_INFO);
                }, function (translationIds) {
                    $scope.showAlert(translationIds.LOC_ERROR, translationIds.LOC_FAIL_TO_GET_WEATHER_INFO);
                });

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
            var ipObj1 = {
                callback: function (val) {      //Mandatory
                    if (typeof(val) === 'undefined') {
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

            ionicTimePicker.openTimePicker(ipObj1);
        };

        function loadWeatherData(index) {
            if (WeatherInfo.canLoadCity(index) === true) {
                updateWeatherData(index).then(function (city) {
                    index = WeatherInfo.getIndexOfCity(city);
                    if (index !== -1) {
                        WeatherInfo.updateCity(index, city);

                        var address = WeatherUtil.getShortenAddress(city.address).split(",");
                        var todayData = city.dayTable.filter(function (data) {
                            return (data.fromToday === 0);
                        });

                        var data = $scope.cityList[index];
                        data.address = address;
                        data.skyIcon = city.currentWeather.skyIcon;
                        data.t1h = city.currentWeather.t1h;
                        data.tmn = todayData[0].tmn;
                        data.tmx = todayData[0].tmx;
                    }
                });
            }
        }

        function updateWeatherData(index) {
            var deferred = $q.defer();

            var cityData = WeatherInfo.getCityOfIndex(index);
            if (cityData.currentPosition === true) {
                WeatherUtil.getCurrentPosition().then(function (coords) {
                    WeatherUtil.getAddressFromGeolocation(coords.latitude, coords.longitude).then(function (address) {
                        var startTime = new Date().getTime();

                        WeatherUtil.getWeatherInfo(address, WeatherInfo.towns).then(function (weatherDatas) {
                            var endTime = new Date().getTime();
                            Util.ga.trackTiming('weather', endTime - startTime, 'get', 'info');
                            Util.ga.trackEvent('weather', 'get', WeatherUtil.getShortenAddress(address) +
                                '(' + index + ')', endTime - startTime);

                            var city = WeatherUtil.convertWeatherData(weatherDatas);
                            city.currentPosition = true;
                            city.address = address;
                            city.location = {"lat": coords.latitude, "long": coords.longitude};
                            deferred.resolve(city);
                        }, function (error) {
                            var endTime = new Date().getTime();
                            Util.ga.trackTiming('weather', endTime - startTime, 'error', 'info');
                            if (error instanceof Error) {
                                Util.ga.trackEvent('weather', 'error', WeatherUtil.getShortenAddress(address) +
                                    '(' + index + ', message:' + error.message + ', code:' + error.code + ')', endTime - startTime);
                            } else {
                                Util.ga.trackEvent('weather', 'error', WeatherUtil.getShortenAddress(address) +
                                    '(' + index + ', ' + error + ')', endTime - startTime);
                            }

                            deferred.reject();
                        });
                    }, function () {
                        deferred.reject();
                    });
                }, function () {
                    Util.ga.trackEvent('position', 'error', 'all');
                    deferred.reject();
                });
            } else {
                var startTime = new Date().getTime();

                WeatherUtil.getWeatherInfo(cityData.address, WeatherInfo.towns).then(function (weatherDatas) {
                    var endTime = new Date().getTime();
                    Util.ga.trackTiming('weather', endTime - startTime, 'get', 'info');
                    Util.ga.trackEvent('weather', 'get', WeatherUtil.getShortenAddress(cityData.address) +
                        '(' + index + ')', endTime - startTime);

                    var city = WeatherUtil.convertWeatherData(weatherDatas);
                    city.currentPosition = false;
                    city.address = cityData.address;
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
    })

    .controller('SettingCtrl', function($scope, $http, Util, Purchase, $ionicHistory, $translate) {
        function init() {
            $ionicHistory.clearHistory();

            if (ionic.Platform.isAndroid()) {
                //get interval time;
                $scope.updateInterval = "0";
                $scope.widgetOpacity = "69";

                if (window.plugins == undefined || plugins.appPreferences == undefined) {
                    console.log('appPreferences is undefined');
                    return;
                }

                var suitePrefs = plugins.appPreferences.suite(Util.suiteName);
                suitePrefs.fetch(
                    function (value) {
                        if (value == null) {
                            value = "0"
                        }
                        $scope.updateInterval = ""+value;
                        console.log("fetch preference Success: " + value);
                    }, function (error) {
                        console.log("fetch preference Error: " + error);
                    }, 'updateInterval'
                );

                suitePrefs.fetch(
                    function (value) {
                        if (value == null) {
                            value = "69"
                        }
                        $scope.widgetOpacity = ""+value;
                        console.log("fetch preference Success: " + value);
                    }, function (error) {
                        console.log("fetch preference Error: " + error);
                    }, 'widgetOpacity'
                );
            }
        }

        $scope.version = Util.version;

        $scope.sendMail = function() {

            var to = twClientConfig.mailTo;
            var subject = 'Send feedback';
            var body = '\n====================\nApp Version : ' + Util.version + '\nUUID : ' + window.device.uuid
                + '\nUA : ' + ionic.Platform.ua + '\n====================\n';

            $translate('LOC_SEND_FEEDBACK').then(function (translations) {
                subject = translations;
            }, function (translationIds) {
                subject = translationIds;
            }).finally(function () {
                window.location.href = 'mailto:' + to + '?subject=' + subject + '&body=' + encodeURIComponent(body);
            });

            Util.ga.trackEvent('action', 'click', 'send mail');
        };

        $scope.openMarket = function() {
            var src = "";
            if (ionic.Platform.isIOS()) {
                src = twClientConfig.iOSStoreUrl;
            }
            else if (ionic.Platform.isAndroid()) {
                src = twClientConfig.androidStoreUrl;
            }
            else {
                src = twClientConfig.etcUrl;
            }

            if (window.cordova && cordova.InAppBrowser) {
                cordova.InAppBrowser.open(src, "_system");
                Util.ga.trackEvent('action', 'click', 'open market');
            }
            else {
                var options = {
                    location: "yes",
                    clearcache: "yes",
                    toolbar: "no"
                };
                window.open(src, "_blank", options);
            }
        };

        $scope.openInfo = function() {
            var strTitle;
            var strMsg;
            $translate(['LOC_TODAYWEATHER','LOC_WEATHER_INFORMATION', 'LOC_KOREA_METEOROLOGICAL_ADMINISTRATION', 'LOC_AQI_INFORMATION', 'LOC_KOREA_ENVIRONMENT_CORPORATION', 'LOC_IT_IS_UNAUTHENTICATED_REALTIME_DATA_THERE_MAY_BE_ERRORS']).then(function (translations) {
                strTitle = translations.LOC_TODAYWEATHER;
                strMsg = translations.LOC_WEATHER_INFORMATION + " : "  + translations.LOC_KOREA_METEOROLOGICAL_ADMINISTRATION;
                strMsg += "<br>";
                strMsg += translations.LOC_AQI_INFORMATION + " : " + translations.LOC_KOREA_ENVIRONMENT_CORPORATION;
                strMsg += "<br>";
                strMsg += translations.LOC_IT_IS_UNAUTHENTICATED_REALTIME_DATA_THERE_MAY_BE_ERRORS;
            }, function (translationIds) {
                strTitle = translationIds.LOC_TODAYWEATHER;
                strMsg = translationIds.LOC_WEATHER_INFORMATION + " : "  + translationIds.LOC_KOREA_METEOROLOGICAL_ADMINISTRATION;
                strMsg += "<br>";
                strMsg += translationIds.LOC_AQI_INFORMATION + " : " + translationIds.LOC_KOREA_ENVIRONMENT_CORPORATION;
                strMsg += "<br>";
                strMsg += translationIds.LOC_IT_IS_UNAUTHENTICATED_REALTIME_DATA_THERE_MAY_BE_ERRORS;
            }).finally(function () {
                $scope.showAlert(strTitle, strMsg);
            });
        };

        $scope.isAndroid = function () {
            return ionic.Platform.isAndroid();
        };

        $scope.changeWidgetOpacity = function (val) {
            console.log("widget opacity ="+ val);
            if (window.plugins == undefined || plugins.appPreferences == undefined) {
                console.log('appPreferences is undefined');
                return;
            }

            var suitePrefs = plugins.appPreferences.suite(Util.suiteName);
            suitePrefs.store(
                function (value) {
                    console.log("save preference Success: " + value);
                },
                function (error) {
                    console.log("save preference Error: " + error);
                }, 'widgetOpacity', +val
            );
        };

        $scope.changeUpdateInterval = function (val) {
            console.log("update interval ="+ val);
            if (window.plugins == undefined || plugins.appPreferences == undefined) {
                console.log('appPreferences is undefined');
                return;
            }

            var suitePrefs = plugins.appPreferences.suite(Util.suiteName);
            suitePrefs.store(
                function (value) {
                    console.log("save preference Success: " + value);
                },
                function (error) {
                    console.log("save preference Error: " + error);
                }, 'updateInterval', +val
            );
        };

        $scope.hasInAppPurchase = function () {
            return Purchase.hasInAppPurchase || Purchase.paidAppUrl.length > 0;
        };

        init();
    })

    .controller('TabCtrl', function($scope, $ionicPlatform, $ionicPopup, $interval, WeatherInfo, WeatherUtil,
                                     $location, TwAds, $rootScope, Util, $translate) {
        var currentTime;

        function init() {
            currentTime = new Date();
            //$scope.currentTimeString = WeatherUtil.convertTimeString(currentTime); // 10월 8일(수) 12:23 AM
            //$interval(function() {
            //    var newDate = new Date();
            //    if(newDate.getMinutes() != currentTime.getMinutes()) {
            //        currentTime = newDate;
            //        $scope.currentTimeString = WeatherUtil.convertTimeString(currentTime);
            //    }
            //}, 1000);

            TwAds.init();
            TwAds.setLayout(TwAds.enableAds == undefined? TwAds.requestEnable:TwAds.enableAds);
        }

        $scope.doTabForecast = function(forecastType) {
            if (WeatherInfo.getEnabledCityCount() === 0) {
                var strError;
                var strAddLocation;
                $translate(['LOC_ERROR', 'LOC_ADD_LOCATIONS']).then(function (translations) {
                    strError = translations.LOC_ERROR;
                    strAddLocation = translations.LOC_ADD_LOCATIONS;
                }, function (translationIds) {
                    strError = translationIds.LOC_ERROR;
                    strAddLocation = translationIds.LOC_ADD_LOCATIONS;
                }).finally(function () {
                    $scope.showAlert(strError, strAddLocation);
                });
                return;
            }
            if ($location.path() === '/tab/forecast' && forecastType === 'forecast') {
                $scope.$broadcast('reloadEvent', 'tab');
                Util.ga.trackEvent('action', 'tab', 'reload');
            }
            else if ($location.path() === '/tab/dailyforecast' && forecastType === 'dailyforecast') {
                $scope.$broadcast('reloadEvent', 'tab');
                Util.ga.trackEvent('action', 'tab', 'reload');
            }
            else {
                if (window.cordova && window.cordova.plugins && window.cordova.plugins.Keyboard) {
                    if (cordova.plugins.Keyboard.isVisible) {
                        cordova.plugins.Keyboard.close();
                        setTimeout(function(){
                            if (forecastType === 'forecast') {
                                $location.path('/tab/forecast');
                            }
                            else {
                                $location.path('/tab/dailyforecast');
                            }
                        }, 100);
                        return;
                    }
                }

                if (forecastType === 'forecast') {
                    $location.path('/tab/forecast');
                }
                else {
                    $location.path('/tab/dailyforecast');
                }
            }
        };

        $scope.doTabShare = function() {
            if (!(window.plugins && window.plugins.socialsharing)) {
                console.log('plugins socialsharing is undefined');
                return;
            }
            var cityData = WeatherInfo.getCityOfIndex(WeatherInfo.getCityIndex());
            if (cityData == undefined || cityData.location == undefined) {
                console.log('Fail to load city');
                var strError;
                var strAddLocation;
                $translate(['LOC_ERROR', 'LOC_ADD_LOCATIONS']).then(function (translations) {
                    strError = translations.LOC_ERROR;
                    strAddLocation = translations.LOC_ADD_LOCATIONS;
                }, function (translationIds) {
                    strError = translationIds.LOC_ERROR;
                    strAddLocation = translationIds.LOC_ADD_LOCATIONS;
                }).finally(function () {
                    $scope.showAlert(strError, strAddLocation);
                });
                return;
            }

            var address = WeatherUtil.getShortenAddress(cityData.address);
            var t1h = cityData.currentWeather.t1h;
            var emoji = WeatherUtil.getWeatherEmoji(cityData.currentWeather.skyIcon);
            var tmx;
            var tmn;
            var summary = cityData.currentWeather.summary;
            var shareUrl = 'http://abr.ge/mxld';
            var len = cityData.dayTable.length;
            for(var i=0;i<len; i++) {
                var data = cityData.dayTable[i];
                if (data.fromToday == 0) {
                    tmx = data.tmx;
                    tmn = data.tmn;
                    break;
                }
            }
            var message = '';

            $translate(['LOC_CURRENT', 'LOC_HIGH', 'LOC_LOW', 'LOC_TODAYWEATHER']).then(function (translations) {
                message += address+'\n';
                message += translations.LOC_CURRENT+' '+t1h+'˚ ';
                message += emoji+'\n';
                message += translations.LOC_HIGH+' '+tmx+'˚, '+translations.LOC_LOW+' '+tmn+'˚\n';
                message += summary+'\n\n';
                message += translations.LOC_TODAYWEATHER + ' ' + shareUrl;
            }, function (translationIds) {
                message += address+'\n';
                message += translationIds.LOC_CURRENT+' '+t1h+'˚ ';
                message += emoji+'\n';
                message += translationIds.LOC_HIGH+' '+tmx+'˚, '+translationIds.LOC_LOW+' '+tmn+'˚\n';
                message += summary+'\n\n';
                message += translationIds.LOC_TODAYWEATHER + ' ' + shareUrl;
            }).finally(function () {
                window.plugins.socialsharing.share(message, null, null, null);
            });

            Util.ga.trackEvent('action', 'tab', 'share');
            if (!twClientConfig.debug && window.AirBridgePlugin) {
                AirBridgePlugin.goal("weathershare");
            }
        };

        var strOkay;
        var strCancel;
        $translate(['LOC_OK', 'LOC_CANCEL']).then(function (translations) {
            strOkay = translations.LOC_OK;
            strCancel = translations.LOC_CANCEL;
        }, function (translationIds) {
            strOkay = translationIds.LOC_OK;
            strCancel = translationIds.LOC_CANCEL;
        });

        $scope.showAlert = function(title, msg, callback) {
            var alertPopup = $ionicPopup.alert({
                title: title,
                template: msg,
                okText: strOkay
            });
            alertPopup.then(function() {
                console.log("alertPopup close");
                if (callback != undefined) {
                    callback();
                }
            });
        };

        $scope.showConfirm = function(title, template, callback) {
            var confirmPopup = $ionicPopup.confirm({
                title: title,
                template: template,
                okText: strOkay,
                cancelText: strCancel
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

        init();
    })

    .controller('GuideCtrl', function($scope, $rootScope, $ionicSlideBoxDelegate, $ionicNavBarDelegate,
                                      $location, Util, TwAds, $ionicPopup, WeatherInfo, $translate) {
        var guideVersion = null;

        $scope.data = { 'autoSearch': false };

        var strClose;
        var strSkip;
        var strCancel;
        var strOkay;
        var strUseYourCurrentLocation;
        var strFindLocationByName;
        var strTodayWeather;

        function init() {
            //for fast close ads when first loading
            TwAds.setShowAds(false);

            var bodyHeight;

            if (window.screen.height) {
                bodyHeight = window.screen.height;
            }
            else if (window.innerHeight) {
                bodyHeight = window.innerHeight;
            }
            else if (window.outerHeight) {
                bodyHeight = window.outerHeight;
            }
            else {
                console.log("Fail to get window height");
                bodyHeight = 640;
            }

            $scope.bigFont = (bodyHeight - 56) * 0.0512;
            $scope.smallFont = (bodyHeight - 56) * 0.0299;

            guideVersion = localStorage.getItem("guideVersion");

            $translate(['LOC_TODAYWEATHER', 'LOC_CLOSE', 'LOC_SKIP', 'LOC_CANCEL', 'LOC_OK', 'LOC_USE_YOUR_CURRENT_LOCATION', 'LOC_FIND_LOCATION_BY_NAME']).then(function (translations) {
                strTodayWeather = translations.LOC_TODAYWEATHER;
                strClose = translations.LOC_CLOSE;
                strSkip = translations.LOC_SKIP;
                strCancel = translations.LOC_CANCEL;
                strOkay = translations.LOC_OK;
                strUseYourCurrentLocation = translations.LOC_USE_YOUR_CURRENT_LOCATION;
                strFindLocationByName = translations.LOC_FIND_LOCATION_BY_NAME;
            }, function (translationIds) {
                strTodayWeather = translationIds.LOC_TODAYWEATHER;
                strClose = translationIds.LOC_CLOSE;
                strSkip = translationIds.LOC_SKIP;
                strCancel = translationIds.LOC_CANCEL;
                strOkay = translationIds.LOC_OK;
                strUseYourCurrentLocation = translationIds.LOC_USE_YOUR_CURRENT_LOCATION;
                strFindLocationByName = translationIds.LOC_FIND_LOCATION_BY_NAME;
            }).finally(function () {
                update();
            });
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
                $scope.rightText = strClose;
            } else {
                $scope.leftText = strSkip;
                $scope.rightText = ">";
            }
        }

        function showPopup() {
            var popup = $ionicPopup.show({
                template: '<ion-list>' +
                    '<ion-radio ng-model="data.autoSearch" ng-value="true">'+strUseYourCurrentLocation+'</ion-radio>' +
                    '<ion-radio ng-model="data.autoSearch" ng-value="false">'+strFindLocationByName+'</ion-radio>' +
                    '</ion-list>',
                title: strTodayWeather,
                scope: $scope,
                cssClass: 'ionic_popup',
                buttons: [
                    {
                        text: strCancel,
                        type: 'button_cancel'
                    },
                    {
                        text: strOkay,
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
                    Util.ga.trackEvent('action', 'click', 'auto search');
                    WeatherInfo.disableCity(false);
                    $location.path('/tab/forecast');
                } else {
                    Util.ga.trackEvent('action', 'click', 'city search');
                    $location.path('/tab/search');
                }
            });
        }

        $scope.onSlideChanged = function() {
            update();
        };

        $scope.onLeftClick = function() {
            if ($ionicSlideBoxDelegate.currentIndex() == $ionicSlideBoxDelegate.slidesCount() - 1) {
                Util.ga.trackEvent('action', 'click', 'guide previous');
                $ionicSlideBoxDelegate.previous();
            } else {
                Util.ga.trackEvent('action', 'click', 'guide skip');
                close();
            }
        };

        $scope.onRightClick = function() {
            if ($ionicSlideBoxDelegate.currentIndex() == $ionicSlideBoxDelegate.slidesCount() - 1) {
                Util.ga.trackEvent('action', 'click', 'guide close');
                close();
            } else {
                Util.ga.trackEvent('action', 'click', 'guide next');
                $ionicSlideBoxDelegate.next();
            }
        };

        $scope.onClose = function() {
            Util.ga.trackEvent('action', 'click', 'guide top close');
            close();
        };

        $scope.getGuideImg = function (number) {
            var imgPath;
            if (ionic.Platform.isAndroid()) {
                imgPath = "img/guide_android_0";
            }
            else {
                imgPath = "img/guide-0";
            }
            imgPath += ""+number+".png";
            console.log(imgPath);

            return imgPath;
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

