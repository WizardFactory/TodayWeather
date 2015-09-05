// Ionic Starter App

// angular.module is a global place for creating, registering and retrieving Angular modules
// 'starter' is the name of this angular module example (also set in a <body> attribute in index.html)
// the 2nd parameter is an array of 'requires'
// 'starter.services' is found in services.js
// 'starter.controllers' is found in controllers.js
angular.module('starter', ['ionic','ionic.service.core','ionic.service.analytics', 'starter.controllers', 'starter.services', 'ngCordova'])

    .run(function($ionicPlatform) {
        $ionicPlatform.ready(function() {
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

    .config(['$ionicAppProvider', function($ionicAppProvider) {
        // Identify app
        $ionicAppProvider.identify({
            // The App ID for the server
            app_id: '<YOUR_APP_ID>',
            // The API key all services will use for this app
            api_key: '<YOUR_API_KEY>'
        })
    }])

    .run(['$ionicAnalytics', function($ionicAnalytics) {

        $ionicAnalytics.register();

    }])

    .config(function($stateProvider, $urlRouterProvider, $ionicConfigProvider) {

        // Ionic uses AngularUI Router which uses the concept of states
        // Learn more here: https://github.com/angular-ui/ui-router
        // Set up the various states which the app can be in.
        // Each state's controller can be found in controllers.js
        $stateProvider

            // setup an abstract state for the tabs directive
            .state('tab', {
                url: '/tab',
                abstract: true,
                templateUrl: 'templates/tabs.html'
            })

            // Each tab has its own nav history stack:

            .state('tab.dash', {
                url: '/dash',
                views: {
                    'tab-dash': {
                        templateUrl: 'templates/tab-dash.html',
                        controller: 'DashCtrl'
                    }
                }
            })

            .state('tab.chats', {
                url: '/chats',
                views: {
                    'tab-chats': {
                        templateUrl: 'templates/tab-chats.html',
                        controller: 'ChatsCtrl'
                    }
                }
            })
            .state('tab.chat-detail', {
                url: '/chats/:chatId',
                views: {
                    'tab-chats': {
                        templateUrl: 'templates/chat-detail.html',
                        controller: 'ChatDetailCtrl'
                    }
                }
            })

            .state('tab.account', {
                url: '/account',
                views: {
                    'tab-account': {
                        templateUrl: 'templates/tab-account.html',
                        controller: 'AccountCtrl'
                    }
                }
            });

        // if none of the above states are matched, use this as the fallback
        $urlRouterProvider.otherwise('/tab/dash');

        $ionicConfigProvider.tabs.style('standard');
        $ionicConfigProvider.tabs.position('bottom');
    })
    .directive('ngTempChart', function() {
        return {
            restrict: 'A',
            transclude: true,
            link: function (scope, iElement) {
                var margin = {top: 20, right: 0, bottom: 20, left: 0},
                    width = iElement[0].getBoundingClientRect().width - margin.left - margin.right,
                    height = iElement[0].getBoundingClientRect().height - margin.top - margin.bottom;

                var svg = d3.select(iElement[0]).append("svg")
                    .attr("width", width + margin.left + margin.right)
                    .attr("height", height + margin.top + margin.bottom)
                    .append("g")
                    .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

                var x = d3.scale.ordinal()
                    .rangeRoundBands([width, 0]);

                var y = d3.scale.linear()
                    .range([height, 0]);

                var line = d3.svg.line()
                    .defined(function (d) {
                        return d.value != '';
                    })
                    .interpolate("monotone")
                    .x(function (d, i) {
                        return x.rangeBand() * i + x.rangeBand() / 2;
                    })
                    .y(function (d) {
                        return y(d.value);
                    });

                scope.$watch('temp', function (newVal) {
                    if (newVal) {
                        var column = scope.temp;

                        x.domain(d3.range(scope.temp[0].values.length));
                        y.domain([
                            d3.min(column, function (c) {
                                return d3.min(c.values, function (v) {
                                    return v.value;
                                });
                            }),
                            d3.max(column, function (c) {
                                return d3.max(c.values, function (v) {
                                    return v.value;
                                });
                            })
                        ]).nice();

                        var xAxis = d3.svg.axis()
                            .scale(x)
                            .orient("bottom");

                        var yAxis = d3.svg.axis()
                            .scale(y)
                            .orient("left");

                        var group = svg.selectAll(".line_group")
                            .data(column);

                        var group_enter = group.enter()
                            .append("g")
                            .attr("class", "line_group");

                        // draw line
                        group_enter.append("path")
                            .attr("class", function(d) { return "line line-"+d.name; })
                            .attr("d", function(d) { return line(d.values); });

                        // update line
                        group.select('.line')
                            .attr("d", function(d) { return line(d.values); });

                        // draw point
                        var point = group_enter.append("g")
                            .attr("class", "line-point");

                        point.selectAll('circle')
                            .data(function(d) { return d.values; })
                            .enter().append('circle')
                            .attr("cx", function(d, i) { return x.rangeBand() * i + x.rangeBand() / 2; })
                            .attr("cy", function(d) { return y(d.value); })
                            .attr("r", 8)
                            .attr("class", function(d, i) {
                                if (i === 8) {
                                    return "circle-"+d.name;
                                }
                                return "circle-hidden";
                            });

                        // update point
                        group.select('.line-point')
                            .selectAll('circle')
                            .data(function(d) { return d.values; })
                            .attr("cx", function(d, i) { return x.rangeBand() * i + x.rangeBand() / 2; })
                            .attr("cy", function(d) { return y(d.value); });

                        // draw value
                        var value = group_enter.append('g')
                            .attr('class','line-value');

                        value.selectAll('text')
                            .data(function(d) { return d.values; })
                            .enter().append('text')
                            .attr("x", function(d, i) { return x.rangeBand() * i + x.rangeBand() / 2; })
                            .attr("y", function(d) { return y(d.value); })
                            .attr('dy', -10)
                            .attr("text-anchor", "middle")
                            .text(function(d) { return d.value + "˚"; })
                            .attr("class", function(d, i) {
                                if (d.min === true || d.max === true) {
                                    return "text-" + d.name;
                                }
                                return "text-hidden";
                            });

                        // update value
                        group.select('.line-value')
                            .selectAll('text')
                            .data(function(d) { return d.values; })
                            .attr("x", function(d, i) { return x.rangeBand() * i + x.rangeBand() / 2; })
                            .attr("y", function(d) { return y(d.value); })
                            .text(function(d) { return d.value + "˚"; });
                    }
                });
            }
        };
    });