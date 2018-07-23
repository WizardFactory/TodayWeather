// Ionic Starter App

// angular.module is a global place for creating, registering and retrieving Angular modules
// 'starter' is the name of this angular module example (also set in a <body> attribute in index.html)
// the 2nd parameter is an array of 'requires'
// 'starter.services' is found in service.run.js
// 'starter.controllers' is found in controller.forecastctrl.js
angular.module('starter', [
    'ionic',
    'pascalprecht.translate',
    'oc.lazyLoad',
    'ionic-timepicker',
    'service.weatherinfo',
    'service.weatherutil',
    'service.util',
    'service.admobclean',
    'service.admobpro',
    'service.twads',
    'service.push',
    'service.storage',
    'service.branch',
    'service.firebase',
    'controller.tabctrl',
    'controller.forecastctrl',
    'controller.air',
    'controller.searchctrl',
    'controller.settingctrl',
    'controller.guidectrl',
    'controller.purchase',
    'controller.units',
    'controller.start',
    'controller.nation',
    'controller.nation.air',
    'controller.setting.radio',
    'controller.push',
    'controller.kma.special'
])
    .factory('$exceptionHandler', function (Util) {
        return function (exception, cause) {
            console.log(exception, cause);
            if (Util && Util.ga) {
                if (exception) {
                    Util.ga.trackEvent('angular', 'error', exception.message);
                    Util.ga.trackException(exception.stack, true);
                }
                else {
                    Util.ga.trackEvent('angular', 'error', 'execption is null');
                }
            }
            else {
                console.log('util or util.ga is undefined');
            }
            if (clientConfig && clientConfig.debug) {
                alert("ERROR in " + exception);
            }
        }
    })
    .run(function($rootScope, $ionicPlatform, $location, $state, TwStorage, WeatherInfo, Units, Util, Push,
        Branch, Purchase, WeatherUtil) {
        if (clientConfig.debug) {
            Util.ga.debugMode();
        }

        $rootScope.package = clientConfig.package;
        $rootScope.title = clientConfig.package === 'todayWeather' ? 'LOC_TODAYWEATHER' : 'LOC_TODAYAIR';
        if (ionic.Platform.isIOS()) {
            Util.ga.startTrackerWithId(clientConfig.gaIOSKey);
        }
        else if (ionic.Platform.isAndroid()) {
            Util.ga.startTrackerWithId(clientConfig.gaAndroidKey, 30);
        }

        function checkLocationMode() {
            if (ionic.Platform.isIOS()) {

                // isLocationEnabled 요청해야 registerLocationStateChangeHandler가 호출됨
                if (window.cordova && window.cordova.plugins && window.cordova.plugins.diagnostic) {
                    cordova.plugins.diagnostic.isLocationEnabled(function (enabled) {
                        console.log("Location setting is " + (enabled ? "enabled" : "disabled"));
                        //TW,TA는 GRANTED_WHEN_IN_USE만 사용하고 있음
                        if (enabled) {
                            cordova.plugins.diagnostic.getLocationAuthorizationStatus(function(status){
                                Util.locationStatus = status;
                                switch(status){
                                    case cordova.plugins.diagnostic.permissionStatus.NOT_REQUESTED:
                                        console.log("Permission not requested");
                                        break;
                                    case cordova.plugins.diagnostic.permissionStatus.DENIED:
                                        console.log("Permission denied");
                                        break;
                                    case cordova.plugins.diagnostic.permissionStatus.GRANTED:
                                        console.log("Permission granted always");
                                        break;
                                    case cordova.plugins.diagnostic.permissionStatus.GRANTED_WHEN_IN_USE:
                                        console.log("Permission granted only when in use");
                                        break;
                                }
                            }, function(error){
                                console.error("The following error occurred: "+error);
                            });
                        }
                    }, function (error) {
                        console.error("Error getting for location enabled status: " + error);
                    });
                }
            }
            else if (ionic.Platform.isAndroid()) {
                // android는 실행 시 registerLocationStateChangeHandler 호출되지 않으므로 직접 locationMode를 가져와서 설정함
                if (window.cordova && window.cordova.plugins && window.cordova.plugins.diagnostic) {
                    cordova.plugins.diagnostic.getLocationMode(function(locationMode) {
                        Util.locationStatus = locationMode;
                    }, function(error) {
                        console.error("Error getting for location mode: " + error);
                    });
                }
            }
            else {
                console.log("Error : Unknown platform");
            }
        }

        checkLocationMode();

        Util.ga.platformReady();

        Util.ga.enableUncaughtExceptionReporting(true);
        Util.ga.setAllowIDFACollection(true);

        Util.language = navigator.userLanguage || navigator.language;
        if (navigator.globalization) {
            navigator.globalization.getLocaleName(
                function (locale) {
                    console.log(locale);
                    //"ko-Kore-KR"
                    var valueArray = locale.value.split('-');
                    Util.region = valueArray[valueArray.length-1];
                    console.log('region: ' + Util.region + '\n');
                },
                function () {
                    console.log('Error getting locale\n');
                }
            );
        }
        else {
            if (navigator.languages) {
               for (var i=0; i<navigator.languages.length; i++)  {
                   var langArray = navigator.languages[i].split('-');
                   if (langArray.length > 1) {
                       Util.region = langArray[langArray.length-1];
                       break;
                   }
               }
            }
            Util.region = Util.region || 'KR';
            console.log('region: ' + Util.region + '\n');
        }

        if (window.cordova && cordova.getAppVersion) {
            //정보 가지고 오는 속도가 느림.
            cordova.getAppVersion.getVersionNumber().then(function (version) {
                $rootScope.version = version;
                Util.version = version;
                Util.ga.trackEvent('app', 'version', Util.version);
            });
        }
        else {
            //getAppVersion plugin이 없으면 update.info.js 사용함.
            $rootScope.version = Util.version = window[clientConfig.package].appVersion;
        }

        Util.ga.trackEvent('app', 'language', Util.language);

        if (window.hasOwnProperty("device")) {
            Util.uuid = window.device.uuid;
            Util.ga.trackEvent('app', 'uuid', window.device.uuid);
        }

        if (window.screen) {
            Util.ga.trackEvent('app', 'screen width', window.screen.width);
            Util.ga.trackEvent('app', 'screen height', window.screen.height);
        }
        else if (window.outerHeight) {
            Util.ga.trackEvent('app', 'outer width', window.outerWidth);
            Util.ga.trackEvent('app', 'outer height', window.outerHeight);
        }
        else {
            console.log("Height:" + window.innerHeight + ", Width:" + window.innerWidth + ", PixelRatio:" + window.devicePixelRatio);
        }

        Util.ga.trackEvent('app', 'ua', ionic.Platform.ua);

        /**
         * #2053 url이 undefined일 수 있음.
         * @param msg
         * @param url
         * @param line
         * @returns {boolean}
         */
        window.onerror = function(msg, url, line) {
            if (typeof url === 'string') {
                var idx = url.lastIndexOf("/");
                if(idx > -1) {url = url.substring(idx+1);}
            }
            var errorMsg = "ERROR in " + url + " (line #" + line + "): " + msg;
            Util.ga.trackEvent('window', 'error', errorMsg);
            Util.ga.trackException(errorMsg, true);
            if (clientConfig && clientConfig.debug) {
                alert("ERROR in " + url + " (line #" + line + "): " + msg);
            }
            return false; //suppress Error Alert;
        };

        document.addEventListener("resume", function() {
            Util.ga.trackEvent('app', 'status', 'resume');
            checkLocationMode();
        }, false);
        document.addEventListener("pause", function() {
            Util.ga.trackEvent('app', 'status', 'pause');
        }, false);

        /**
         * branchInit의 경우 run() function에서 실행하면 resume에서 충돌나서 따로 잡음 TW-261
         */
        $ionicPlatform.on("deviceready", function() {
            Branch.branchInit();
        });

        $ionicPlatform.on('resume', function(){
            Branch.branchInit();
            $rootScope.$broadcast('reloadEvent', 'resume');
        });

        if (window.cordova && window.cordova.plugins && window.cordova.plugins.diagnostic) {
            // ios는 실행 시 registerLocationStateChangeHandler 호출되어 locationStatus가 설정됨
            cordova.plugins.diagnostic.registerLocationStateChangeHandler(function (state) {
                var oldLocationEnabled = Util.isLocationEnabled();

                console.log("Location state changed to: " + state);
                Util.locationStatus = state;

                Util.ga.trackEvent('position', 'status', state);

                if (oldLocationEnabled === false && Util.isLocationEnabled()) {
                    $rootScope.$broadcast('reloadEvent', 'locationOn');
                }
            }, function (error) {
                console.error("Error registering for location state changes: " + error);
                Util.ga.trackEvent('position', 'error', 'registerLocationStateChange');
            });
        }
        else {
            Util.ga.trackEvent('plugin', 'error', 'loadDiagnostic')
        }

        if (ionic.Platform.isIOS()) {
           //
        } else if (ionic.Platform.isAndroid()) {
            if(window.MobileAccessibility){
                console.log("set usePreferredTextZoom to false");
                window.MobileAccessibility.usePreferredTextZoom(false);
            }
        }

        // Hide the accessory bar by default (remove this to show the accessory bar above the keyboard
        // for form inputs)
        if (window.cordova && window.cordova.plugins && window.cordova.plugins.Keyboard) {
            cordova.plugins.Keyboard.hideKeyboardAccessoryBar(true);
            cordova.plugins.Keyboard.disableScroll(true);
        }

        $rootScope.$on('$ionicView.beforeEnter', function() {
            if (navigator.splashscreen) {
                console.log('splash screen hide!!!');
                navigator.splashscreen.hide();
            }

            var body = angular.element(document.querySelectorAll('body'));
            body.removeClass('search forecast dailyforecast air start setting push');
            body.addClass($rootScope.state);

            if (window.StatusBar) {
                if ($rootScope.settingsInfo.theme === 'light') {
                    StatusBar.styleDefault();
                } else { //photo, dark, old
                    StatusBar.styleLightContent();
                }
            }
        });

        $rootScope.$on('$stateChangeStart', function(event, toState, toParams, fromState) {
            var headerbars = angular.element(document.querySelectorAll('ion-header-bar'));
            headerbars.removeClass('bar-clear');
            for (var i = 0; i < headerbars.length; i++) {
                headerbars[i].style.backgroundImage = "";
            }

            if (toState.name === 'tab.search') {
                $rootScope.state = 'search';
            } else if (toState.name === 'tab.forecast' || toState.name === 'tab.weather') {
                $rootScope.state = 'forecast';
            } else if (toState.name === 'tab.dailyforecast') {
                $rootScope.state = 'dailyforecast';
            } else if (toState.name === 'tab.air') {
                $rootScope.state = 'air';
            } else if (toState.name === 'start') {
                $rootScope.state = 'start';
            } else if (toState.name === 'setting-radio' || toState.name === 'units') {
                $rootScope.state = 'setting';
            } else if (toState.name === 'setting-push') {
                $rootScope.state = 'push';
            } else { // 'nation', 'guide', 'purchase'
                $rootScope.state = '';
            }

            if (fromState.name === '') {
                var body = angular.element(document.querySelectorAll('body'));
                body.addClass($rootScope.state);
            }

            Util.ga.trackView(toState.name);
        });

        TwStorage.init().finally(function() {
            $rootScope.iconsImgPath = window.theme[$rootScope.settingsInfo.theme].icons;
            $rootScope.weatherImgPath = window.theme[$rootScope.settingsInfo.theme].weather;

            WeatherInfo.loadCities();
            if (Push.init() === true) {
                //show notify alert info popup
                setTimeout(function () {
                    Util.ga.trackEvent('app', 'event', 'triggerShowAlertInfoEvent');
                    $rootScope.$broadcast('showAlertInfoEvent');
                }, 500);
            }
            Purchase.init();
            Units.loadUnits();

            window.addEventListener('online',  function () {
                WeatherInfo.loadWeatherPhotos();
            });

            var daumServiceKeys = TwStorage.get("daumServiceKeys");
            if (daumServiceKeys == undefined || daumServiceKeys.length != clientConfig.daumServiceKeys.length) {
                TwStorage.set("daumServiceKeys", clientConfig.daumServiceKeys);
            }

            var startVersion = TwStorage.get("startVersion");
            if (startVersion === null || Util.startVersion > Number(startVersion)) {
                Util.ga.trackEvent('app', 'startupPage', 'start');
                $location.path('/start');
                return;
            }

            var startupPage = $rootScope.settingsInfo.startupPage;
            Util.ga.trackEvent('app', 'startupPage', startupPage);

            if (startupPage === "0") { //시간별날씨
                $state.go('tab.forecast');
            } else if (startupPage === "1") { //일별날씨
                $state.go('tab.dailyforecast');
            } else if (startupPage === "2") { //즐겨찾기
                $state.go('tab.search');
            } else if (startupPage === "3") { //대기정보
                $state.go('tab.air');
            } else if (startupPage === "4") { //날씨
                $state.go('tab.weather');
            } else {
                console.error('unknown page:'+startupPage);
                if (clientConfig.package === 'todayWeather') {
                    $state.go('tab.forecast');
                }
                else if (clientConfig.package === 'todayAir') {
                    $state.go('tab.air');
                }
            }

            function showUpdateInfo(triggerTime) {
                var lastAppVersion = TwStorage.get("appVersion");
                if (lastAppVersion != Util.version) {
                    var logMsg = 'from '+lastAppVersion+' to '+Util.version;
                    Util.ga.trackEvent('app', 'update', logMsg);
                    TwStorage.set('appVersion', Util.version);
                    if (window[clientConfig.package] && window[clientConfig.package].enablePopup === true) {
                        console.log('disable update info ');
                        TwStorage.set('disableUpdateInfo', false);
                    }
                }

                if (TwStorage.get('disableUpdateInfo') !== true) {
                    //바로 보내면, tabCtrl에서 못 받음.
                    setTimeout(function () {
                        Util.ga.trackEvent('app', 'update', 'triggerShowUpdateInfo');
                        $rootScope.$broadcast('showUpdateInfoEvent');
                    }, triggerTime);
                }
            }

            if (Util.version) {
               showUpdateInfo(500);
            }
            else {
                Util.ga.trackEvent('app', 'update', 'waitGetAppVersion');
                $rootScope.$watch('version', function (newValue) {
                    if(newValue == undefined) {
                        console.warn('failToLoadAppVersion');
                        return;
                    }

                    showUpdateInfo(100);
                });
            }
        });
    })
    .config(function($stateProvider, $urlRouterProvider, $ionicConfigProvider, $compileProvider,
                     ionicTimePickerProvider, $translateProvider) {

        $translateProvider
            .useStaticFilesLoader({
                prefix: 'locales/',
                suffix: '.json'
            })
            .registerAvailableLanguageKeys(['en', 'de', 'ko', 'ja', 'zh-CN', 'zh-TW'], {
                'en_*': 'en',
                'de_*': 'de',
                'ko_*': 'ko',
                'ja_*': 'ja',
                'zh_HK': 'zh-TW',
                'zh_TW': 'zh-TW',
                'zh_*': 'zh-CN'
            })
            .preferredLanguage('en')
            .fallbackLanguage('en')
            .determinePreferredLanguage()
            .useSanitizeValueStrategy('escapeParameters');

        //$compileProvider.debugInfoEnabled(clientConfig.debug);
        $compileProvider.debugInfoEnabled(false);

        $compileProvider.aHrefSanitizationWhitelist(/^\s*(https?|file|ftp|mailto):/);
        $compileProvider.imgSrcSanitizationWhitelist(/^\s*(https?|file|ftp|mailto):/);

        $compileProvider.directive('ngShortChart', function() {
            return {
                restrict: 'A',
                transclude: true,
                link: function (scope, iElement) {
                    var marginTop = 12;
                    var textTop = 5;
                    var margin = {top: marginTop, right: 0, bottom: 12, left: 0, textTop: textTop};
                    var width, height, x, y;
                    var svg, initLine, line;
                    var displayItemCount = 0;
                    var sharp = false; //3시간 단위의 정각

                    function initSvg() {
                        //0.9.1까지 displayItemCount가 없음.
                        displayItemCount = scope.timeChart[1].displayItemCount;
                        if (displayItemCount == undefined || displayItemCount == 0) {
                            displayItemCount = 3;
                        }

                        console.log('scope watch');
                        var shortTableHeight = scope.getShortTableHeight(displayItemCount);
                        margin.top = marginTop + shortTableHeight;
                        margin.textTop = textTop - shortTableHeight;

                        x = d3.scale.ordinal().rangeBands([margin.left, width - margin.right]);
                        y = d3.scale.linear().range([height - margin.bottom, margin.top]);

                        if (svg != undefined) {
                            svg.selectAll("*").remove();
                            svg.attr('width', width)
                               .attr('height', height);
                        }
                        else {
                            svg = d3.select(iElement[0]).append('svg')
                                .attr('width', width)
                                .attr('height', height);
                        }

                        initLine = d3.svg.line()
                            .interpolate('linear')
                            .x(function (d, i) {
                                if (sharp === false) {
                                    //timeChart[0] -> yesterday, timeChart[1] -> today
                                    if (i === scope.timeChart[1].currentIndex + 1) {
                                        return (x.rangeBand() * i - x.rangeBand() / 2) + x.rangeBand() / 2;
                                    }
                                    //현재 시간이 hour % 3 != 0인 경우, 현재 시간 이후의 데이터의 x위치는 i - 1에 위치 설정
                                    else if (i > scope.timeChart[1].currentIndex + 1) {
                                        return x.rangeBand() * (i - 1) + x.rangeBand() / 2;
                                    }
                                }
                                return x.rangeBand() * i + x.rangeBand() / 2;
                            })
                            .y(height);

                        line = d3.svg.line()
                            .interpolate('linear')
                            .x(function (d, i) {
                                if (sharp === false) {
                                    if (i === scope.timeChart[1].currentIndex + 1) {
                                        return (x.rangeBand() * i - x.rangeBand() / 2) + x.rangeBand() / 2;
                                    }
                                    else if (i > scope.timeChart[1].currentIndex + 1) {
                                        return x.rangeBand() * (i - 1) + x.rangeBand() / 2;
                                    }
                                }
                                return x.rangeBand() * i + x.rangeBand() / 2;
                            })
                            .y(function (d) {
                                return y(d.value.t3h);
                            });
                    }

                    //parent element의 heigt가 변경되면, svg에 있는 모든 element를 지우고, height를 변경 다시 그림.
                    //chart가 나오지 않는 경우에는 height가 0이므로 그때는 동작하지 않음.
                    //element height는 광고 제거,추가 그리고 시간별,요일별 로 변경될때 변경됨.
                    scope.$watch(function () {
                        return iElement[0].getBoundingClientRect().height;
                    }, function(newValue) {
                        if (newValue === 0 || newValue === height) {
                            return;
                        }
                        width = iElement[0].getBoundingClientRect().width;
                        height = iElement[0].getBoundingClientRect().height;

                        if (!(scope.timeChart == undefined)) {
                            initSvg();
                            chart();
                        }
                    });

                    var chart = function () {
                        var data = scope.timeChart;

                        if (x == undefined || y == undefined || svg == undefined || data == undefined) {
                            return;
                        }

                        var currentTime = scope.currentWeather.time;
                        var currentTemp = scope.currentWeather.t1h;

                        if ((scope.currentWeather.liveTime === null || currentTime+'00' == scope.currentWeather.liveTime) && (currentTime % 3 == 0)) {
                            sharp = true;
                        } else {
                            sharp = false;
                        }

                        x.domain(d3.range(data[0].values.length));
                        y.domain([
                            d3.min(data, function (c) {
                                var minT3h = d3.min(c.values, function (v) {
                                    return v.value.t3h;
                                });
                                return minT3h<currentTemp?minT3h:currentTemp;
                            }),
                            d3.max(data, function (c) {
                                var maxT3h =d3.max(c.values, function (v) {
                                    return v.value.t3h;
                                });
                                return maxT3h>currentTemp?maxT3h:currentTemp;
                            })
                        ]).nice();

                        d3.svg.axis()
                            .scale(x)
                            .orient('bottom');

                        d3.svg.axis()
                            .scale(y)
                            .orient('left');

                        var currentRect = svg.selectAll('.current-rect').data(function () {
                            return [data[1].currentIndex];
                        });

                        currentRect.enter().append('rect')
                            .attr('class', 'current-rect');

                        currentRect
                            .attr('x', function (index) {
                                return x.rangeBand() * index + x.rangeBand() / 2 + 0.5;
                            })
                            .attr('y', function () {
                                return 0;
                            })
                            .attr('width', x.rangeBand() - 0.5)
                            .attr('height', height);

                        currentRect.exit().remove();

                        // draw guideLine
                        var guideLines = svg.selectAll('.guide-line')
                            .data(function () {
                                return data[1].values;
                            });

                        guideLines.enter().append('line')
                            .attr('class', function (d) {
                                if (d.value.time === 24) {
                                    return 'guide-vivid-line';
                                } else {
                                    return 'guide-line';
                                }
                            })
                            .attr('x1', function (d, i) {
                                return x.rangeBand() * i + x.rangeBand() / 2+0.5;
                            })
                            .attr('x2', function (d, i) {
                                return x.rangeBand() * i + x.rangeBand() / 2+0.5;
                            })
                            .attr('y1', 0)
                            .attr('y2', height);

                        guideLines.exit().remove();

                        var hourlyTables = svg.selectAll('.hourly-table')
                            .data(function () {
                                return data[1].values;
                            });

                        var hourObject = hourlyTables.enter()
                            .append('g')
                            .attr('class', 'hourly-table');

                        hourObject.append("svg:image")
                            .attr("xlink:href", function (d) {
                               return scope.weatherImgPath + "/" + d.value.skyIcon + ".png";
                            })
                            .attr("x", function (d, i) {
                                return x.rangeBand() * i - scope.smallImageSize/2;
                            })
                            .attr("y", 0)
                            .attr("width", scope.smallImageSize)
                            .attr("height", scope.smallImageSize);

                        hourObject.append("text")
                            .attr('class', 'chart-text')
                            .attr("x", function (d, i) {
                                return x.rangeBand() * i;
                            })
                            .attr("y", function(){
                                if (displayItemCount >=1) {
                                    return scope.smallImageSize+12;//margin top
                                }
                            })
                            .text(function (d) {
                                return d.value.pop;
                            })
                            .append('tspan')
                            .attr('class', 'chart-unit-text')
                            .text('%');

                        hourObject.append("text")
                            .attr('class', 'chart-sub-text')
                            .attr("x", function (d, i) {
                                return x.rangeBand() * i;
                            })
                            .attr("y", function () {
                                var y = 12; //margin top
                                if (displayItemCount >=1) {
                                    y += scope.smallImageSize;
                                }
                                if (displayItemCount >=2) {
                                    y += 15;//pop body1
                                }
                                return y - 3;
                            })
                            .text(function (d) {
                                if (d.value.rn1) {
                                    return d.value.rn1>=10?Math.round(d.value.rn1):d.value.rn1;
                                }
                                else if (d.value.s06) {
                                    return d.value.s06>=10?Math.round(d.value.s06):d.value.s06;
                                }
                                else if (d.value.r06) {
                                    return d.value.r06>=10?Math.round(d.value.r06):d.value.r06;
                                }
                                return '';
                            })
                            .append('tspan')
                            .attr('class', 'chart-unit-text')
                            .text(function (d) {
                                if (d.value.rn1 || d.value.s06 || d.value.r06) {
                                    return scope.getPrecipUnit(d.value);
                                }
                                return '';
                            });

                        hourObject.filter(function(d, i) {
                           return i == 0;
                        }).remove();

                        var lineGroups = svg.selectAll('.line-group')
                            .data(data);

                        lineGroups.enter()
                            .append('g')
                            .attr('class', 'line-group');

                        // draw line
                        var lines = lineGroups.selectAll('.line')
                            .data(function(d) {
                                var cloneData = JSON.parse(JSON.stringify(d));
                                if (sharp === false) {
                                    var currentWeather = {name: d.name};
                                    if (d.name == "today") {
                                        currentWeather.value = scope.currentWeather;
                                        currentWeather.value.t3h = currentWeather.value.t1h;
                                    }
                                    else if (d.name == 'yesterday') {
                                        currentWeather.value = scope.currentWeather.yesterday;
                                        currentWeather.value.t3h = currentWeather.value.t1h;
                                    }
                                    cloneData.values.splice(data[1].currentIndex+1, 0, currentWeather);
                                }
                                return [cloneData];
                            })
                            .attr('d', function (d) {
                                return initLine(d.values);
                            });

                        lines.enter()
                            .append('path')
                            .attr('class', function (d) {
                                return 'line line-' + d.name;
                            })
                            .attr('d', function (d) {
                                return initLine(d.values);
                            });

                        lines.attr('d', function (d) {
                            return line(d.values);
                        });

                        // draw point
                        var linePoints = lineGroups.selectAll('.line-point')
                            .data(function (d) {
                                return [d];
                            });

                        linePoints.enter()
                            .append('g')
                            .attr('class', 'line-point');

                        var circles = linePoints.selectAll('circle')
                            .data(function (d) {
                                return d.values;
                            })
                            .attr('cy', height);

                        circles.enter()
                            .append('circle')
                            .attr('class', function (d) {
                                return 'circle-' + d.name;
                            })
                            .attr('r', 10)
                            .attr('cx', function (d, i) {
                                return x.rangeBand() * i + x.rangeBand() / 2;
                            })
                            .attr('cy', height);

                        circles.attr('cy', function (d) {
                            return y(d.value.t3h);
                        });

                        circles.exit()
                            .remove();

                        // draw current point
                        var point = lineGroups.selectAll('.point')
                            .data(function(d) {
                                return [d];
                            })
                            .attr('r', function () {
                                if (sharp === true) {
                                    return 10;
                                } else {
                                    return 5;
                                }
                            })
                            .attr('cx', function () {
                                var x1 = data[1].currentIndex;
                                if (sharp === true) {
                                    x1 += 0;
                                }
                                else {
                                    x1 += 0.5;
                                }
                                return x.rangeBand() * x1 + x.rangeBand() / 2;
                            })
                            .attr('cy', height);

                        point.enter()
                            .append('circle')
                            .attr('class', function (d) {
                                return 'point circle-' + d.name + '-current';
                            })
                            .attr('r', function () {
                                if (sharp === true) {
                                    return 10;
                                } else {
                                    return 5;
                                }
                            })
                            .attr('cx', function () {
                                var x1 = data[1].currentIndex;
                                if (sharp === true) {
                                    x1 += 0;
                                }
                                else {
                                    x1 += 0.5;
                                }
                                return x.rangeBand() * x1 + x.rangeBand() / 2;
                            })
                            .attr('cy', height);

                        point.attr('cx', function () {
                            var x1 = data[1].currentIndex;
                            if (sharp === true) {
                                x1 += 0;
                            }
                            else {
                                x1 += 0.5;
                            }
                            return x.rangeBand() * x1 + x.rangeBand() / 2;
                        })
                        .attr('cy', function (d) {
                            if (d.name === "today") {
                                return y(scope.currentWeather.t1h);
                            }
                            else if (d.name === "yesterday") {
                                return  y(scope.currentWeather.yesterday.t1h);
                            }
                        });

                        point.exit()
                            .remove();

                        // draw value
                        var lineValues = lineGroups.selectAll('.line-value')
                            .data(function (d) {
                                return [d];
                            });

                        lineValues.enter()
                            .append('g')
                            .attr('class', 'line-value');

                        var texts = lineValues.selectAll('text')
                            .data(function (d) {
                                return d.values;
                            })
                            .attr('y', height - margin.bottom + margin.textTop)
                            .text(function (d) {
                                return Math.round(d.value.t3h);
                            });

                        texts.enter()
                            .append('text')
                            .attr('class', function (d, i) {
                                if (sharp === true && i === data[1].currentIndex + 1) {
                                    return 'text-' + d.name + '-current';
                                }
                                return 'text-' + d.name;
                            })
                            .attr('dy', margin.top)
                            .attr('x', function (d, i) {
                                return x.rangeBand() * i + x.rangeBand() / 2;
                            })
                            .attr('y', height - margin.bottom + margin.textTop)
                            .text(function (d) {
                                return Math.round(d.value.t3h);
                            });

                        texts.attr('y', function (d) {
                            return y(d.value.t3h) - margin.bottom + margin.textTop;
                        });

                        texts.exit()
                            .remove();
                    };

                    scope.$watch('timeWidth', function(newValue) {
                        //guide에서 나올때, 점들이 모이는 증상이 있음.
                        if (newValue == undefined || newValue == width) {
                            console.log('new value is undefined or already set same width='+width);
                            return;
                        }

                        console.log('update timeWidth='+newValue);
                        width = newValue;

                        return;
                        //if (scope.timeChart == undefined) {
                        //    console.log('time chart is undefined in timeWidth');
                        //    return;
                        //}
                        //
                        //if (svg == undefined) {
                        //    console.log('svg is undefined in timeWidth');
                        //    initSvg();
                        //}
                        //else {
                        //    x = d3.scale.ordinal().rangeBands([margin.left, width - margin.right]);
                        //    svg.attr('width', width);
                        //    svg.selectAll("*").remove();
                        //}
                        //chart();
                    });

                    scope.$watch('timeChart', function (newVal) {
                        if (newVal) {
                            console.log("update timeChart");
                            if (scope.timeChart == undefined) {
                                console.log("time chart is undefined");
                                return;
                            }
                            //if (svg == undefined) {
                            //    initSvg();
                            //    console.log('svg is undefined in timeChart');
                            //}
                            //else {
                            //    var shortTableHeight = scope.getShortTableHeight(displayItemCount);
                            //    margin.top = marginTop + shortTableHeight;
                            //    margin.textTop = textTop - shortTableHeight;
                            //    y = d3.scale.linear().range([height - margin.bottom, margin.top]);
                            //    svg.selectAll('.hourly-table').remove();
                            //}
                            initSvg();
                            chart();
                        }
                    });
                }
            };
        });

        $compileProvider.directive('ngShortDetailChart', function() {
            return {
                restrict: 'A',
                transclude: true,
                link: function (scope, iElement) {
                    var margin = 12;
                    var textTop = 12;
                    var width, height, x, y;
                    var svg;

                    function initSvg() {
                        console.log('scope watch');

                        x = d3.scale.ordinal().rangeBands([0, width]);
                        y = d3.scale.linear().range([height, 0]);

                        if (svg != undefined) {
                            svg.selectAll("*").remove();
                            svg.attr('width', width)
                                .attr('height', height);
                        }
                        else {
                            svg = d3.select(iElement[0]).append('svg')
                                .attr('width', width)
                                .attr('height', height);
                        }
                    }

                    //parent element의 heigt가 변경되면, svg에 있는 모든 element를 지우고, height를 변경 다시 그림.
                    //chart가 나오지 않는 경우에는 height가 0이므로 그때는 동작하지 않음.
                    //element height는 광고 제거,추가 그리고 시간별,요일별 로 변경될때 변경됨.
                    scope.$watch(function () {
                        return iElement[0].getBoundingClientRect().height;
                    }, function(newValue) {
                        if (newValue === 0 || newValue === height) {
                            return;
                        }
                        width = iElement[0].getBoundingClientRect().width;
                        height = iElement[0].getBoundingClientRect().height;

                        if (!(scope.timeChart == undefined)) {
                            initSvg();
                            chart();
                        }
                    });

                    var chart = function () {
                        var data = scope.timeChart;

                        if (x == undefined || y == undefined || svg == undefined || data == undefined) {
                            return;
                        }

                        x.domain(d3.range(data[0].values.length));

                        d3.svg.axis()
                            .scale(x)
                            .orient('bottom');

                        var currentRect = svg.selectAll('.current-rect').data(function () {
                            return [data[1].currentIndex];
                        });

                        currentRect.enter().append('rect')
                            .attr('class', 'current-rect');

                        currentRect
                            .attr('x', function (index) {
                                return x.rangeBand() * index + x.rangeBand() / 2 + 0.5;
                            })
                            .attr('y', function () {
                                return 0;
                            })
                            .attr('width', x.rangeBand() - 0.5)
                            .attr('height', height);

                        currentRect.exit().remove();

                        // draw guideLine
                        var guideLines = svg.selectAll('.guide-line')
                            .data(function () {
                                return data[1].values;
                            });

                        guideLines.enter().append('line')
                            .attr('class', function (d) {
                                if (d.value.time === 24) {
                                    return 'guide-vivid-line';
                                } else {
                                    return 'guide-line';
                                }
                            })
                            .attr('x1', function (d, i) {
                                return x.rangeBand() * i + x.rangeBand() / 2+0.5;
                            })
                            .attr('x2', function (d, i) {
                                return x.rangeBand() * i + x.rangeBand() / 2+0.5;
                            })
                            .attr('y1', 0)
                            .attr('y2', height);

                        guideLines.exit().remove();

                        var hourlyTables = svg.selectAll('.hourly-table')
                            .data(function () {
                                return data[1].values;
                            });

                        var hourObject = hourlyTables.enter()
                            .append('g')
                            .attr('class', 'hourly-table');

                        hourObject.append("svg:image")
                            .attr("xlink:href", function (d) {
                                return scope.iconsImgPath + "/wind_direction.png";
                            })
                            .attr("x", function (d, i) {
                                return x.rangeBand() * i - scope.smallImageSize/2;
                            })
                            .attr("y", margin / 2)
                            .attr("width", scope.smallImageSize)
                            .attr("height", scope.smallImageSize)
                            .attr('transform', function (d, i) {
                                return 'rotate(' + d.value.vec + ', ' + (x.rangeBand() * i) + ', ' + (margin + scope.smallImageSize) / 2 + ')';
                            });

                        hourObject.append("text")
                            .attr('class', 'chart-text')
                            .attr("x", function (d, i) {
                                return x.rangeBand() * i;
                            })
                            .attr("y", function(){
                                return margin / 2 + scope.smallImageSize + textTop;
                            })
                            .text(function (d) {
                                return d.value.wsd;
                            })
                            .append('tspan')
                            .attr('class', 'chart-unit-text')
                            .text(function () {
                                return scope.getWindSpdUnit();
                            });

                        hourObject.append("svg:image")
                            .attr("xlink:href", function (d) {
                                var reh = d.value.reh? d.value.reh - d.value.reh % 10 : '00';
                                return scope.iconsImgPath + "/humidity_" + reh +".png";
                            })
                            .attr("x", function (d, i) {
                                return x.rangeBand() * i - scope.smallImageSize/2;
                            })
                            .attr("y", function () {
                                return margin / 2 + scope.smallImageSize + textTop + margin;
                            })
                            .attr("width", scope.smallImageSize)
                            .attr("height", scope.smallImageSize);

                        hourObject.append("text")
                            .attr('class', 'chart-text')
                            .attr("x", function (d, i) {
                                return x.rangeBand() * i;
                            })
                            .attr("y", function () {
                                return margin / 2 + scope.smallImageSize * 2 + textTop + margin + textTop;
                            })
                            .text(function (d) {
                                return d.value.reh;
                            })
                            .append('tspan')
                            .attr('class', 'chart-unit-text')
                            .text('%');

                        hourObject.filter(function(d, i) {
                            return i == 0;
                        }).remove();
                    };

                    scope.$watch('timeWidth', function(newValue) {
                        //guide에서 나올때, 점들이 모이는 증상이 있음.
                        if (newValue == undefined || newValue == width) {
                            console.log('new value is undefined or already set same width='+width);
                            return;
                        }

                        console.log('update timeWidth='+newValue);
                        width = newValue;

                        return;
                    });

                    scope.$watch('timeChart', function (newVal) {
                        if (newVal) {
                            console.log("update timeChart");
                            if (scope.timeChart == undefined) {
                                console.log("time chart is undefined");
                                return;
                            }
                            initSvg();
                            chart();
                        }
                    });
                }
            };
        });

        $compileProvider.directive('ngMidChart', function() {
            return {
                restrict: 'A',
                transclude: true,
                link: function (scope, iElement) {
                    var marginTop = 18;
                    var displayItemCount = 0;
                    var margin = {top: marginTop, right: 0, bottom: 18, left: 0, textTop: 5};
                    var width, height, x, y;
                    var svg;

                    function initSvg() {
                        displayItemCount = scope.dayChart[0].displayItemCount;
                        margin.top = marginTop + scope.getMidTableHeight(displayItemCount);

                        x = d3.scale.ordinal().rangeBands([margin.left, width - margin.right]);
                        y = d3.scale.linear().range([height - margin.bottom, margin.top]);

                        if (svg != undefined) {
                            svg.selectAll("*").remove();
                            svg.attr('width', width)
                               .attr('height', height);
                        }
                        else {
                            svg = d3.select(iElement[0]).append('svg')
                                .attr('width', width)
                                .attr('height', height);
                        }
                    }

                    //shortChart 주석 참고.
                    scope.$watch(function () {
                        return iElement[0].getBoundingClientRect().height;
                    }, function(newValue) {
                        if (newValue === 0 || height === newValue) {
                            return;
                        }
                        width = iElement[0].getBoundingClientRect().width;
                        height = iElement[0].getBoundingClientRect().height;

                        console.log("mid scope watch");

                        if (!(scope.dayChart == undefined)) {
                            initSvg();
                            chart();
                        }
                    });

                    var chart = function () {
                        var data = scope.dayChart;
                        if (x == undefined || y == undefined || svg == undefined || data == undefined) {
                            return;
                        }

                        x.domain(d3.range(data[0].values.length));
                        y.domain([
                            d3.min(data[0].values, function (c) {
                                return c.tmn;
                            }),
                            d3.max(data[0].values, function (c) {
                                return c.tmx;
                            })
                        ]).nice();

                        d3.svg.axis()
                            .scale(x)
                            .orient('bottom');

                        d3.svg.axis()
                            .scale(y)
                            .orient('left');

                        var currentRect = svg.selectAll('.current-rect').data(data);

                        currentRect.enter().append('rect')
                            .attr('class', 'current-rect')
                            .attr('x', function (d) {
                                for (var i = 0; i < d.values.length; i++) {
                                    if (d.values[i].fromToday === 0) {
                                        return x.rangeBand() * i;
                                    }
                                }
                                return 0;
                            })
                            .attr('y', function () {
                                return 0;
                            })
                            .attr('width', x.rangeBand() - 0.5)
                            .attr('height', height);

                        currentRect.exit().remove();

                        // draw bar
                        var group = svg.selectAll('.bar-group')
                            .data(data);

                        group.enter().append('g')
                            .attr('class', 'bar-group');

                        // draw guideLine
                        var guideLines = group.selectAll('.guide-line')
                            .data(function (d) {
                                return d.values;
                            });

                        guideLines.enter().append('line')
                            .attr('class', 'guide-line');

                        guideLines.exit().remove();

                        guideLines
                            .attr('x1', function (d, i) {
                                return x.rangeBand() * i + 0.5;
                            })
                            .attr('x2', function (d, i) {
                                return (x.rangeBand()) * i + 0.5;
                            })
                            .attr('y1', 0)
                            .attr('y2', height);

                        var dayTables = svg.selectAll('.day-table')
                            .data(function () {
                                return data[0].values;
                            });

                        var dayObject = dayTables.enter()
                            .append('g')
                            .attr('class', 'day-table');

                        dayObject.append("svg:image")
                            .attr('class', 'skyAm')
                            .attr("xlink:href", function (d) {
                                return scope.weatherImgPath + "/" + d.skyAm + ".png";
                            })
                            .attr("x", function (d, i) {
                                return x.rangeBand() * i + (x.rangeBand() - scope.smallImageSize) / 2;
                            })
                            .attr("y", function (d) {
                                var y = 2;
                                if (d.skyAm == d.skyPm || d.skyPm == undefined) {
                                    y += scope.smallImageSize / 3;
                                }
                                return y;
                            })
                            .attr("width", scope.smallImageSize)
                            .attr("height", scope.smallImageSize)
                            .filter(function (d) {
                                return d.skyAm == undefined;
                            }).remove();

                        dayObject.append("svg:image")
                            .attr('class', 'skyPm')
                            .attr("xlink:href", function (d) {
                                return scope.weatherImgPath + "/" + d.skyPm + ".png";
                            })
                            .attr("x", function (d, i) {
                                return x.rangeBand() * i + (x.rangeBand() - scope.smallImageSize) / 2;
                            })
                            .attr("y", function (d) {
                                var y = 0;
                                if (d.skyAm == undefined) {
                                    y += 2 + scope.smallImageSize / 3;
                                }
                                else {
                                    y += scope.smallImageSize
                                }
                                return y;
                            })
                            .attr("width", scope.smallImageSize)
                            .attr("height", scope.smallImageSize)
                            .filter(function (d) {
                                return d.skyAm == d.skyPm || d.skyPm == undefined;
                            }).remove();

                        dayObject.append("text")
                            .attr('class', 'chart-text')
                            .attr("x", function (d, i) {
                                return x.rangeBand() * i + x.rangeBand() / 2;
                            })
                            .attr("y", function (d) {
                                var y = scope.smallImageSize;
                                if (d.skyAm == d.skyPm || d.skyAm == undefined || d.skyPm == undefined) {
                                    y += scope.smallImageSize / 3;
                                }
                                else {
                                    y += scope.smallImageSize;
                                }
                                y += 14;
                                return y;
                            })
                            .text(function (d) {
                                if (d.fromToday >= 0 && d.pop) {
                                    return d.pop;
                                }
                                return "";
                            })
                            .append('tspan')
                            .attr('class', 'chart-unit-text')
                            .text(function (d) {
                                if (d.fromToday >= 0 && d.pop) {
                                    return "%";
                                }
                                return "";
                            });

                        dayObject.append("text")
                            .attr('class', 'chart-sub-text')
                            .attr("x", function (d, i) {
                                return x.rangeBand() * i + x.rangeBand() / 2;
                            })
                            .attr("y", function (d) {
                                var y = scope.smallImageSize;
                                if (d.skyAm == d.skyPm || d.skyAm == undefined || d.skyPm == undefined) {
                                    y += scope.smallImageSize / 3;
                                }
                                else {
                                    y += scope.smallImageSize;
                                }
                                y += 2; //margin
                                if (d.pop && d.fromToday >= 0) {
                                    y += 15;
                                }
                                y += 10;
                                return y;
                            })
                            .text(function (d) {
                                var value;
                                if (d.rn1) {
                                    value = d.rn1;
                                }
                                else if (d.s06) {
                                    value = d.s06;
                                }
                                else if (d.r06) {
                                    value = d.r06;
                                }
                                else {
                                    return '';
                                }
                                if (value >= 10) {
                                    value = Math.round(value);
                                }
                                return value;
                            })
                            .append('tspan')
                            .attr('font-size', 'chart-unit-text')
                            .text(function (d) {
                                if (d.rn1 || d.s06 || d.r06) {
                                    return scope.getPrecipUnit(d);
                                }
                                return '';
                            });

                        var rects = group.selectAll('.rect')
                            .data(function (d) {
                                return d.values;
                            });

                        rects.enter().append('rect')
                            .attr('class', 'chart-bar');

                        rects.exit().remove();

                        rects.attr('x', function (d, i) {
                            return x.rangeBand() * i + x.rangeBand() / 2 - 1;
                        })
                            .attr('width', 2)
                            .attr('y', function (d) {
                                return y(d.tmn);
                            })
                            .attr('height', 0)
                            .attr('y', function (d) {
                                return y(d.tmx);
                            })
                            .attr('height', function (d) {
                                return y(d.tmn) - y(d.tmx);
                            });

                        // draw max value
                        var maxValue = svg.selectAll('.bar-max-value')
                            .data(data);

                        maxValue.enter()
                            .append('g')
                            .attr('class', 'bar-max-value');

                        var maxTexts = maxValue.selectAll('text')
                            .data(function (d) {
                                return d.values;
                            });

                        maxTexts.enter().append('text')
                            .attr('class', 'text');

                        maxTexts.exit().remove();

                        maxTexts.attr('x', function (d, i) {
                            return x.rangeBand() * i + x.rangeBand() / 2;
                        })
                            .attr('y', function (d) {
                                return y(d.tmn) - margin.top - margin.textTop;
                            })
                            .attr('dy', margin.top)
                            .text(function (d) {
                                return Math.round(d.tmx) + '˚';
                            })
                            .attr('class', 'chart-text')
                            .attr('y', function (d) {
                                return y(d.tmx) - margin.top - margin.textTop;
                            });

                        // draw min value
                        var minValue = svg.selectAll('.bar-min-value')
                            .data(data);

                        minValue.enter()
                            .append('g')
                            .attr('class', 'bar-min-value');

                        var minTexts = minValue.selectAll('text')
                            .data(function (d) {
                                return d.values;
                            });

                        minTexts.enter().append('text')
                            .attr('class', 'text');

                        minTexts.exit().remove();

                        minTexts.attr('x', function (d, i) {
                            return x.rangeBand() * i + x.rangeBand() / 2;
                        })
                            .attr('y', function (d) {
                                return y(d.tmn);
                            })
                            .attr('dy', margin.bottom)
                            .text(function (d) {
                                return Math.round(d.tmn) + '˚';
                            })
                            .attr('class', 'chart-text')
                            .attr('y', function (d) {
                                return y(d.tmn);
                            });

                        // draw point
                        var circle = svg.selectAll('circle')
                            .data(data)
                            .enter().append('circle');

                        svg.selectAll('circle')
                            .data(data)
                            .attr('class', 'circle circle-today-current')
                            .attr('cx', function (d) {
                                for (var i = 0; i < d.values.length; i++) {
                                    if (d.values[i].fromToday === 0) {
                                        return x.rangeBand() * i + x.rangeBand() / 2;
                                    }
                                }
                                return 0;
                            })
                            .attr('cy', function (d) {
                                return y(d.temp);
                            })
                            .attr('r', 5);
                    };

                    scope.$watch('dayWidth', function(newValue) {
                        if (newValue == undefined || newValue == width) {
                            console.log('new value is undefined or already set same width='+width);
                            return;
                        }
                        console.log('update dayWidth='+newValue);
                        width = newValue;
                        return;
                        // if (scope.dayChart == undefined) {
                        //     console.log('day chart is undefined in dayWidth');
                        //     return;
                        // }
                        // if (svg == undefined) {
                        //     initSvg();
                        // }
                        // else {
                        //     x = d3.scale.ordinal().rangeBands([margin.left, width - margin.right]);
                        //     svg.attr('width', width);
                        // }
                    });

                    scope.$watch('dayChart', function (newVal) {
                        if (newVal == undefined) {
                            return;
                        }
                        console.log("update dayChart");
                        // if (svg == undefined) {
                        //     initSvg();
                        // }
                        // else {
                        //     margin.top = marginTop + scope.getMidTableHeight(displayItemCount);
                        //     y = d3.scale.linear().range([height - margin.bottom, margin.top]);
                        //     svg.selectAll('.day-table').remove();
                        // }
                        initSvg();
                        chart();
                    });
                }
            };
        });

        $compileProvider.directive('ngAirChart', function() {
            return {
                restrict: 'A',
                transclude: true,
                link: function (scope, iElement) {
                    var margin = {top: -5, right: 5, bottom: 35, left: 5};
                    var width, height, x, y;
                    var svg;

                    function initSvg() {
                        x = d3.scale.ordinal().rangeBands([margin.left, width - margin.right]);
                        y = d3.scale.linear().range([height - margin.bottom, margin.top]);

                        if (svg != undefined) {
                            svg.selectAll("*").remove();
                            svg.attr('width', width)
                                .attr('height', height);
                        }
                        else {
                            svg = d3.select(iElement[0]).append('svg')
                                .attr('width', width)
                                .attr('height', height);
                        }
                    }

                    scope.$watch(function () {
                        return iElement[0].getBoundingClientRect().height;
                    }, function(newValue) {
                        if (newValue === 0 || height === newValue) {
                            return;
                        }
                        width = iElement[0].getBoundingClientRect().width;
                        height = iElement[0].getBoundingClientRect().height;

                        console.log("air scope watch");

                        if (!(scope.airChart == undefined)) {
                            initSvg();
                            chart();
                        }
                    });

                    var chart = function () {
                        var data = scope.airChart.data;
                        if (x == undefined || y == undefined || svg == undefined || data == undefined) {
                            return;
                        }

                        // aqiStandard의 max와 data의 (max+여백) 중 큰 값으로 사용
                        var maxValue = d3.max(data, function (d) { return d.val + d.val/10;});
                        if (scope.airChart.maxValue) {
                            maxValue = Math.max(scope.airChart.maxValue, maxValue);
                        }
                        x.domain(data.map(function(d) { return d.date; }));
                        y.domain([0, maxValue]).nice();

                        var xAxis = d3.svg.axis()
                            .tickFormat(function(d, i) {
                                var hour = parseInt(d.substr(11,2));
                                if (hour === 0 || hour % 3 === 0) {
                                    return hour + scope.strHour;
                                }
                                return "";
                            })
                            .outerTickSize(0)
                            .scale(x)
                            .orient('bottom');

                        d3.svg.axis()
                            .outerTickSize(0)
                            .scale(y)
                            .orient('left');

                        var bottom = height - margin.bottom;
                        var x_axis = svg.append('g')
                            .attr('class', 'x-axis')
                            .attr('transform', 'translate(0,' + bottom + ')')
                            .call(xAxis);

                        x_axis.selectAll('.x-axis .tick line')
                            .call(function(t) {
                                t.each(function (d, i) {
                                    if (i === 12) {
                                        var self = d3.select(this);
                                        self.attr('y1', -bottom)
                                            .attr('stroke-width', '2px');
                                    }
                                })
                            });
                        x_axis.selectAll('.x-axis .tick text')
                            .call(function(t) {
                                t.each(function (d) {
                                    var hour = parseInt(d.substr(11,2));
                                    if (hour === 0) {
                                        var self = d3.select(this);
                                        self.append('tspan')
                                            .attr('x', function (d, i) {
                                                return x.rangeBand() * i;
                                            })
                                            .attr('dy', parseFloat(self.attr('dy')) * 1.5 + 'em')
                                            .text(d.substr(5,2)+'.'+d.substr(8,2));
                                    }
                                })
                            });

                        var rects = svg.selectAll('.rect')
                            .data(data);

                        rects.enter().append('rect')
                            .attr('class', function (d, i) {
                                if (i === 12) {
                                    return 'chart-bar';
                                } else {
                                    return 'chart-blurry-bar';
                                }
                            });

                        rects.exit().remove();

                        rects.attr('x', function (d, i) {
                                return x.rangeBand() * i + 1 + margin.left;
                            })
                            .attr('width', x.rangeBand() - 2)
                            .attr('y', 0)
                            .attr('height', 0)
                            .style('fill', function (d) {
                                return scope.grade2Color(d.grade);
                            })
                            .attr('y', function (d) {
                                if (d.val == undefined) {
                                    return y(0);
                                }
                                return y(d.val);
                            })
                            .attr('height', function (d) {
                                if (d.val == undefined) {
                                    return 0;
                                }
                                return y(0) - y(d.val);
                            });
                    };

                    scope.$watch('airChart', function (newVal) {
                        if (newVal == undefined) {
                            return;
                        }
                        console.log("update airChart");
                        initSvg();
                        chart();
                    });
                }
            };
        });

        $compileProvider.directive('tabsShrink', function($document) {
            return {
                restrict: 'A',
                link: function($scope, $element, $attr) {
                    var tabs = $document[0].body.querySelector('.tab-nav');
                    var tabsHeight = 50;
                    var prevTop = 0;
                    var request = null;

                    function shrinkTabs(y, amount) {
                        if ($scope.$root === null) {
                            return;
                        }

                        var top = y + amount;
                        tabs.style[ionic.CSS.TRANSFORM] = 'translate3d(20px, ' + top + 'px, 0)';

                        $scope.$root.tabsTop = top;
                        $scope.$root.$apply();

                        if (top !== 0 && top !== tabsHeight) {
                            request = ionic.requestAnimationFrame(function() {
                                shrinkTabs(top, amount);
                            });
                        }
                    }

                    function onScroll(e) {
                        if ($scope == undefined || $scope.$root == undefined) {
                            return;
                        }

                        var scrollTop = e.target.scrollTop;

                        if (request === null) {
                            if(scrollTop > prevTop && $scope.$root.tabsTop === 0) {
                                request = ionic.requestAnimationFrame(function() {
                                    shrinkTabs(0, 5);
                                });
                            } else if(scrollTop < prevTop && $scope.$root.tabsTop === tabsHeight) {
                                request = ionic.requestAnimationFrame(function() {
                                    shrinkTabs(tabsHeight, -5);
                                });
                            }
                        } else {
                            if($scope.$root.tabsTop === 0 || $scope.$root.tabsTop === tabsHeight) {
                                request = null;
                            }
                        }
                        prevTop = scrollTop;
                    }

                    if (ionic.Platform.isAndroid()) {
                        $element.bind('scroll', onScroll);
                    }
                }
            }
        });

        $compileProvider.directive('barScrolled', function($document) {
            return {
                restrict: 'A',
                link: function($scope, $element, $attr) {
                    function onScroll(e) {
                        if ($scope == undefined || $scope.$root == undefined) {
                            return;
                        }

                        var headerbars = angular.element($document[0].querySelectorAll('ion-header-bar'));
                        if (e.target.scrollTop < 44) {
                            for (var i = 0; i < headerbars.length; i++) {
                                headerbars[i].style.backgroundImage = "";
                            }
                        } else {
                            var start = Math.min(1.0, (e.target.scrollTop - 44) / 88);
                            var end = start / 2;
                            for (var i = 0; i < headerbars.length; i++) {
                                headerbars[i].style.backgroundImage
                                    = "linear-gradient(to bottom, rgba(68,68,68," + start + ") 50%, rgba(68,68,68," + end + ") 100%)";
                            }
                        }
                    }

                    if ($scope.$root.settingsInfo.theme === 'photo') {
                        $element.bind('scroll', onScroll);
                    }
                }
            }
        });

        $compileProvider.directive("photoUrl", [function () {
            return {
                restrict: "A",
                scope: {
                    photoUrl: '='
                },
                link: function (scope, element, attributes) {
                    scope.$watch('photoUrl', function(newValue) {
                        if (newValue == undefined) {
                            return;
                        }

                        var image = new Image();
                        image.onload = function () {
                            scope.$apply(function () {
                                element.css({ backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0.3) 95%, rgba(255,255,255,0.9)), url("' + newValue + '")' });
                            });
                        };
                        image.onerror = function () {
                            element.css({ backgroundImage: 'url("img/bg.png")' });
                        };
                        image.src = newValue;
                    });
                }
            };
        }]);

        // Ionic uses AngularUI Router which uses the concept of states
        // Learn more here: https://github.com/angular-ui/ui-router
        // Set up the various states which the app can be in.
        // Each state's controller can be found in controller.forecastctrl.js
        $stateProvider
            .state('setting-push', {
                url: '/setting-push?fav',
                cache: false,
                templateUrl: 'templates/setting-push.html',
                controller: 'PushCtrl'
            })
            .state('kma-special', {
                url: '/kma-special',
                cache: false,
                templateUrl: 'templates/kma-special.html',
                controller: 'KmaSpecialCtrl'
            })
            .state('nation', {
                url: '/nation',
                cache: false,
                templateUrl: 'templates/nation.html',
                controller: 'NationCtrl'
            })
            .state('nation-air', {
                url: '/nation-air',
                cache: false,
                templateUrl: 'templates/nation-air.html',
                controller: 'NationAirCtrl'
            })
            .state('start', {
                url: '/start',
                cache: false,
                templateUrl: 'templates/start.html',
                controller: 'StartCtrl'
            })
            .state('guide', {
                url: '/guide',
                cache: false,
                templateUrl: 'templates/guide.html',
                controller: 'GuideCtrl'
            })
            .state('purchase', {
                url: '/purchase',
                templateUrl: 'templates/purchase.html',
                controller: "PurchaseCtrl"
            })
            .state('units', {
                url: '/units',
                cache: false,
                templateUrl: 'templates/units.html',
                controller: 'UnitsCtrl'
            })
            .state('setting-radio', {
                url: '/setting-radio',
                cache: false,
                templateUrl: 'templates/setting-radio.html',
                controller: 'RadioCtrl'
            })
            .state('tab', {
                url: '/tab',
                abstract: true,
                templateUrl: function () {
                    if (clientConfig.package === 'todayWeather') {
                        if (ionic.Platform.isAndroid()) {
                            return  'templates/tabs-android.html';
                        }
                        return 'templates/tabs.html';
                    }
                    else if (clientConfig.package === 'todayAir') {
                        return 'templates/ta-tabs.html';
                    }
                },
                controller: 'TabCtrl'
            })

            // Each tab has its own nav history stack:
            .state('tab.search', {
                url: '/search',
                cache: false,
                views: {
                    'tab-search': {
                        templateUrl: 'templates/tab-search.html',
                        controller: 'SearchCtrl'
                    }
                }
            })
            .state('tab.air', {
                url: '/air?fav&code',
                cache: false,
                views: {
                    'tab-air': {
                        templateUrl: 'templates/tab-air.html',
                        controller: 'AirCtrl'
                    }
                }
            });

        if (clientConfig.package === 'todayWeather') {
          $stateProvider
            .state('tab.forecast', {
              url: '/forecast?fav',
              cache: false,
              views: {
                'tab-forecast': {
                  templateUrl: 'templates/tab-forecast.html',
                  controller: 'ForecastCtrl'
                }
              }
            })
            .state('tab.dailyforecast', {
              url: '/dailyforecast?fav',
              cache: false,
              views: {
                'tab-dailyforecast': {
                  templateUrl: 'templates/tab-dailyforecast.html',
                  controller: 'ForecastCtrl'
                }
              }
            });
        }
        else if (clientConfig.package === 'todayAir') {
          $stateProvider
            .state('tab.weather', {
              url: '/weather?fav',
              cache: false,
              views: {
                'tab-weather': {
                  templateUrl: 'templates/ta-tab-weather.html',
                  controller: 'ForecastCtrl'
                }
              }
            });
        }

        $ionicConfigProvider.tabs.style('standard');
        $ionicConfigProvider.tabs.position('bottom');

        $ionicConfigProvider.views.transition("android");

        if (window.StatusBar) {
            StatusBar.styleLightContent();
        }

        // Enable Native Scrolling on Android
        $ionicConfigProvider.platform.android.scrolling.jsScrolling(false);
        $ionicConfigProvider.platform.ios.scrolling.jsScrolling(false);
        $ionicConfigProvider.views.swipeBackEnabled(false);

        ionicTimePickerProvider.configTimePicker({
            format: 12,
            step: 5,
            buttons: 3
        });
    })
    .constant('$ionicLoadingConfig', {
        template: '<ion-spinner icon="bubbles" class="spinner-stable"></ion-spinner>'
    });
