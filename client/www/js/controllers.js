angular.module('starter.controllers', [])

    .controller('DashCtrl', function($scope, $cordovaGeolocation, $http) {
        $scope.location = "Current Position Searching...";
        $scope.address = "";
        $scope.timeTable = [];
        for(var i=0; i<3; i++) {
            for (var j=0; j<24; j+=3) {
                tempObject = {day: i, hour: j,
                                    tempIcon: 'temp-10', temp: 30,
                                    weatherIcon: 'weatherIcon', pop: 20}; //Probability of precipitation

                $scope.timeTable.push(tempObject);
            }
        }

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
