angular.module('starter.controllers', [])

    .controller('DashCtrl', function($scope, $ionicScrollDelegate, $cordovaGeolocation, $timeout, $http) {
        $scope.location = "Current Position Searching...";
        $scope.address = "";
        $scope.timeTable = [];

        function getDayString(day, hours) {
            if (hours !== 0) {
                return '';
            }
            switch (day) {
                case 0: return '어제';
                case 1: return '오늘';
                case 2: return '내일';
                case 3: return '모레';
                default : console.error("Fail to get day string day="+day+" hours="+hours);
            }
        }
        function getTimeString(positionHours, day, hours) {
            if (positionHours === hours && day === 1) {
                return '지금';
            }
            return hours+'시';
        }
        function getPositionHours(currentHours) {
            return Math.floor(currentHours/3)*3;
        }
        function makeTimeTable(currentHours) {
            var positionHours = getPositionHours(currentHours);
            var day = 0;
            var hours = positionHours;
            for(var i=0; i<3; i++) {
                for (var j = 0; j<8; j++) {
                    tempObject = {day: getDayString(day, hours), hour: getTimeString(positionHours, day, hours),
                        tempIcon: 'temp-10', temp: 30,
                        weatherIcon: 'weatherIcon', pop: 20}; //Probability of precipitation

                    $scope.timeTable.push(tempObject);

                    hours += 3;
                    if (hours == 24) {
                        hours = 0;
                        day += 1;
                    }
                }
            }
        }
        makeTimeTable((new Date()).getHours());

        $scope.doRefresh = function() {
            setTimeout(function() {
                    // Stop the ion-refresher from spinning
                    $scope.$broadcast('scroll.refreshComplete');
                },
                3000);
            //$http.get('/new-items')
            //    .success(function(newItems) {
            //        $scope.items = newItems;
            //    })
            //    .finally(function() {
            //        // Stop the ion-refresher from spinning
            //        $scope.$broadcast('scroll.refreshComplete');
            //    });
        };

        $cordovaGeolocation.getCurrentPosition().then(function(position) {
            var lat  = position.coords.latitude;
            var long = position.coords.longitude;
            $scope.location = "latitude : "+lat+", longitude : "+long;

            var url = "http://maps.googleapis.com/maps/api/geocode/json?latlng="+lat+","+long+"&sensor=true";
            $http({method: 'GET', url: url}).
                success(function(data, status, headers, config) {
                    $scope.address = data.results[0].formatted_address;
                }).
                error(function(data, status, headers, config) {
                    $scope.address = "error";
                });
        }, function(err) {
            $scope.location = "error";
        });

        $scope.temp = [
            { id: 1, yesterday: 1, today: 16.2 },
            { id: 2, yesterday: 2, today: 19.1 },
            { id: 3, yesterday: 3, today: 18.5 },
            { id: 4, yesterday: 4, today: 26.1 },
            { id: 5, yesterday: 5, today: 22.4 },
            { id: 6, yesterday: 6, today: 22.5 },
            { id: 7, yesterday: 7, today: 32.2 },
            { id: 8, yesterday: 8, today: 33.3 },
            { id: 9, yesterday: 9, today: 18.9 },
            { id: 10, yesterday: 10, today: 18.1 },
            { id: 11, yesterday: 22.5, today: 16.2 },
            { id: 12, yesterday: 32.2, today: 19.1 },
            { id: 13, yesterday: 33.3, today: 5 },
            { id: 14, yesterday: 18.9, today: 4 },
            { id: 15, yesterday: 18.1, today: 4.1 },
            { id: 16, yesterday: 16.2, today: 9 },
            { id: 17, yesterday: 19.1, today: 8 },
            { id: 18, yesterday: 18.5, today: 7 },
            { id: 19, yesterday: 26.1, today: 6 },
            { id: 20, yesterday: 22.4, today: 5 },
            { id: 21, yesterday: 38.3, today: 4 },
            { id: 22, yesterday: 32.2, today: 3 },
            { id: 23, yesterday: 33.3, today: 2 },
            { id: 24, yesterday: 18.9, today: 1 }
        ];

        $scope.changeTemp = function() {
            $scope.temp = [
                { id: 1, yesterday: 22.5, today: 1 },
                { id: 2, yesterday: 32.2, today: 2 },
                { id: 3, yesterday: 33.3, today: 3 },
                { id: 4, yesterday: 18.9, today: 4 },
                { id: 5, yesterday: 18.1, today: 5 },
                { id: 6, yesterday: 16.2, today: 6 },
                { id: 7, yesterday: 19.1, today: 7 },
                { id: 8, yesterday: 18.5, today: 8 },
                { id: 9, yesterday: 26.1, today: 9 },
                { id: 10, yesterday: 22.4, today: 3.1 },
                { id: 11, yesterday: 38.3, today: 16.2 },
                { id: 12, yesterday: 32.2, today: 19.1 },
                { id: 13, yesterday: 33.3, today: 18.5 },
                { id: 14, yesterday: 18.9, today: 26.1 },
                { id: 15, yesterday: 18.1, today: 22.4 },
                { id: 16, yesterday: 9, today: 22.5 },
                { id: 17, yesterday: 8, today: 32.2 },
                { id: 18, yesterday: 7, today: 33.3 },
                { id: 19, yesterday: 6, today: 18.9 },
                { id: 20, yesterday: 5, today: 3.1 },
                { id: 21, yesterday: 4, today: 3.1 },
                { id: 22, yesterday: 3, today: 4.5 },
                { id: 23, yesterday: 2, today: 5 },
                { id: 24, yesterday: 1, today: 4 }
            ];
        };

        $timeout(function () {
            $ionicScrollDelegate.$getByHandle('chart').scrollTo(375, 0, false);
        }, 0);

    })

    .controller('ChatsCtrl', function($scope, Chats) {
        // With the new view caching in Ionic, Controllers are only called
        // when they are recreated or on app start, instead of every page change.
        // To listen for when this page is active (for example, to refresh data),
        // listen for the $ionicView.enter event:
        //
        //$scope.$on('$ionicView.enter', function(e) {
        //});

        $scope.chats = Chats.all();
        $scope.remove = function(chat) {
            Chats.remove(chat);
        };
    })

    .controller('ChatDetailCtrl', function($scope, $stateParams, Chats) {
        $scope.chat = Chats.get($stateParams.chatId);
    })

    .controller('AccountCtrl', function($scope) {
        $scope.settings = {
            enableFriends: true
        };
    });
