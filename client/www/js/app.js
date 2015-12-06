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
    'ngCordova'
])
    .run(function($ionicPlatform, $ionicAnalytics) {
        $ionicPlatform.ready(function() {

            $ionicAnalytics.register();

            if (ionic.Platform.isIOS()) {

                applewatch.init(function (appIdentifier) {
                        console.log("Succeeded to initialize for apple-watch");
                }, function (err) {
                        console.log('Failed to initialize apple-watch', err);
                }, "group.net.wizardfactory.todayweather");
            }

            // Hide the accessory bar by default (remove this to show the accessory bar above the keyboard
            // for form inputs)
            if (window.cordova && window.cordova.plugins && window.cordova.plugins.Keyboard) {
                cordova.plugins.Keyboard.hideKeyboardAccessoryBar(true);
                cordova.plugins.Keyboard.disableScroll(true);

            }
            if (window.StatusBar) {
                // org.apache.cordova.statusbar required
                //StatusBar.styleLightContent();
                StatusBar.hide();
                ionic.Platform.fullScreen();
            }

        });
    })

    .config(function($stateProvider, $urlRouterProvider, $ionicConfigProvider, $compileProvider) {

        //for chrome extension
        $compileProvider.aHrefSanitizationWhitelist(/^\s*(https?|file|ftp|mailto|chrome-extension|blob:chrome-extension):/);
        $compileProvider.imgSrcSanitizationWhitelist(/^\s*(https?|file|ftp|mailto|chrome-extension|blob:chrome-extension):/);

        // Ionic uses AngularUI Router which uses the concept of states
        // Learn more here: https://github.com/angular-ui/ui-router
        // Set up the various states which the app can be in.
        // Each state's controller can be found in controllers.js
        $stateProvider

            // setup an abstract state for the tabs directive
            .state('tab', {
                url: '/tab',
                abstract: true,
                templateUrl: 'templates/tabs.html',
                controller: "TabCtrl"
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
                url: '/forecast',
                cache: false,
                views: {
                    'tab-forecast': {
                        templateUrl: 'templates/tab-forecast.html',
                        controller: 'ForecastCtrl'
                    }
                }
            })
            .state('tab.update', {

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
        $urlRouterProvider.otherwise('/tab/forecast');

        $ionicConfigProvider.tabs.style('standard');
        $ionicConfigProvider.tabs.position('bottom');
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

                // document가 rendering이 될 때 tabs가 있으면 ion-content에 has-tabs class가 추가됨
                // has-tabs에 의해 ion-content의 영역이 tabs을 제외한 나머지 영역으로 설정되므로 그 후에 차트를 생성하도록 함
                scope.$watch('$hasTabs', function(val) {
                    width = iElement[0].getBoundingClientRect().width;
                    height = iElement[0].getBoundingClientRect().height;
                    x = d3.scale.ordinal().rangeBands([margin.left, width - margin.right]);
                    y = d3.scale.linear().range([height - margin.bottom, margin.top]);

                    svg = d3.select(iElement[0]).append('svg')
                        .attr('width', width)
                        .attr('height', height)
                        .append('g');

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
                });

                var chart = function () {
                    var data = scope.timeChart;

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

                    var xAxis = d3.svg.axis()
                        .scale(x)
                        .orient('bottom');

                    var yAxis = d3.svg.axis()
                        .scale(y)
                        .orient('left');

                    var group = svg.selectAll('.line-group')
                        .data(data);

                    var group_enter = group.enter()
                        .append('g')
                        .attr('class', 'line-group');

                    // draw line
                    group_enter.append('path')
                        .attr('class', function (d) {
                            return 'line line-' + d.name;
                        })
                        .attr('d', function (d) {
                            return line(d.values);
                        });

                    group.select('.line')
                        .attr('d', function (d) {
                            return initLine(d.values);
                        })
                        .transition()
                        .duration(duration)
                        .attr('d', function (d) {
                            return line(d.values);
                        });

                    // draw point
                    group_enter.append('g')
                        .attr('class', 'line-point');

                    var circles = group.selectAll('circle')
                        .data(function (d) {
                            return d.values;
                        });

                    circles.enter().append('circle');

                    circles.exit().remove();

                    circles.attr('cx', function (d, i) {
                            return x.rangeBand() * i + x.rangeBand() / 2;
                        })
                        .attr('cy', height - margin.bottom)
                        .attr('r', function (d, i) {
                            if (i === 8) {
                                return 5;
                            }
                            return 2;
                        })
                        .attr('class', function (d, i) {
                            if (i === 8) {
                                return 'circle-' + d.name + '-current';
                            }
                            return 'circle-' + d.name;
                        })
                        .transition()
                        .duration(duration)
                        .attr('cy', function (d) {
                            return y(d.value.t3h);
                        });

                    // draw value
                    group_enter.append('g')
                        .attr('class', 'line-value')
                        .selectAll('text')
                        .data(function (d) {
                            return d.values;
                        })
                        .enter().append('text');

                    group.select('.line-value')
                        .selectAll('text')
                        .data(function (d) {
                            return d.values;
                        })
                        .attr('x', function (d, i) {
                            return x.rangeBand() * i + x.rangeBand() / 2;
                        })
                        .attr('y', height - margin.bottom - margin.textTop)
                        .attr('dy', margin.top)
                        .attr('text-anchor', 'middle')
                        .text(function (d) {
                            if (d.name === 'today' && (d.value.tmn !== undefined || d.value.tmx !== undefined)) {
                                return (d.value.tmn | d.value.tmx) + '˚';
                            }
                            return '';
                        })
                        .attr('class', function (d, i) {
                            return 'text-today';
                        })
                        .transition()
                        .duration(duration)
                        .attr('y', function (d) {
                            return y(d.value.t3h) - margin.top - margin.textTop;
                        });
                }

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
                var svg, initLine, line;

                // document가 rendering이 될 때 tabs가 있으면 ion-content에 has-tabs class가 추가됨
                // has-tabs에 의해 ion-content의 영역이 tabs을 제외한 나머지 영역으로 설정되므로 그 후에 차트를 생성하도록 함
                scope.$watch('$hasTabs', function(val) {
                    width = iElement[0].getBoundingClientRect().width;
                    height = iElement[0].getBoundingClientRect().height;
                    x = d3.scale.ordinal().rangeBands([margin.left, width - margin.right]);
                    y = d3.scale.linear().range([height - margin.bottom, margin.top]);

                    svg = d3.select(iElement[0]).append('svg')
                        .attr('width', width)
                        .attr('height', height)
                        .append('g');
                });

                var chart = function () {
                    var data = scope.dayChart;

                    x.domain(d3.range(data[0].values.length));
                    y.domain([
                        d3.min(data[0].values, function (c) {
                            return c.tmn;
                        }),
                        d3.max(data[0].values, function (c) {
                            return c.tmx;
                        })
                    ]).nice();

                    var xAxis = d3.svg.axis()
                        .scale(x)
                        .orient('bottom');

                    var yAxis = d3.svg.axis()
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
                        .attr("y", function (d) {
                            return y(d.tmn);
                        })
                        .attr("height", 0)
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
                        .attr('cx', function (d, i) {
                            for (var i = 0; i < d.values.length; i++) {
                                if (d.values[i].week === "오늘") {
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
                }

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
