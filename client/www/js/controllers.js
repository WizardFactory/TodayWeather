
angular.module('starter.controllers', [])
    .controller('ForecastCtrl', function ($scope, $rootScope, $ionicPlatform, $ionicScrollDelegate,
                                          $ionicNavBarDelegate, $q, $http, $timeout, WeatherInfo, WeatherUtil, Util,
                                          Purchase, $stateParams, $location, $ionicHistory, $sce, $ionicLoading) {
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

        //{time: Number, t1h: Number, skyIcon: String, tmn: Number, tmx: Number, summary: String};
        //$scope.currentWeather;
        //{day: String, time: Number, t3h: Number, skyIcon: String, pop: Number, tempIcon: String, tempInfo: String, tmn: Number, tmx: Number}
        //$scope.timeTable = [];
        //{week: String, skyIcon:String, pop: Number, humidityIcon: String, reh: Number, tmn: Number, tmx: Number};
        //$scope.dayTable = [];
        //[{name: String, values:[{name: String, value: Number}]}]
        //$scope.timeChart;
        //[{values: Object, temp: Number}]
        //$scope.dayChart;

        //$scope.timeWidth; //total width of timeChart and timeTable
        //$scope.dayWidth; //total width of dayChart and dayTable
        $scope.imgPath = Util.imgPath;

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
        var imgBigTempPointSize;
        var imgBigSkyStateSize;
        var pCityInfo;
        var pSummary;
        var divWeatherInfo;
        var divBigInfoBox;

        var scrollHeight;
        var minBigDigitSize = 36;
        var minBigTempPointSize = 10;
        var minBigSkyStateSize = 21;
        var bodyFontSize = 12;
        var arrayWidth;

        function init() {
            Util.ga.trackEvent('page', 'tab', 'forecast');
            //identifyUser();
            $ionicHistory.clearHistory();

            console.log("UA:"+ionic.Platform.ua);
            console.log("Height:" + window.innerHeight + ", Width:" + window.innerWidth + ", PixelRatio:" + window.devicePixelRatio);
            console.log("OuterHeight:" + window.outerHeight + ", OuterWidth:" + window.outerWidth);
            console.log("ScreenHeight:"+window.screen.height+", ScreenWidth:"+window.screen.width);

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
                bodyWidth = window.outerHeight;
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

            if ($stateParams.fav !== undefined && $stateParams.fav < WeatherInfo.getCityCount()) {
                WeatherInfo.setCityIndex($stateParams.fav);
            }
            if (WeatherInfo.getEnabledCityCount() === 0) {
                $scope.showAlert('에러', '도시를 추가해주세요');
                return;
            }
            $scope.cityCount = WeatherInfo.getEnabledCityCount();

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
            if (
                (day.pty != undefined && day.pty > 0) ||
                (day.rn1 != undefined && day.rn1 > 0) ||
                (day.r06 != undefined && day.r06 > 0) ||
                (day.s06 != undefined && day.s06 > 0)
            )  {
                return true;
            }

            return false;
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

        /**
         * grade 값이 따라 색깔을 정한다.
         * @param grade
         * @returns {*}
         */
        //$scope.getGradeColor = function (grade) {
        //    switch (grade) {
        //        case 1:
        //            return "good";
        //        case 2:
        //            return "moderate";
        //        case 3:
        //            //return "unhealthy-for-sensitive";
        //            return "unhealthy";
        //        case 4:
        //            return "very-unhealthy";
        //        case 5:
        //            return "hazardous";
        //    }
        //    return "";
        //};

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
                    str += '<p class="subheading" style="letter-spacing: 0; margin: auto; padding: 2px;">' + '0시' + '</p>';
                }
                else {
                    str += '<p class="subheading" style="letter-spacing: 0; margin: auto; padding: 2px;">' + value.timeStr + '</p>';
                }
                str += '</div>';
            }
            str += '</div>';

            return str;

            str += '<div class="row row-no-padding">';
            str += '<div style="width: '+colWidth/2+'px;"></div>';
            for (i=1; i<cityData.timeTable.length; i++) {
                value = cityData.timeTable[i];
                if (value.currentIndex) {
                    str += '<div class="col table-items table-border" style="background-color: #039BE5; width:auto;">';
                }
                else {
                    str += '<div class="col table-items table-border" style="width:auto;">';
                }
                str += '<img width='+smallImageSize+'px height='+smallImageSize+'px style="margin: auto" src="'+Util.imgPath+'/'+ value.skyIcon+'.png">';
                str += '</div>';
            }
            str += '<div class="table-border" style="width: '+colWidth/2+'px;"></div>';
            str += '</div>';

            str += '<div class="row row-no-padding">';
            str += '<div style="width: '+colWidth/2+'px;"></div>';
            for (i=1; i<cityData.timeTable.length; i++) {
                value = cityData.timeTable[i];
                if (value.currentIndex) {
                    str += '<div class="col table-items table-border" style="background-color: #039BE5; width: auto">';
                }
                else {
                    str += '<div class="col table-items table-border" style="width: auto">';
                }
                if (value.pop) {
                    str += '<p class="subheading" style="letter-spacing:0; margin: auto">'+
                            //'<a class="icon ion-umbrella"></a>' +
                        value.pop + '<small>%</small></p>';
                }
                str += '<p class="caption" style="letter-spacing:0; margin: auto">';
                str += _makeRainSnowFallValueStr(value.pty, value.rn1, value.r06, value.s06, false);
                str += '<small">';
                str += _makeRainSnowFallSymbol(value.pty, value.rn1, value.r06, value.s06);
                str += '</small></p>';
                str += '</div>';
            }
            str += '<div class="table-border" style="width: '+colWidth/2+'px;"></div>';
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
                str +=  value.week + '</p>';
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

        function loadWeatherData() {
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

        /**
         * event가 두번 들어오는 경우가 있어 toggle은 사용 못함.
         * 값을 지정하여도, 반복해서 들어오는 경우가 있음. event 자체가 두번 불리는 것으로 보임
         * @param forecastType
         */
        $scope.changeForecastType = function(forecastType) {
            console.log("changeForecastType to "+forecastType);
            if (forecastType === 'short') {
                $location.path('/tab/forecast');
            }
            else if (forecastType === 'mid') {
                $location.path('/tab/dailyforecast');
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

        $scope.convertMMDD = function (value) {
            return value.substr(4,2)+'/'+value.substr(6,2);
        };

        $scope.diffTodayYesterday = function () {
            var current = cityData.currentWeather;
            var yesterday = cityData.currentWeather.yesterday;
            var str = "";

            if (current.t1h !== undefined && yesterday && yesterday.t1h !== undefined) {
                var diffTemp = Math.round(current.t1h) - Math.round(yesterday.t1h);

                str += "어제";
                if (diffTemp == 0) {
                    str += "와 동일";
                }
                else {
                    str += "보다 " + Math.abs(diffTemp);
                    if (diffTemp < 0) {
                        str += "˚낮음";
                    }
                    else if (diffTemp > 0) {
                        str += "˚높음";
                    }
                }
            }
            return str;
        };

        /**
         * 사용하지 않음.
         * @param value
         * @returns {string}
         */
        //$scope.getDayForecast = function (value) {
        //    var str = [];
        //    if (value.fromToday === 0 || value.fromToday === 1) {
        //        if (value.dustForecast && value.dustForecast.PM10Str) {
        //           str.push('미세예보:'+value.dustForecast.PM10Str);
        //        }
        //
        //        if (value.ultrvStr) {
        //            str.push('자외선:'+value.ultrvStr);
        //        }
        //        return str.toString();
        //    }
        //
        //    return str.toString();
        //};

        $scope.$on('reloadEvent', function(event) {
            console.log('called by update weather event');
            WeatherInfo.reloadCity(WeatherInfo.getCityIndex());
            loadWeatherData();
        });

        $scope.headerScroll = function drawShadow() {
            var rect = $ionicScrollDelegate.$getByHandle("body").getScrollPosition();
            if (rect.top > 0) {
                alphaBar.css('box-shadow','0px 1px 5px 0 rgba(0, 0, 0, 0.26)');
            }
            else {
                alphaBar.css('box-shadow','initial');
            }
        };

        init();
    })

    .controller('SearchCtrl', function ($scope, $rootScope, $ionicPlatform, $ionicScrollDelegate, TwAds, $q,
                                        $location, WeatherInfo, WeatherUtil, Util, ionicTimePicker, Push, $ionicLoading) {
        $scope.searchWord = undefined;
        $scope.searchResults = [];
        $scope.cityList = [];
        $scope.imgPath = Util.imgPath;
        $scope.isEditing = false;

        var towns = WeatherInfo.towns;
        var searchIndex = -1;

        function init() {
            Util.ga.trackEvent('page', 'tab', 'search');

            window.addEventListener('native.keyboardshow', function () {
                TwAds.setShowAds(false);
            });
            window.addEventListener('native.keyboardhide', function () {
                TwAds.setShowAds(true);
            });

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
                loadWeatherData(i);
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

            WeatherUtil.getWeatherInfo(address, WeatherInfo.towns).then(function (weatherDatas) {
                var city = WeatherUtil.convertWeatherData(weatherDatas);
                city.currentPosition = false;
                city.address = address;
                //검색하는 경우 location 정보가 없음. 업데이트 필요.
                //city.location = location;

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

                        Util.ga.trackEvent('weather', 'load', WeatherUtil.getShortenAddress(city.address), index);
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
                        WeatherUtil.getWeatherInfo(address, WeatherInfo.towns).then(function (weatherDatas) {
                            var city = WeatherUtil.convertWeatherData(weatherDatas);
                            city.currentPosition = true;
                            city.address = address;
                            city.location = {"lat": coords.latitude, "long": coords.longitude};
                            deferred.resolve(city);
                        }, function () {
                            deferred.reject();
                        });
                    }, function () {
                        deferred.reject();
                    });
                }, function () {
                    deferred.reject();
                });
            } else {
                WeatherUtil.getWeatherInfo(cityData.address, WeatherInfo.towns).then(function (weatherDatas) {
                    var city = WeatherUtil.convertWeatherData(weatherDatas);
                    city.currentPosition = false;
                    city.address = cityData.address;
                    deferred.resolve(city);
                }, function () {
                    deferred.reject();
                });
            }

            return deferred.promise;
        }

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

        $scope.showIcon = function () {
            if (ionic.Platform.isAndroid()) {
                return false;
            }
            return true;
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

        $scope.doTabForecast = function(forecastType) {
            if (WeatherInfo.getEnabledCityCount() === 0) {
                $scope.showAlert('에러', '도시를 추가해주세요');
                return;
            }
            if ($location.path() === '/tab/forecast' && forecastType === 'forecast') {
                $scope.$broadcast('reloadEvent');
                Util.ga.trackEvent('page', 'tab', 'reload');
            }
            else if ($location.path() === '/tab/dailyforecast' && forecastType === 'dailyforecast') {
                $scope.$broadcast('reloadEvent');
                Util.ga.trackEvent('page', 'tab', 'reload');
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

