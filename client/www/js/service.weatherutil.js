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
            }, 2000);

            console.log("retry="+retryCount+" get http");

            timeout = timeout || 10000;

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
            url += '&airForecastSource=kaq';
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
            var url = clientConfig.serverUrl;
            url += '/'+funcName+'/v000903'+'/coord/'+ location.lat + ','+location.long;
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
            var url = clientConfig.serverUrl;
            url += '/'+funcName+'/v000903'+'/addr/'+ addr;
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
            var url = clientConfig.serverUrl;
            url += '/v000903/kma/addr';
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
                if (weatherData.airInfo) {
                    data.airInfo = weatherData.airInfo;
                }
                if (weatherData.airInfoList) {
                    data.airInfoList = weatherData.airInfoList;
                }
                data.source = "KMA";
            }
            catch (err) {
                Util.ga.trackEvent('weather', 'error', 'parseKmaWeather');
                Util.ga.trackException(err, false);
                if (clientConfig && clientConfig.debug) {
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

                if (weatherData.airInfo) {
                    data.airInfo = weatherData.airInfo;
                }
                if (weatherData.airInfoList) {
                    data.airInfoList = weatherData.airInfoList;
                }
            }
            catch (err) {
                Util.ga.trackEvent('weather', 'error', 'parseWorldWeather');
                Util.ga.trackException(err, false);
                if (clientConfig && clientConfig.debug) {
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
            if (skyIcon.indexOf('lightning') != -1) {
                return '\u26c8';
            }
            else if (skyIcon.indexOf('rainsnow') != -1) {
                return '\u2614\u2603';
            }
            else if (skyIcon.indexOf('rain') != -1) {
                return '\u2614';
            }
            else if (skyIcon.indexOf('snow') != -1) {
                return '\u2603';
            }
            else if (skyIcon.indexOf('cloud') != -1) {
                if (skyIcon.indexOf('sun') != -1 || skyIcon.indexOf('moon') != -1) {
                    return '\u26c5';
                }
                else {
                    return '\u2601';
                }
            }
            else if (skyIcon.indexOf('sun') != -1 || skyIcon.indexOf('moon') != -1) {
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
                url = clientConfig.serverUrl;
                url += '/v000903/nation/'+nationCode;
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

        obj.loadWeatherPhotos = function () {
            var deferred = $q.defer();
            var url = clientConfig.weatherPhotosUrl;

            _getHttp(url, 20000).then(
                function (data) {
                    window.weatherPhotos = {
                        lightning: [],
                        rain: [],
                        snow: [],
                        sun_smallcloud: [],
                        sun_bigcloud: [],
                        sun: [],
                        moon_smallcloud: [],
                        moon_bigcloud: [],
                        moon: [],
                        cloud: []
                    };

                    for (var i = 0; i < data.data.length; i++) {
                        if (angular.isArray(data.data[i].tags) === false) {
                            continue;
                        }

                        var tag = data.data[i].tags.join('_');
                        if (tag.indexOf("lightning") != -1) {
                            window.weatherPhotos.lightning.push(data.data[i]);
                        }
                        else if (tag.indexOf("rain") != -1) {
                            window.weatherPhotos.rain.push(data.data[i]);
                        }
                        else if (tag.indexOf("snow") != -1) {
                            window.weatherPhotos.snow.push(data.data[i]);
                        }
                        else if (tag.indexOf("sun") != -1) {
                            if (tag.indexOf("smallcloud") != -1) {
                                window.weatherPhotos.sun_smallcloud.push(data.data[i]);
                            }
                            else if (tag.indexOf("bigcloud") != -1) {
                                window.weatherPhotos.sun_bigcloud.push(data.data[i]);
                            }
                            else {
                                window.weatherPhotos.sun.push(data.data[i]);
                            }
                        }
                        else if (tag.indexOf("moon") != -1) {
                            if (tag.indexOf("smallcloud") != -1) {
                                window.weatherPhotos.moon_smallcloud.push(data.data[i]);
                            }
                            else if (tag.indexOf("bigcloud") != -1) {
                                window.weatherPhotos.moon_bigcloud.push(data.data[i]);
                            }
                            else {
                                window.weatherPhotos.moon.push(data.data[i]);
                            }
                        }
                        else if (tag.indexOf("cloud") != -1) {
                            window.weatherPhotos.cloud.push(data.data[i]);
                        }
                    }

                    deferred.resolve();
                },
                function (err) {
                    deferred.reject(err);
                });

            return deferred.promise;
        };

        obj.findWeatherPhoto = function (currentWeather) {
            if (window.weatherPhotos == undefined) {
                return null;
            }

            if (currentWeather && currentWeather.skyIcon) {
                var keys = ['lightning', 'rain', 'snow', 'sun_smallcloud', 'sun_bigcloud', 'sun',
                    'moon_smallcloud', 'moon_bigcloud', 'moon', 'cloud'];

                for (var i = 0; i < keys.length; i++) {
                    if (currentWeather.skyIcon.indexOf(keys[i]) != -1) {
                        var photos = window.weatherPhotos[keys[i]];
                        if (photos && photos.length > 0) {
                            return photos[Math.floor(Math.random() * (photos.length - 1))].twUrls.regular;
                        }
                    }
                }
            }
            return null;
        };

        obj.aqiStandard = {
            "airkorea": {
                "color": ['#32a1ff', '#00c73c', '#fd9b5a', '#ff5959'],
                "str": ['LOC_GOOD', 'LOC_MODERATE', 'LOC_UNHEALTHY', 'LOC_VERY_UNHEALTHY'],
                "value": {
                    "pm25" : [0, 15, 35, 75, 500],     //ug/m3 (avg 24h)
                    "pm10" : [0, 30, 80, 150, 600],     //ug/m3 (avg 24h)
                    "o3" : [0, 0.03, 0.09, 0.15, 0.6],  //ppm   (avg 1h)
                    "no2" : [0, 0.03, 0.06, 0.2, 2],    //ppm   (avg 1h)
                    "co" : [0, 2, 9, 15, 50],           //ppm   (avg 1h)
                    "so2" : [0, 0.02, 0.05, 0.15, 1],   //ppm   (avg 1h)
                    "aqi" : [0, 50, 100, 250, 500]      //index
                },
                "maxValue": {
                    "pm25" : 100,
                    "pm10" : 150,
                    "o3" : 0.15,
                    "no2" : 0.2,
                    "co" : 9,
                    "so2" : 0.05,
                    "aqi" : 250
                }
            },
            "airkorea_who": {
                "color": ['#32a1ff', '#00c73c', '#fd9b5a', '#ff5959'],
                "str": ['LOC_GOOD', 'LOC_MODERATE', 'LOC_UNHEALTHY', 'LOC_VERY_UNHEALTHY'],
                "value": {
                    "pm25" : [0, 15, 25, 50, 500],      //ug/m3
                    "pm10" : [0, 30, 50, 100, 600],     //ug/m3
                    "o3" : [0, 0.03, 0.09, 0.15, 0.6],  //ppm
                    "no2" : [0, 0.03, 0.06, 0.2, 2],    //ppm
                    "co" : [0, 2, 9, 15, 50],           //ppm
                    "so2" : [0, 0.02, 0.05, 0.15, 1],   //ppm
                    "aqi" : [0, 50, 100, 250, 500]      //ppm
                },
                "maxValue": {
                    "pm25" : 100,
                    "pm10" : 150,
                    "o3" : 0.15,
                    "no2" : 0.2,
                    "co" : 9,
                    "so2" : 0.05,
                    "aqi" : 250
                }
            },
            "airnow": {
                "color": ['#00c73c', '#d2d211',
                    '#ff6f00', '#FF0000',
                    '#b4004b', '#940021'],
                "str": ['LOC_GOOD', 'LOC_MODERATE', 'LOC_UNHEALTHY_FOR_SENSITIVE_GROUPS',
                    'LOC_UNHEALTHY', 'LOC_VERY_UNHEALTHY', 'LOC_HAZARDOUS'],
                "value": {
                    "pm25" : [0, 12.0, 35.4, 55.4, 150.4, 250.4, 500.4],    //ug/m3 (avg 24h)
                    "pm10" : [0, 54, 154, 254, 354, 424, 604],              //ug/m3 (avg 24h)
                    "o3" : [0, 0.054, 0.124, 0.164, 0.204, 0.404, 0.604],   //ppm (avg 8h, 1h)
                    "no2" : [0, 0.053, 0.1, 0.36, 0.649, 1.249, 2.049],     //ppm (avg 1h)
                    "co" : [0, 4.4, 9.4, 12.4, 15.4, 30.4, 50.4],           //ppm (avg 8h)
                    "so2" : [0, 0.035, 0.75, 0.185, 0.304, 0.604, 1.004],   //ppm (avg 1h, 24h)
                    "aqi" : [0, 50, 100, 150, 200, 300, 500]                //index
                    //"o3" : [0, 54, 124, 164, 204, 404, 604],              //ppb (avg 8h, 1h)
                    //"no2" : [0, 53, 100, 360, 649, 1249, 2049],           //ppb (avg 1h)
                    //"so2" : [0, 35, 75, 185, 304, 604, 1004],             //ppb (avg 1h, 24h)
                },
                "maxValue": {
                    "pm25" : 100,
                    "pm10" : 150,
                    "o3" : 0.164,
                    "no2" : 0.36,
                    "co" : 12.4,
                    "so2" : 0.185,
                    "aqi" : 200
                }
            },
            "aqicn": {
                "color": ['#00c73c', '#d2d211',
                    '#ff6f00', '#FF0000',
                    '#b4004b', '#940021'],
                "str": ['LOC_GOOD', 'LOC_MODERATE', 'LOC_UNHEALTHY_FOR_SENSITIVE_GROUPS',
                    'LOC_UNHEALTHY', 'LOC_VERY_UNHEALTHY', 'LOC_HAZARDOUS'],
                "value": {
                    "pm25" : [0, 35, 75, 115, 150, 250, 500],               //ug/m3 (avg 1h)
                    "pm10" : [0, 50, 150, 250, 350, 420, 600],              //ug/m3 (avg 1h)
                    "o3" : [0, 0.075, 0.093, 0.14, 0.187, 0.374, 0.56],     //ppm (avg 1h)
                    "no2" : [0, 0.049, 0.097, 0.341, 0.584, 1.14, 1.87],    //ppm (avg 1h)
                    "co" : [0, 4, 8, 28, 48, 72, 120],                      //ppm (avg 1h)
                    "so2":[0, 0.052, 0.175, 0.227, 0.28, 0.56, 0.916],      //ppm (avg 1h)
                    "aqi" : [0, 50, 100, 150, 200, 300, 500]                //index
                    // "o3" : [0, 160, 200, 300, 400, 800, 1200],    //ug/m3 (avg 1h)
                    // "no2" : [0, 100, 200, 700, 1200, 2340, 3840], //ug/m3 (avg 1h)
                    // "co" : [0, 5, 10, 35, 60, 90, 150],          //mg/m3 (avg 1h)
                    // "so2" : [0, 150, 500, 650, 800, 1600, 2620],  //ug/m3
                },
                "maxValue": {
                    "pm25" : 100,
                    "pm10" : 150,
                    "o3" : 0.14,
                    "no2" : 0.341,
                    "co" : 28,
                    "so2" : 0.227,
                    "aqi" : 200
                }
            }
        };

        return obj;
    });
