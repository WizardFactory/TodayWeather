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
    'service.storage',
    'service.weatherinfo',
    'service.weatherutil',
    'service.util',
    'service.twads',
    'service.push',
    'controller.tabctrl',
    'controller.forecastctrl',
    'controller.searchctrl',
    'controller.settingctrl',
    'controller.guidectrl',
    'controller.purchase',
    'controller.units',
    'controller.start',
    'service.run'
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
           if (twClientConfig && twClientConfig.debug) {
               alert("ERROR in " + exception);
           }
       }
    })
    .run(function(Util, $rootScope, $location, WeatherInfo, $state, Units, TwStorage) {
        //$translate.use('ja');
        //splash screen을 빠르게 닫기 위해 event 분리
        //차후 device ready이후 순차적으로 실행할 부분 넣어야 함.


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

        Units.loadUnits();

        $rootScope.$on('$stateChangeStart', function(event, toState, toParams, fromState) {
            if (toState.name === 'tab.search') {
                $rootScope.viewColor = '#ec72a8';
                if (window.StatusBar) {
                    StatusBar.backgroundColorByHexString('#EC407A');
                }
            } else if (toState.name === 'tab.forecast') {
                if ($rootScope.loaded === false) {
                    event.preventDefault();
                    return;
                } else {
                    if (navigator.splashscreen) {
                        console.log('splash screen hide!!!');
                        navigator.splashscreen.hide();
                    }
                }
                if (fromState.name === '' && WeatherInfo.getEnabledCityCount() <= 0) {
                    $location.path('/start');
                    return;
                }

                $rootScope.viewColor = '#03A9F4';
                if (window.StatusBar) {
                    StatusBar.backgroundColorByHexString('#0288D1');
                }
            } else if (toState.name === 'tab.dailyforecast') {
                $rootScope.viewColor = '#00BCD4';
                if (window.StatusBar) {
                    StatusBar.backgroundColorByHexString('#0097A7');
                }
            } else if (toState.name === 'tab.setting') {
                $rootScope.viewColor = '#FFA726';
                if (window.StatusBar) {
                    StatusBar.backgroundColorByHexString('#FB8C00');
                }
            } else if (toState.name === 'guide') {
                if (window.StatusBar) {
                    StatusBar.backgroundColorByHexString('#0288D1');
                }
            } else if (toState.name === 'units') {
                if (window.StatusBar) {
                    StatusBar.backgroundColorByHexString('#444');
                }
            }

            Util.ga.trackView(toState.name);
        });

        if (window.IonicDeeplink) {
            IonicDeeplink.route({
                '/:fav': {
                    target: 'tab.forecast',
                    parent: 'tab.forecast'
                }
            }, function(match) {
                console.log(match.$route.parent + ', ' + match.$args.fav);
                Util.ga.trackEvent('plugin', 'info', 'deepLinkMatch '+match.$args.fav);
                $state.transitionTo(match.$route.parent, match.$args, { reload: true });
            }, function(nomatch) {
                console.log('No match', nomatch);
                Util.ga.trackEvent('plugin', 'info', 'deepLinkNoMatch');
            });
        }
        else {
            console.log('Fail to find ionic deep link plugin');
            Util.ga.trackException('Fail to find ionic deep link plugin', false);
        }
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

        //$compileProvider.debugInfoEnabled(twClientConfig.debug);
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
                                //timeChart[0] -> yesterday, timeChart[1] -> today
                                if (i === scope.timeChart[1].currentIndex+1) {
                                    return (x.rangeBand() * i - x.rangeBand() / 2) + x.rangeBand() / 2;
                                }
                                //현재 시간이 hour % 3 != 0인 경우, 현재 시간 이후의 데이터의 x위치는 i - 1에 위치 설정
                                else if (i > scope.timeChart[1].currentIndex+1) {
                                    return x.rangeBand() * (i - 1) + x.rangeBand() / 2;
                                }
                                return x.rangeBand() * i + x.rangeBand() / 2;
                            })
                            .y(height);

                        line = d3.svg.line()
                            .interpolate('linear')
                            .x(function (d, i) {
                                if (i === scope.timeChart[1].currentIndex+1) {
                                    return (x.rangeBand() * i - x.rangeBand() / 2) + x.rangeBand() / 2;
                                }
                                else if (i > scope.timeChart[1].currentIndex+1) {
                                    return x.rangeBand() * (i - 1) + x.rangeBand() / 2;
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

                        // draw guideLine
                        var guideLines = svg.selectAll('.guide-line')
                            .data(function () {
                                return data[1].values;
                            });

                        guideLines.enter().append('line')
                            .attr('class', 'guide-line')
                            .attr('x1', function (d, i) {
                                return x.rangeBand() * i + x.rangeBand() / 2+0.5;
                            })
                            .attr('x2', function (d, i) {
                                return x.rangeBand() * i + x.rangeBand() / 2+0.5;
                            })
                            .attr('y1', 0)
                            .attr('y2', height)
                            .attr('stroke-width', 1)
                            .attr('stroke', '#fefefe')
                            .attr('stroke-opacity', '0.1');

                        guideLines.exit().remove();

                        var currentRect = svg.selectAll('.current-rect').data(function () {
                           return [data[1].currentIndex];
                        });

                        currentRect.enter().append('rect')
                            .attr('class', 'current-rect');

                        currentRect
                            .attr('stroke', '#039BE5')
                            .attr('fill', '#039BE5')
                            .attr('x', function (index) {
                                return x.rangeBand() * index + x.rangeBand() / 2 + 0.5;
                            })
                            .attr('y', function () {
                                return 0;
                            })
                            .attr('width', x.rangeBand() - 0.5)
                            .attr('height', height);

                        currentRect.exit().remove();

                        var hourlyTables = svg.selectAll('.hourly-table')
                            .data(function () {
                                return data[1].values;
                            });

                        var hourObject = hourlyTables.enter()
                            .append('g')
                            .attr('class', 'hourly-table');

                        hourObject.append("svg:image")
                            .attr('class', 'weatherIcon')
                            .attr("xlink:href", function (d) {
                               return "img/weatherIcon2-color/"+ d.value.skyIcon+".png";
                            })
                            .attr("x", function (d, i) {
                                return x.rangeBand() * i - scope.smallImageSize/2;
                            })
                            .attr("y", 0)
                            .attr("width", scope.smallImageSize)
                            .attr("height", scope.smallImageSize);

                        hourObject.append("text")
                            .attr('class', 'body1')
                            .attr('fill', 'white')
                            .attr("text-anchor", "middle")
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
                            .attr('font-size', '10px')
                            .text('%');

                        hourObject.append("text")
                            .attr('class', 'caption')
                            .attr('fill', 'white')
                            .attr("text-anchor", "middle")
                            .style('letter-spacing', 0)
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
                            .attr('font-size', '10px')
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
                                var currentWeather = {name: d.name};
                                if (d.name == "today") {
                                    currentWeather.value = scope.currentWeather;
                                    currentWeather.value.t3h = currentWeather.value.t1h;
                                }
                                else if (d.name == 'yesterday') {
                                    currentWeather.value = scope.currentWeather.yesterday;
                                    currentWeather.value.t1h = Math.round(currentWeather.value.t1h);
                                    currentWeather.value.t3h = currentWeather.value.t1h;
                                }
                                var cloneDate = JSON.parse(JSON.stringify(d));
                                cloneDate.values.splice(data[1].currentIndex+1, 0, currentWeather);
                                return [cloneDate];
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
                                if (scope.currentWeather.liveTime && currentTime+'00' != scope.currentWeather.liveTime) {
                                    return 5;
                                }
                                else {
                                    return currentTime % 3 == 0 ? 11:5;
                                }
                            })
                            .attr('cx', function () {
                                var x1 = data[1].currentIndex;
                                if (scope.currentWeather.liveTime && currentTime+'00' != scope.currentWeather.liveTime) {
                                    x1 += 0.5;
                                }
                                else {
                                    x1 += currentTime % 3 == 0 ? 0 : 0.5;
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
                                if (scope.currentWeather.liveTime && currentTime+'00' != scope.currentWeather.liveTime) {
                                    return 5;
                                }
                                else {
                                    return currentTime % 3 == 0 ? 11 : 5;
                                }
                            })
                            .attr('cx', function () {
                                var x1 = data[1].currentIndex;
                                if (scope.currentWeather.liveTime && currentTime+'00' != scope.currentWeather.liveTime) {
                                    x1 += 0.5;
                                }
                                else {
                                    x1 += currentTime % 3 == 0 ? 0 : 0.5;
                                }
                                return x.rangeBand() * x1 + x.rangeBand() / 2;
                            })
                            .attr('cy', height);

                        point.attr('cx', function () {
                            var x1 = data[1].currentIndex;
                            if (scope.currentWeather.liveTime && currentTime+'00' != scope.currentWeather.liveTime) {
                                x1 += 0.5;
                            }
                            else {
                                x1 += currentTime % 3 == 0 ? 0 : 0.5;
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
                            .style("fill", function (d) {
                                if (d.name == "today") {
                                    if (d.value.time  === currentTime && d.value.date === scope.currentWeather.date) {
                                        if (scope.currentWeather.liveTime && currentTime+'00' != scope.currentWeather.liveTime) {
                                            return '#0288D1';
                                        }
                                        else {
                                            return '#fefefe';
                                        }
                                    }
                                }
                                return '#0288D1';
                            })
                            .attr('y', height - margin.bottom + margin.textTop)
                            .text(function (d) {
                                return Math.round(d.value.t3h);
                            });

                        texts.enter()
                            .append('text')
                            .attr('class', function (d) {
                                return 'text-' + d.name;
                            })
                            .style("fill", function (d) {
                                if (d.name == "today") {
                                    if (d.value.time === currentTime && d.value.date === scope.currentWeather.date) {
                                        if (scope.currentWeather.liveTime && currentTime+'00' != scope.currentWeather.liveTime) {
                                            return '#0288D1';
                                        }
                                        else {
                                            return '#fefefe';
                                        }
                                    }
                                }
                                return '#0288D1';
                            })
                            .attr('text-anchor', 'middle')
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

                        var currentRect = svg.selectAll('.currentRect').data(data);

                        currentRect.enter().append('rect')
                            .attr('class', 'currentRect')
                            .attr('fill', '#00ACC1')
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
                            .attr('y2', height)
                            .attr('stroke-width', 1)
                            .attr('stroke', '#fefefe')
                            .attr('stroke-opacity', '0.1');

                        var dayTables = svg.selectAll('.day-table')
                            .data(function () {
                                return data[0].values;
                            });

                        var dayObject = dayTables.enter()
                            .append('g')
                            .attr('class', 'day-table');

                        dayObject.append("text")
                            .attr('class', 'subheading')
                            .attr('fill', 'white')
                            .attr("text-anchor", "middle")
                            .attr("x", function (d, i) {
                                return x.rangeBand() * i + x.rangeBand() / 2;
                            })
                            .attr("y", function () {
                                //0이 아닌 18이어야 하는 것이 이상함.
                                return marginTop;
                            })
                            .text(function (d) {
                                return d.date.substr(6, 2);
                            });

                        dayObject.append("svg:image")
                            .attr('class', 'skyAm')
                            .attr("xlink:href", function (d) {
                                return "img/weatherIcon2-color/" + d.skyAm + ".png";
                            })
                            .attr("x", function (d, i) {
                                return x.rangeBand() * i + (x.rangeBand() - scope.smallImageSize) / 2;
                            })
                            .attr("y", function (d) {
                                var y = 17 + 2;
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
                                return "img/weatherIcon2-color/" + d.skyPm + ".png";
                            })
                            .attr("x", function (d, i) {
                                return x.rangeBand() * i + (x.rangeBand() - scope.smallImageSize) / 2;
                            })
                            .attr("y", function (d) {
                                var y = 17;
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
                            .attr('class', 'body1')
                            .attr('fill', 'white')
                            .attr("text-anchor", "middle")
                            .attr("x", function (d, i) {
                                return x.rangeBand() * i + x.rangeBand() / 2;
                            })
                            .attr("y", function (d) {
                                var y = 17 + scope.smallImageSize;
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
                            .attr('font-size', '10px')
                            .text(function (d) {
                                if (d.fromToday >= 0 && d.pop) {
                                    return "%";
                                }
                                return "";
                            });

                        dayObject.append("text")
                            .attr('class', 'caption')
                            .attr('fill', 'white')
                            .attr("text-anchor", "middle")
                            .style('letter-spacing', 0)
                            .attr("x", function (d, i) {
                                return x.rangeBand() * i + x.rangeBand() / 2;
                            })
                            .attr("y", function (d) {
                                var y = 17 + scope.smallImageSize;
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
                            .attr('font-size', '10px')
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
                            .attr('class', 'rect');

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
                            .attr('text-anchor', 'middle')
                            .text(function (d) {
                                return Math.round(d.tmx) + '˚';
                            })
                            .attr('class', 'text-today')
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
                            .attr('text-anchor', 'middle')
                            .text(function (d) {
                                return Math.round(d.tmn) + '˚';
                            })
                            .attr('class', 'text-today')
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
                            .attr('r', 0)
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
                        tabs.style[ionic.CSS.TRANSFORM] = 'translate3d(0, ' + top + 'px, 0)';

                        $scope.$root.tabsTop = top;
                        $scope.$root.$apply();

                        if (top !== 0 && top !== tabsHeight) {
                            request = ionic.requestAnimationFrame(function() {
                                shrinkTabs(top, amount);
                            });
                        }
                    }

                    function onScroll(e) {
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

        // Ionic uses AngularUI Router which uses the concept of states
        // Learn more here: https://github.com/angular-ui/ui-router
        // Set up the various states which the app can be in.
        // Each state's controller can be found in controller.forecastctrl.js
        $stateProvider
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
                templateUrl: 'templates/units.html',
                controller: 'UnitsCtrl'
            })
            .state('tab', {
                url: '/tab',
                abstract: true,
                templateUrl: function () {
                    if (ionic.Platform.isAndroid()) {
                        return  'templates/tabs-android.html';
                    }
                    return 'templates/tabs.html';
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
            })
            .state('tab.setting', {
                url: '/setting',
                cache: true,
                views: {
                    'tab-setting': {
                        templateUrl: 'templates/tab-setting.html',
                        controller: 'SettingCtrl'
                    }
                }
            });

        // if none of the above states are matched, use this as the fallback
        //$urlRouterProvider.otherwise('tab/forecast');

        $ionicConfigProvider.tabs.style('standard');
        $ionicConfigProvider.tabs.position('bottom');

        $ionicConfigProvider.views.transition("android");

        // Enable Native Scrolling on Android
        $ionicConfigProvider.platform.android.scrolling.jsScrolling(false);
        $ionicConfigProvider.platform.ios.scrolling.jsScrolling(false);

        ionicTimePickerProvider.configTimePicker({
            format: 12,
            step: 5,
            buttons: 3
        });
    })
    .constant('$ionicLoadingConfig', {
        template: '<ion-spinner icon="bubbles" class="spinner-stable"></ion-spinner>'
    });
