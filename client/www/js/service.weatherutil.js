angular.module('service.weatherutil', [])
    .factory('WeatherUtil', function ($q, $http, Util, Units) {
        var obj = {};

        /**
         *
         * @param retryCount
         * @param url
         * @param callback
         * @private
         */
        function _retryGetHttp(retryCount, url, timeout, callback) {
            if (typeof timeout === 'function') {
                timeout = null;
                callback = timeout;
            }

            var retryTimeId = setTimeout(function () {
                retryCount--;
                if (retryCount > 0) {
                    _retryGetHttp(retryCount, url, timeout, callback);
                }
            }, 1500);

            console.log("retry="+retryCount+" get http");

            timeout = timeout || 6000;

            var options = {method: 'GET', url: url, timeout: timeout};

            $http(options)
                .success(function (data, status, headers, config, statusText) {
                    console.log('clear timeout = '+ retryTimeId);
                    clearTimeout(retryTimeId);
                    console.log("s="+status+" h="+headers+" c="+config+" sT="+statusText);
                    callback(undefined, data);
                })
                .error(function (data, status, headers, config, statusText) {
                    console.log('clear timeout = '+ retryTimeId);
                    clearTimeout(retryTimeId);
                    console.log("d="+data+" s="+status+" h="+headers+" c="+config+" sT="+statusText);
                    data = data || "Request failed";
                    var err = new Error(data);
                    err.code = status;
                    callback(err);
                });
        }

        /**
         * call retryGetHttp 3 times, 1.5초마다 호출해서 3회함. 3번째 6초 대기 하면 총 9초 timeout
         * @param url
         * @param timeout
         * @private
         */
        function _getHttp (url, timeout) {
            var deferred = $q.defer();
            if (url == undefined || url === "") {
                deferred.reject(new Error("Invalid url="+url));
                return deferred.promise;
            }

            console.log({url:url});

            _retryGetHttp(3, url, timeout, function (err, data) {
                if (err != undefined) {
                    return deferred.reject(err);
                }
                deferred.resolve({data: data});
            });
            return deferred.promise;
        }

        /**
         *
         * @returns {string}
         * @private
         */
        function _getUnitsParams() {
            var url = "";
            var units = Units.getAllUnits();
            var count = 0;
            for (var key in units) {
                url += count === 0? "?":"&";
                url += key+'='+units[key];
                count++;
            }
            return url;
        }

        /**
         *
         * @param location
         * @param funcName
         * @returns {string}
         * @private
         */
        function _makeQueryUrlWithLocation (location, funcName) {
            var url = twClientConfig.serverUrl;
            url += '/'+funcName+'/coord/'+ location.lat + ','+location.long;
            if (funcName === 'weather') {
                url += _getUnitsParams();
            }
            return url;
        }

        /**
         *
         * @param addr
         * @param funcName
         * @returns {string}
         * @private
         */
        function _makeQueryUrlWithAddr (addr, funcName) {
            var url = twClientConfig.serverUrl;
            url += '/'+funcName+'/addr/'+ addr;
            if (funcName === 'weather') {
                url += _getUnitsParams();
            }
            return url;
        }

        /**
         *
         * @param town {{first: String, second: String, third: String}}
         * @returns {string|string|string|string}
         * @private
         */
        function _makeQueryUrlWithTown (town) {
            var url = twClientConfig.serverUrl;
            url += '/v000901/kma/addr';
            if (town.first !== '') {
                url += '/' + town.first;
            }
            if (town.second !== '') {
                url += '/' + town.second;
            }
            if (town.third !== '') {
                url += '/' + town.third;
            }

            url += _getUnitsParams();

            return url;
        }

        /**
         * location -> geoInfo
         * @param location
         */
        obj.getGeoInfoByLocation = function (location) {
            var deferred = $q.defer();
            var url;
            try{
                url = _makeQueryUrlWithLocation(location, 'geocode');
            }
            catch(err) {
                deferred.reject(err);
                return deferred.promise;
            }

            _getHttp(url).then(
                function (data) {
                    deferred.resolve(data.data);
                },
                function (err) {
                    deferred.reject(err);
                });

            return deferred.promise;
        };

        /**
         * address -> geoInfo
         * @param addr
         */
        obj.getGeoInfoByAddr = function (addr) {
            var deferred = $q.defer();
            var url;
            try {
                url = _makeQueryUrlWithAddr(addr, 'geocode');
            }
            catch(err) {
                deferred.reject(err);
                return deferred.promise;
            }

            _getHttp(url).then(
                function (data) {
                    deferred.resolve(data.data);
                },
                function (err) {
                    deferred.reject(err);
                });

            return deferred.promise;
        };

        /**
         * geoInfo -> weather data
         * old city data에 location이 없는 경우가 있음
         * @param geoInfo
         * @returns {Promise}
         */
        obj.getWeatherByGeoInfo = function (geoInfo) {
            var promises = [];
            var deferred = $q.defer();
            var url;
            try{
                Util.ga.trackEvent('weather', 'param', JSON.stringify(geoInfo));

                if (geoInfo.location && geoInfo.location.lat) {
                    url = _makeQueryUrlWithLocation(geoInfo.location, 'weather');
                }
                else if (geoInfo.address) {
                    var town = this.getTownFromFullAddress(this.convertAddressArray(geoInfo.address));

                    if (town.first=="" && town.second=="" && town.third=="") {
                        //town invalid
                        url = _makeQueryUrlWithAddr(geoInfo.address, 'weather');
                    }
                    else {
                        url = _makeQueryUrlWithTown(town);
                    }
                }
                else {
                    throw new Error("Need location or address for getting weather geoinfo="+JSON.stringify(geoInfo));
                }
            }
            catch(err) {
                deferred.reject(err);
                return deferred.promise;
            }

            promises.push(_getHttp(url));
            return $q.all(promises);
        };

        /**
         * handle of watch position in getCurrentPosition
         */
        var watchID;

        obj.getCurrentPosition = function () {
            var deferred = $q.defer();
            var startTime = new Date().getTime();
            var endTime;

            console.log('watchID : '+watchID);
            if (watchID) {
                deferred.reject("alreadyCalled");
                return deferred.promise;
            }

            //경기도,광주시,오포읍
            //position = {coords: {latitude: 37.36340556, longitude: 127.2307667}};
            //세종특별자치시,,도담동
            //position = {coords: {latitude: 36.517338, longitude: 127.259247}};
            //경기도 부천시 소사본동
            //position = {coords: {latitude: 37.472595, longitude: 126.795249}};
            //경상남도/거제시옥포2동 "lng":128.6875, "lat":34.8966
            //deferred.resolve({latitude: 34.8966, longitude: 128.6875});
            //서울특별시
            //deferred.resolve({latitude: 37.5635694, longitude: 126.9800083});
            //경기 수원시 영통구 광교1동
            //deferred.resolve({latitude: 37.298876, longitude: 127.047527});
            // Tokyo 35.6894875,139.6917064
            // position = {coords: {latitude: 35.6894875, longitude: 139.6917064}};
            // Shanghai 31.227797,121.475194
            //position = {coords: {latitude: 31.227797, longitude: 121.475194}};
            // NY 40.663527,-73.960852
            //position = {coords: {latitude: 40.663527, longitude: -73.960852}};
            // Berlin 52.516407,13.403322
            //position = {coords: {latitude: 52.516407, longitude: 13.403322}};
            // Hochinminh 10.779001,106.662796
            //position = {coords: {latitude: 10.779001, longitude: 106.662796}};
            //경상북도/영천시/대전동
            //position = {coords: {latitude: 35.9859147103, longitude: 128.9122925322}};
            //경기도,성남시분당구,,62,123,127.12101944444444,37.37996944444445
            //position = {coords: {latitude: 37.37996944444445, longitude: 127.12101944444444}};
            //인천광역시,연수구,,55,123,126.68044166666667,37.40712222222222
            //position = {coords: {latitude: 37.40712222222222, longitude: 126.68044166666667}};

            watchID = navigator.geolocation.watchPosition(function (position) {
                endTime = new Date().getTime();
                Util.ga.trackTiming('position', endTime - startTime, 'get', 'watch');
                Util.ga.trackEvent('position', 'get', 'watch', endTime - startTime);
                navigator.geolocation.clearWatch(watchID);
                watchID = null;
                deferred.resolve({coords: position.coords, provider: 'watchPosition'});
            }, function (error) {
                Util.ga.trackEvent('position', 'warn', 'watch(message: ' + error.message + ', code:' + error.code + ')', endTime - startTime);
                return deferred.reject();
            }, { timeout: 60000, maximumAge: 60000, enableHighAccuracy: true});

            return deferred.promise;
        };

        /**
         * wsd : 풍속 4~8 약간 강, 9~13 강, 14~ 매우강
         * pm10Value, pm10Grade
         * {date: String, lgt: Number, mx: Number, my: Number, pty: Number, reh: Number, rn1: Number,
         *          sky: Number, t1h: Number, time: String, uuu: Number, vec: Number, vvv: Number,
         *          wsd: Number}
         * @param currentTownWeather
         * @param units
         * @returns {{}}
         */
        function _parseCurrentTownWeather(currentTownWeather) {
            var currentForecast = {};

            if (!currentTownWeather) {
                return currentForecast;
            }
            currentForecast = currentTownWeather;

            return currentForecast;
        }

        /**
         * @param {Object[]} shortForecastList
         * @returns {{timeTable: Array, timeChart: Array}}
         */
        function _parseShortTownWeather(shortForecastList) {
            var data = [];

            if (!shortForecastList || !Array.isArray(shortForecastList)) {
                return {timeTable: [], timeChart: []};
            }

            var currentIndex = -1;
            var displayItemCount = 0;

            shortForecastList.every(function (shortForecast, index) {
                var tempObject;
                var diffDays = shortForecast.fromToday;

                tempObject = shortForecast;

                if (tempObject.currentIndex) {
                    currentIndex = index;
                }

                var tmpDisplayCount = 0;
                //data on chart from yesterday
                if (diffDays > -2) {
                    if (tempObject.skyIcon != undefined) {
                        tmpDisplayCount++;
                    }
                    if (tempObject.pop && tempObject.pop > 0) {
                        tmpDisplayCount++;
                    }
                    if (displayItemCount == 2) {
                        if ((tempObject.rn1 && tempObject.rn1 > 0)
                            || (tempObject.r06 && tempObject.r06 > 0)
                            || (tempObject.s06 && tempObject.s06 > 0)) {
                            tmpDisplayCount++;
                        }
                    }
                    if (tmpDisplayCount > displayItemCount) {
                        displayItemCount = tmpDisplayCount;
                    }
                }

                data.push(tempObject);

                return true;
            });

            var timeTable = data.slice(8);
            var timeChart = [
                {
                    name: "yesterday",
                    values: data.slice(0, data.length - 8).map(function (d) {
                        return {name: "yesterday", value: d};
                    })
                },
                {
                    name: "today",
                    values: data.slice(8).map(function (d) {
                        return {name: "today", value: d};
                    }),
                    currentIndex: currentIndex - 8,
                    displayItemCount: displayItemCount
                }
            ];

            return {timeTable: timeTable, timeChart: timeChart};
        }

        /**
         *
         * 식중독, ultra 자외선,
         * @param midData
         * @returns {*}
         */
        function _parseMidTownWeather(midData) {
            var tmpDayTable = [];
            var displayItemCount = 0;
            var todayInfo = null;

            if (!midData || !midData.hasOwnProperty('dailyData') || !Array.isArray(midData.dailyData)) {
                return {displayItemCount: displayItemCount, dayTable: tmpDayTable};
            }
            midData.dailyData.forEach(function (dayInfo, index) {
                var data;
                data = dayInfo;

                if (data.fromToday == 0) {
                    todayInfo = data;
                    todayInfo.index = index;
                }

                tmpDayTable.push(data);

                var tmpDisplayCount = 0;

                if (data.skyAm != undefined || data.skyPm != undefined) {
                    if (data.skyAm != data.skyPm && data.skyAm && data.skyPm) {
                        tmpDisplayCount = tmpDisplayCount | 4;
                    }
                }

                if (data.pop && data.pop > 0 && data.fromToday >= 0) {
                    tmpDisplayCount = tmpDisplayCount | 2;
                }
                if ((data.rn1 && data.rn1 > 0)
                    || (data.r06 && data.r06 > 0)
                    || (data.s06 && data.s06 > 0)) {
                    tmpDisplayCount = tmpDisplayCount | 1;
                }
                if (tmpDisplayCount > displayItemCount) {
                    displayItemCount = tmpDisplayCount;
                }
            });

            //console.log(tmpDayTable);
            return {displayItemCount: displayItemCount, dayTable: tmpDayTable, today: todayInfo};
        }

        function _parseKmaWeather(weatherData) {
            var data = {};

            try {
                var midTownWeather = _parseMidTownWeather(weatherData.midData);
                var currentForecast = _parseCurrentTownWeather(weatherData.current);
                currentForecast.today = midTownWeather.today;

                var shortTownWeather = _parseShortTownWeather(weatherData.short);

                data.currentWeather = currentForecast;
                data.timeTable = shortTownWeather.timeTable;
                data.timeChart = shortTownWeather.timeChart;
                data.dayChart = [{
                    values: midTownWeather.dayTable,
                    temp: currentForecast.t1h,
                    displayItemCount: midTownWeather.displayItemCount
                }];
                if (weatherData.air_forecast) {
                    data.air_forecast = weatherData.air_forecast;
                }
                data.source = "KMA";
            }
            catch (err) {
                Util.ga.trackEvent('weather', 'error', 'parseKmaWeather');
                Util.ga.trackException(err, false);
                if (twClientConfig && twClientConfig.debug) {
                    alert(err.message);
                }
                return null;
            }

            return data;
        }

        function _parseWorldCurrentWeather(thisTime) {
            var current = thisTime[1];
            current.yesterday = thisTime[0];
            return current;
        }

        function _parseWorldHourlyWeather(hourly) {
            var data = [];

            if (!hourly || !Array.isArray(hourly)) {
                console.log('hourly is not array');
                return {timeTable: [], timeChart: []};
            }

            var currentIndex;
            var displayItemCount = 0;

            hourly.forEach(function (hourlyObj, index) {
                var tempObject = hourlyObj;
                var diffDays = hourlyObj.fromToday;

                if (tempObject.currentIndex) {
                    currentIndex = index;
                }

                var tmpDisplayCount = 0;
                //data on chart from yesterday
                if (diffDays > -2) {
                    if (tempObject.skyIcon != undefined) {
                        tmpDisplayCount++;
                    }
                    if (tempObject.pop && tempObject.pop > 0) {
                        tmpDisplayCount++;
                    }
                    if (displayItemCount == 2) {
                        if ((tempObject.rn1 && tempObject.rn1 > 0)
                            || (tempObject.r06 && tempObject.r06 > 0)
                            || (tempObject.s06 && tempObject.s06 > 0)) {
                            tmpDisplayCount++;
                        }
                    }
                    if (tmpDisplayCount > displayItemCount) {
                        displayItemCount = tmpDisplayCount;
                    }
                }

                data.push(tempObject);
            });

            console.log(JSON.stringify(data));

            if (currentIndex == undefined) {
                console.log("Fail to find current index");
                currentIndex = hourly.length-1;
            }

            var timeTable = data.slice(8);
            var timeChart = [
                {
                    name: "yesterday",
                    values: data.slice(0, data.length - 8).map(function (d) {
                        return {name: "yesterday", value: d};
                    })
                },
                {
                    name: "today",
                    values: data.slice(8).map(function (d) {
                        return {name: "today", value: d};
                    }),
                    currentIndex: currentIndex - 8,
                    displayItemCount: displayItemCount
                }
            ];

            return {timeTable: timeTable, timeChart: timeChart};

        }

        function _parseWorldDailyWeather(daily) {

            var tmpDayTable = [];
            var displayItemCount = 0;
            var todayInfo = null;

            daily.forEach(function (dayInfo, index) {
                var data;
                data = JSON.parse(JSON.stringify(dayInfo));

                tmpDayTable.push(data);

                if (data.fromToday == 0) {
                    todayInfo = data;
                    todayInfo.index = index;
                }

                var tmpDisplayCount = 0;

                if (data.skyAm != undefined || data.skyPm != undefined) {
                    if (data.skyAm != data.skyPm && data.skyAm && data.skyPm) {
                        tmpDisplayCount = tmpDisplayCount | 4;
                    }
                }

                if (data.pop && data.pop > 0 && data.fromToday >= 0) {
                    tmpDisplayCount = tmpDisplayCount | 2;
                }
                if ((data.rn1 && data.rn1 > 0)
                    || (data.r06 && data.r06 > 0)
                    || (data.s06 && data.s06 > 0)) {
                    tmpDisplayCount = tmpDisplayCount | 1;
                }
                if (tmpDisplayCount > displayItemCount) {
                    displayItemCount = tmpDisplayCount;
                }
            });
            console.log(JSON.stringify(tmpDayTable));
            return {displayItemCount: displayItemCount, dayTable: tmpDayTable, today: todayInfo};
        }

        function _parseWorldWeather(weatherData) {
            var data = {};
            var midTownWeather;
            var shortTownWeather;

            try {
                midTownWeather =_parseWorldDailyWeather(weatherData.daily);
                shortTownWeather = _parseWorldHourlyWeather(weatherData.hourly);
                data.currentWeather = _parseWorldCurrentWeather(weatherData.thisTime);

                data.currentWeather.today = midTownWeather.today;
                data.timeTable = shortTownWeather.timeTable;
                data.timeChart = shortTownWeather.timeChart;
                data.dayChart = [{
                    values: midTownWeather.dayTable,
                    temp: data.currentWeather.t1h,
                    displayItemCount: midTownWeather.displayItemCount
                }];

                if (weatherData.hasOwnProperty('pubDate')) {
                    if (weatherData.pubDate.hasOwnProperty('DSF')) {
                       data.source = "DSF";
                    }
                }
            }
            catch (err) {
                Util.ga.trackEvent('weather', 'error', 'parseWorldWeather');
                Util.ga.trackException(err, false);
                if (twClientConfig && twClientConfig.debug) {
                    alert(err.message);
                }
                return null;
            }

            return data;
        }

        /**
         *
         * @param weatherDataList
         * @returns {{}}
         */
        obj.convertWeatherData = function (weatherDataList) {
            var weatherData = {};
            weatherDataList.forEach(function (weatherObject) {
                if (weatherObject.hasOwnProperty("data")) {
                    weatherData = weatherObject.data;
                }
            });

            if (weatherData.hasOwnProperty('units')) {
                console.log({weatherUnits: weatherData.units});
            }
            else {
                Util.ga.trackEvent('weather', 'error', 'FailGetUnits');
            }

            var data;
            if (weatherData.source === 'KMA') {
                data = _parseKmaWeather(weatherData);
            }
            else {
                data = _parseWorldWeather(weatherData);
            }

            if (data) {
                ['name', 'address', 'country', 'location'].forEach(function (value) {
                    if (weatherData.hasOwnProperty(value)) {
                        data[value] = weatherData[value];
                    }
                });
            }
            else {
                //log event는 praser 안에서 전달함.
                console.warn("Fail to parse weather data");
            }

            return data;
        };

        /**
         *
         * @param {String} fullAddress 대한민국 천하도 강남시 하늘구 가내동 33-2, 대한민국 서울특별시 라임구 마라동
         * @returns {String[]}
         */
        function _convertAddressArray(fullAddress) {
            var splitAddress = [];

            if (fullAddress && fullAddress.split) {
                splitAddress = fullAddress.split(" ");
            }
            return splitAddress;
        }

        /**
         * 남해군 같은 경우 군을 버리면 남해 라고 표시되어 이상해보이므로, 시,군 표시함.
         * @param name
         * @returns {*}
         * @private
         */
        function _getShortSiDoName(name) {
            //특별시, 특별자치시, 광역시,
            var aStr = ["특별시", "광역시", "특별자치시", "특별자치도"];
            for (var i=0; i<aStr.length; i++) {
                if (name.slice(-1*aStr[i].length) === aStr[i]) {
                    if (i === aStr.length-1) {
                        return name.replace(aStr[i], "도");
                    }
                    else {
                        return name.replace(aStr[i], "시");
                    }
                }
            }

            return name;
        }

        /**
         * It's supporting only korean lang
         * return si+dong, si+gu, si or do
         * @param {String} fullAddress
         * @returns {string}
         */
        obj.getShortenAddress = function (fullAddress) {
            var parsedAddress = _convertAddressArray(fullAddress);

            if (!parsedAddress || parsedAddress.length < 2) {
                console.log("Fail to split full address="+fullAddress);
                return "";
            }

            if (parsedAddress.length === 5) {
                //nation + do + si + gu + dong
                return _getShortSiDoName(parsedAddress[2])+","+parsedAddress[4];
            }
            else if (parsedAddress.length === 4) {
                if (parsedAddress[1].slice(-1) === '도') {
                    //nation + do + si + gu
                    return _getShortSiDoName(parsedAddress[2])+","+parsedAddress[3];
                }
                else {
                    //nation + si + gu + dong
                    return _getShortSiDoName(parsedAddress[1])+","+parsedAddress[3];
                }
            }
            else if (parsedAddress.length === 3) {
                //nation + do + si
                //nation + si + gu
                //nation + si + eup,myeon
                return _getShortSiDoName(parsedAddress[1])+","+parsedAddress[2];
            }
            else if (parsedAddress.length === 2) {
                //nation + si,do
                return _getShortSiDoName(parsedAddress[1]);
            }
            else {
                console.log("Fail to get shorten from ="+fullAddress);

            }
            return "";
        };

        /**
         *
         * @param addressArray
         * @returns {{first: string, second: string, third: string}}
         */
        obj.getTownFromFullAddress = function (addressArray) {
            var town = {first: "", second: "", third: ""};
            if (!Array.isArray(addressArray) || addressArray.length === 0) {
                console.log("addressArray is invalid");
                return town;
            }

            if (addressArray.length === 5) {
                //nation + do + si + gu + dong
                town.first = addressArray[1];
                town.second = addressArray[2]+addressArray[3];
                town.third = addressArray[4];
            }
            else if (addressArray.length === 4) {
                town.first = addressArray[1];
                if (addressArray[3].slice(-1) === '구') {
                    //nation + do + si + gu
                    town.second = addressArray[2]+addressArray[3];
                }
                else {
                    //nation + si + gu + dong
                    town.second = addressArray[2];
                    town.third = addressArray[3];
                }
            }
            else if (addressArray.length === 3) {
                if (addressArray[2].slice(-1) === '읍' || addressArray[2].slice(-1) === '면' ||
                    addressArray[2].slice(-1) === '동')
                {
                    //nation + si + myeon,eup,dong
                    town.first = addressArray[1];
                    town.second = addressArray[1];
                    town.third = addressArray[2];
                }
                else {
                    //nation + si,do + si, gun, gu
                    town.first = addressArray[1];
                    town.second = addressArray[2];
                }
            }
            else if (addressArray.length === 2) {
               //nation + si,do
                town.first = addressArray[1];
            }
            else {
                var err = new Error("Fail to parse address array="+addressArray.toString());
                console.log(err);
            }
            return town;
        };

        /**
         *
         * @param {String} fullAddress 대한민국 천하도 강남시 하늘구 가내동 33-2, 대한민국 서울특별시 라임구 마라동
         * @returns {String[]}
         */
        obj.convertAddressArray = function (fullAddress) {
            var splitAddress = [];

            if (fullAddress && fullAddress.split) {
                splitAddress = fullAddress.split(" ");
            }
            return splitAddress;
        };

        /**
         * share 기능을 위한 skyIcon -> emoji
         * @param skyIcon
         * @returns {string}
         */
        obj.getWeatherEmoji = function (skyIcon) {
            if (skyIcon.indexOf('Lightning') != -1) {
                return '\u26c8';
            }
            else if (skyIcon.indexOf('RainSnow') != -1) {
                return '\u2614\u2603';
            }
            else if (skyIcon.indexOf('Rain') != -1) {
                return '\u2614';
            }
            else if (skyIcon.indexOf('Snow') != -1) {
                return '\u2603';
            }
            else if (skyIcon.indexOf('Cloud') != -1) {
                if (skyIcon.indexOf('Sun') != -1 || skyIcon.indexOf('Moon') != -1) {
                    return '\u26c5';
                }
                else {
                    return '\u2601';
                }
            }
            else if (skyIcon.indexOf('Sun') != -1 || skyIcon.indexOf('Moon') != -1) {
                return '\ud83c\udf1e';
            }

            console.log('Fail to find emoji skyIcon='+skyIcon);
            return '';
        };
        //endregion

        /**
         * @param coords
         * @returns {{lat: number, long: number}}
         */
        obj.geolocationNormalize = function (coords) {
            //var baseLength = 0.02;
            //var lat = coords.lat;
            //var lon = coords.long;
            //console.log (lat + " " + lon);
            //
            //hochimin의 경우 106.6296638 가 두자리로 떨어지지 않음.
            //var normal_lat = lat - (lat%baseLength) + baseLength/2;
            //var normal_lon = lon - (lon%baseLength) + baseLength/2;
            //return {lat: normal_lat, long: normal_lon};

            return {lat: parseFloat(coords.lat.toFixed(3)), long: parseFloat(coords.long.toFixed(3))}
        };

        /**
         * 현재는 KR하나만 있음.
         * @param nationCode
         */
        obj.getNationWeather = function (nationCode) {
            var deferred = $q.defer();
            var url;
            try{
                url = twClientConfig.serverUrl;
                url += '/v000901/nation/'+nationCode;
                url += _getUnitsParams();
            }
            catch(err) {
                deferred.reject(err);
                return deferred.promise;
            }

            _getHttp(url, 20000).then(
                function (data) {
                    deferred.resolve(data.data);
                },
                function (err) {
                    deferred.reject(err);
                });

            return deferred.promise;
        };

        return obj;
    });
