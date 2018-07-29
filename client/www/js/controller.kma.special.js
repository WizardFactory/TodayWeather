/**
 * Created by aleckim on 2018. 7. 15..
 */

var start = angular.module('controller.kma.special', []);

start.controller('KmaSpecialCtrl', function($scope, Util, $http, $ionicHistory) {

    $scope.onClose = function() {
        Util.ga.trackEvent('action', 'click', 'special weather back');
        //convertUnits
        $ionicHistory.goBack();
    };

    function _makeQueryUrl() {
        // var url = clientConfig.serverUrl;
        var url = 'http://localhost:3000';
        url += '/v000903'+'/kma/special';
        return url;
    }

    function getData(url, callback) {
        $http({method: 'GET', url: url, timeout: 3000, responseType: 'json'})
            .success(function (data, status, headers, config, statusText) {
                callback(undefined, data);
            })
            .error(function (data, status, headers, config, statusText) {
                var err = new Error(data || statusText || "Request failed");
                err.code = status;
                callback(err);
            });
    }

    function parseSpecialData(list) {
        var specialList;
        try {
            specialList = list;
            specialList.forEach(function (special) {
                var date = new Date(special.announcement);
                special.announcement = date.toLocaleDateString()+' '+date.toLocaleTimeString();
                special.comment = special.comment.replace(/\n/g, '<br>');
            });
        }
        catch (err) {
            Util.ga.trackException(err, false);
        }
        return specialList;
    }

    function init() {
        var url = _makeQueryUrl();
        getData(url, function (err, data) {
            if (err) {
                $scope.error = err;
                return Util.ga.trackException(err, false);
            }
            $scope.specialList = parseSpecialData(data);
        });
    }

    init();
});

