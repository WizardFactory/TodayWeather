// Ionic Starter App

// angular.module is a global place for creating, registering and retrieving Angular modules
// 'starter' is the name of this angular module example (also set in a <body> attribute in index.html)
// the 2nd parameter is an array of 'requires'
// 'starter.services' is found in services.js
// 'starter.controllers' is found in controllers.js
angular.module('starter', [
    'ionic',
    'ionic.service.core',
    'ionic.service.analytics',
    'starter.controllers',
    'starter.services',
    'controller.purchase',
    'service.twads',
    'service.push',
    'ionic-timepicker',
    'ngCordova'
])
    .run(function($ionicPlatform, $ionicAnalytics, Util, $rootScope, $location) {
        $ionicPlatform.ready(function() {
            if (Util.isDebug()) {
                Util.ga.debugMode();
            } else {
                $ionicAnalytics.register();
            }

            if (ionic.Platform.isIOS()) {
                Util.ga.startTrackerWithId('[GOOGLE_ANALYTICS_IOS_KEY]');
                if (window.applewatch) {
                    applewatch.init(function () {
                        console.log('Succeeded to initialize for apple-watch');
                    }, function (err) {
                        console.log('Failed to initialize apple-watch', err);
                    }, 'group.net.wizardfactory.todayweather');
                }
            } else if (ionic.Platform.isAndroid()) {
                Util.ga.startTrackerWithId('[GOOGLE_ANALYTICS_ANDROID_KEY]');
            }

            // Hide the accessory bar by default (remove this to show the accessory bar above the keyboard
            // for form inputs)
            if (window.cordova && window.cordova.plugins && window.cordova.plugins.Keyboard) {
                cordova.plugins.Keyboard.hideKeyboardAccessoryBar(true);
                cordova.plugins.Keyboard.disableScroll(true);

            }
            if (window.StatusBar) {
                StatusBar.overlaysWebView(false);
                StatusBar.backgroundColorByHexString('#0288D1');
            }
        });

        $rootScope.$on('$stateChangeStart', function(event, toState, toParams, fromState) {
            if (fromState.name === '' && toState.name === 'tab.forecast') {
                if(typeof(Storage) !== 'undefined') {
                    var guideVersion = localStorage.getItem('guideVersion');
                    if (guideVersion === null || Util.guideVersion > Number(guideVersion)) {
                        $location.path('/guide');
                    }
                }
            }
        });
    })

    .config(function($stateProvider, $urlRouterProvider, $ionicConfigProvider, $compileProvider, ionicTimePickerProvider) {

        //for chrome extension
        $compileProvider.aHrefSanitizationWhitelist(/^\s*(https?|file|ftp|mailto|chrome-extension|blob:chrome-extension):/);
        $compileProvider.imgSrcSanitizationWhitelist(/^\s*(https?|file|ftp|mailto|chrome-extension|blob:chrome-extension):/);

        // Ionic uses AngularUI Router which uses the concept of states
        // Learn more here: https://github.com/angular-ui/ui-router
        // Set up the various states which the app can be in.
        // Each state's controller can be found in controllers.js
        $stateProvider

            .state('guide', {
                url: '/guide',
                templateUrl: 'templates/guide.html',
                controller: 'GuideCtrl'
            })
            .state('purchase', {
                url: '/purchase',
                templateUrl: 'templates/purchase.html',
                controller: "PurchaseCtrl"
            })
            // setup an abstract state for the tabs directive
            .state('tab', {
                url: '/tab',
                abstract: true,
                templateUrl: 'templates/tabs.html',
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
            .state('tab.setting', {
                url: '/setting',
                cache: false,
                views: {
                    'tab-setting': {
                        templateUrl: 'templates/tab-setting.html',
                        controller: 'SettingCtrl'
                    }
                }
            });

        // if none of the above states are matched, use this as the fallback
        $urlRouterProvider.otherwise('tab/forecast');

        $ionicConfigProvider.tabs.style('standard');
        $ionicConfigProvider.tabs.position('bottom');

        $ionicConfigProvider.views.transition("android");

        // Enable Native Scrolling on Android
        $ionicConfigProvider.platform.android.scrolling.jsScrolling(false);

        var timePickerObj = {
            format: 12,
            step: 5,
            setLabel: '설정',
            closeLabel: '삭제/닫기'
        };
        ionicTimePickerProvider.configTimePicker(timePickerObj);
    })
    .directive('ngShortChart', function() {
        return {
            restrict: 'A',
            transclude: true,
            link: function (scope, iElement) {
                var duration = 1000;
                var margin = {top: 20, right: 0, bottom: 5, left: 0, textTop: 5};
                var width, height, x, y;
                var svg, initLine, line;

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
                    x = d3.scale.ordinal().rangeBands([margin.left, width - margin.right]);
                    y = d3.scale.linear().range([height - margin.bottom, margin.top]);

                    if (svg != undefined) {
                        svg.selectAll("*").remove();
                        svg.attr('height', height);
                    }
                    else {
                        svg = d3.select(iElement[0]).append('svg')
                            .attr('width', width)
                            .attr('height', height);
                    }

                    initLine = d3.svg.line()
                        .interpolate('linear')
                        .x(function (d, i) {
                            return x.rangeBand() * i + x.rangeBand() / 2;
                        })
                        .y(height);

                    line = d3.svg.line()
                        .interpolate('linear')
                        .x(function (d, i) {
                            return x.rangeBand() * i + x.rangeBand() / 2;
                        })
                        .y(function (d) {
                            return y(d.value.t3h);
                        });

                    chart();
                });

                var chart = function () {
                    var data = scope.timeChart;

                    if (x == undefined || y == undefined || svg == undefined || data == undefined) {
                        return;
                    }

                    var currentTime = scope.currentWeather.time;

                    x.domain(d3.range(data[0].values.length));
                    y.domain([
                        d3.min(data, function (c) {
                            return d3.min(c.values, function (v) {
                                return v.value.t3h;
                            });
                        }),
                        d3.max(data, function (c) {
                            return d3.max(c.values, function (v) {
                                return v.value.t3h;
                            });
                        })
                    ]).nice();

                    d3.svg.axis()
                        .scale(x)
                        .orient('bottom');

                    d3.svg.axis()
                        .scale(y)
                        .orient('left');

                    var lineGroups = svg.selectAll('.line-group')
                        .data(data);

                    lineGroups.enter()
                        .append('g')
                        .attr('class', 'line-group');

                    // draw line
                    var lines = lineGroups.selectAll('.line')
                        .data(function(d) {
                            return [d];
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

                    lines.transition()
                        .duration(duration)
                        .attr('d', function (d) {
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
                        .attr('cy', height - margin.bottom);

                    circles.enter()
                        .append('circle')
                        .attr('class', function (d) {
                            return 'circle-' + d.name;
                        })
                        .attr('r', 2)
                        .attr('cx', function (d, i) {
                            return x.rangeBand() * i + x.rangeBand() / 2;
                        })
                        .attr('cy', height - margin.bottom);

                    circles.transition()
                        .duration(duration)
                        .attr('cy', function (d) {
                            return y(d.value.t3h);
                        });

                    circles.exit()
                        .remove();

                    // draw current point
                    var point = lineGroups.selectAll('.point')
                        .data(function(d) {
                            return [d];
                        })
                        .attr('cx', function (d) {
                            var cx1, cx2;
                            for (var i = 0; i < d.values.length; i = i + 1) {
                                if (d.values[i].value.day === '오늘') {
                                    cx1 = i + Math.floor(currentTime / 3) - 1;
                                    cx2 = currentTime % 3;
                                    break;
                                }
                            }
                            return x.rangeBand() * (cx1 + cx2 / 3) + x.rangeBand() / 2;
                        })
                        .attr('cy', height - margin.bottom);

                    point.enter()
                        .append('circle')
                        .attr('class', function (d) {
                            return 'point circle-' + d.name + '-current';
                        })
                        .attr('r', 5)
                        .attr('cx', function (d) {
                            var cx1, cx2;
                            for (var i = 0; i < d.values.length; i = i + 1) {
                                if (d.values[i].value.day === '오늘') {
                                    cx1 = i + Math.floor(currentTime / 3) - 1;
                                    cx2 = currentTime % 3;
                                    break;
                                }
                            }
                            return x.rangeBand() * (cx1 + cx2 / 3) + x.rangeBand() / 2;
                        })
                        .attr('cy', height - margin.bottom);

                    point.transition()
                        .duration(duration)
                        .attr('cx', function (d) {
                            var cx1, cx2;
                            for (var i = 0; i < d.values.length; i = i + 1) {
                                if (d.values[i].value.day === '오늘') {
                                    cx1 = i + Math.floor(currentTime / 3) - 1;
                                    cx2 = currentTime % 3;
                                    break;
                                }
                            }
                            return x.rangeBand() * (cx1 + cx2 / 3) + x.rangeBand() / 2;
                        })
                        .attr('cy', function (d) {
                            var cx1, cx2;
                            for (var i = 0; i < d.values.length; i = i + 1) {
                                if (d.values[i].value.day === '오늘') {
                                    cx1 = i + Math.floor(currentTime / 3) - 1;
                                    cx2 = currentTime % 3;
                                    break;
                                }
                            }
                            var cy1 = d.values[cx1].value.t3h;
                            var cy2 = d.values[cx1+1].value.t3h;

                            if (cx2 === 1) {
                                return y(cy1 + (cy2 - cy1) / 3);
                            }
                            else if (cx2 === 2) {
                                return y(cy1 + (cy2 - cy1) / 3 * 2);
                            }
                            return y(cy1);
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
                        .attr('y', height - margin.bottom - margin.textTop)
                        .text(function (d) {
                            if (d.name === 'today') {
                                if (d.value.tmn !== -50) {
                                    return d.value.tmn + '˚';
                                }
                                if (d.value.tmx !== -50) {
                                    return d.value.tmx + '˚';
                                }
                            }
                            return '';
                        });

                    texts.enter()
                        .append('text')
                        .attr('class', function (d) {
                            return 'text-' + d.name;
                        })
                        .attr('text-anchor', 'middle')
                        .attr('dy', margin.top)
                        .attr('x', function (d, i) {
                            return x.rangeBand() * i + x.rangeBand() / 2;
                        })
                        .attr('y', height - margin.bottom - margin.textTop)
                        .text(function (d) {
                            if (d.name === 'today') {
                                if (d.value.tmn !== -50) {
                                    return d.value.tmn + '˚';
                                }
                                if (d.value.tmx !== -50) {
                                    return d.value.tmx + '˚';
                                }
                            }
                            return '';
                        });

                    texts.transition()
                        .duration(duration)
                        .attr('y', function (d) {
                            return y(d.value.t3h) - margin.top - margin.textTop;
                        });

                    texts.exit()
                        .remove();
                };

                scope.$watch('timeWidth', function(newValue) {
                    width = newValue;
                    x = d3.scale.ordinal().rangeBands([margin.left, width - margin.right]);

                    if (svg) {
                        svg.attr('width', width);
                    }
                });

                scope.$watch('timeChart', function (newVal) {
                    if (newVal) {
                        chart();
                    }
                });

                scope.$watch('forecastType', function (newVal) {
                    if (newVal === true) {
                        chart();
                    }
                });
            }
        };
    })
    .directive('ngMidChart', function() {
        return {
            restrict: 'A',
            transclude: true,
            link: function (scope, iElement) {
                var duration = 1000;
                var margin = {top: 20, right: 0, bottom: 20, left: 0, textTop: 5};
                var width, height, x, y;
                var svg;

                //shortChart 주석 참고.
                scope.$watch(function () {
                    return iElement[0].getBoundingClientRect().height;
                }, function(newValue) {
                    if (newValue === 0 || height === newValue) {
                        return;
                    }
                    width = iElement[0].getBoundingClientRect().width;
                    height = iElement[0].getBoundingClientRect().height;
                    x = d3.scale.ordinal().rangeBands([margin.left, width - margin.right]);
                    y = d3.scale.linear().range([height - margin.bottom, margin.top]);

                    if (svg != undefined) {
                        svg.selectAll("*").remove();
                        svg.attr('height', height);
                    }
                    else {
                        svg = d3.select(iElement[0]).append('svg')
                            .attr('width', width)
                            .attr('height', height);
                    }
                    chart();
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

                    // draw bar
                    var group = svg.selectAll('.bar-group')
                        .data(data);

                    group.enter().append('g')
                        .attr('class', 'bar-group');

                    var rects = group.selectAll('rect')
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
                        .transition()
                        .duration(duration)
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
                            return d.tmx + '˚';
                        })
                        .attr('class', 'text-today')
                        .transition()
                        .duration(duration)
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
                            return d.tmn + '˚';
                        })
                        .attr('class', 'text-today')
                        .transition()
                        .duration(duration)
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
                        .transition()
                        .delay(duration)
                        .attr('r', 5);
                };

                scope.$watch('dayWidth', function(newValue) {
                    width = newValue;
                    x = d3.scale.ordinal().rangeBands([margin.left, width - margin.right]);
                    if (svg) {
                        svg.attr('width', width);
                    }
                });

                scope.$watch('dayChart', function (newVal) {
                    if (newVal) {
                        chart();
                    }
                });

                scope.$watch('forecastType', function (newVal) {
                    if (newVal === false) {
                        chart();
                    }
                });
            }
        };
    });
