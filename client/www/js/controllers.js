angular.module('starter.controllers', [])

    .controller('DashCtrl', function($scope, $ionicPlatform, $ionicScrollDelegate, $ionicUser, $ionicPopup,
                                     $cordovaGeolocation, $timeout, $interval, $http)
    {
        $scope.skipGuide = false;

        //String
        $scope.address = "";

        //{time: Number, t1h: Number, sky: String, tmn: Number, tmx: Number, summary: String};
        $scope.currentWeather;

        //{day: String, time: Number, t3h: Number, sky: String, pop: Number, tempIcon: String, tempInfo: String}
        $scope.timeTable = [];

        //[ {name: String, values:[{name: String, value: Number}, ]},
        //  {name: String, values:[{name: String, value: number}, ]} ]
        $scope.temp;

        //10월 8일(수) 12:23 AM
        $scope.currentTimeString;

        //String
        var fullAddress = "";
        var currentTime = new Date();

        //{"lat": Number, "long": Number};
        var location;

        /**
         * @param day
         * @param hours
         * @returns {*}
         */
        function getDayString(day, hours) {
            if (hours !== 0) {
                return '';
            }
            switch (day) {
                case -2: return '그제';
                case -1: return '어제';
                case 0: return '오늘';
                case 1: return '내일';
                case 2: return '모레';
                case 3: return '글피';
                default :
                    console.error("Fail to get day string day="+day+" hours="+hours);
                    return '';
            }
        }

        /**
         *
         * @param {number} positionHours
         * @param {number} day
         * @param {number} hours
         * @returns {String}
         */
        function getTimeString(positionHours, day, hours) {
            if (positionHours === hours && day === 0) {
                return '지금';
            }
            return hours+'시';
        }

        /**
         *
         * @param currentHours
         * @returns {number}
         */
        function getPositionHours(currentHours) {
            return Math.floor(currentHours/3)*3;
        }

        /**
         *
         * @param {Number} sky 맑음(1) 구름조금(2) 구름많음(3) 흐림(4) , invalid : -1
         * @param {Number} pty 없음(0) 비(1) 비/눈(2) 눈(3), invalid : -1
         * @param {Number} lgt 없음(0) 있음(1), invalid : -1
         * @param {Boolean} isNight
         */
        function parseSkyState(sky, pty, lgt, isNight) {
            var skyIconName = "";

            switch (pty) {
                case 1:
                    skyIconName = "Rain";
                    if (lgt) {
                        skyIconName += "WithLightning";
                    }
                    return skyIconName;
                case 2:
                    return skyIconName = "RainWithSnow"; //Todo need RainWithSnow icon";
                case 3:
                    return skyIconName = "Snow";
            }

            if (lgt) {
                return skyIconName = "Lightning";
            }

            if (isNight) {
               skyIconName = "Moon";
            }
            else {
                skyIconName = "Sun";
            }

            switch (sky) {
                case 1:
                    return skyIconName;
                case 2:
                    return skyIconName += "WithCloud";
                case 3:
                    return skyIconName = "Cloud"; //Todo need new icon
                case 4:
                    return skyIconName = "Cloud";
            }

            return skyIconName;
        }

        /**
         *
         * @param temp
         * @param tmx
         * @param tmn
         * @returns {string}
         */
        function decideTempIcon(temp, tmx, tmn) {
            var tempIconName = "Temp-";
            var max = tmx-tmn;
            var c = temp - tmn;
            var p = c/max*10;

            if (p>9) { tempIconName += "10";
            }
            else if (p>8) { tempIconName += "09";
            }
            else if (p>7) { tempIconName += "08";
            }
            else if (p>6) { tempIconName += "07";
            }
            else if (p>5) { tempIconName += "06";
            }
            else if (p>4) { tempIconName += "05";
            }
            else if (p>3) { tempIconName += "04";
            }
            else if (p>2) { tempIconName += "03";
            }
            else if (p>1) { tempIconName += "02";
            }
            else { tempIconName += "01";
            }

            return tempIconName;
        }

        /**
         *
         * @param {date: String, lgt: Number, mx: Number, my: Number, pty: Number, reh: Number, rn1: Number,
         *          sky: Number, t1h: Number, time: String, uuu: Number, vec: Number, vvv: Number,
         *          wsd: Number} currentTownWeather
         * @returns {{}}
         */
        function parseCurrentTownWeather(currentTownWeather) {
            var currentForecast = {};
            var time = parseInt(currentTownWeather.time.substr(0,2));
            var isNight = time < 7 || time > 18;
            currentForecast.time = parseInt(currentTownWeather.time.substr(0,2));
            currentForecast.t1h = currentTownWeather.t1h;
            currentForecast.sky = parseSkyState(currentForecast.sky, currentTownWeather.pty,
                        currentTownWeather.lgt, isNight);

            return currentForecast;
        }

        /**
         *
         * @param {String} str
         * @returns {*}
         */
        function convertStringToDate(str) {
            var y = str.substr(0,4),
                m = str.substr(4,2) - 1,
                d = str.substr(6,2);
            var D = new Date(y,m,d);
            return (D.getFullYear() == y && D.getMonth() == m && D.getDate() == d) ? D : undefined;
        }

        /**
         *
         * @param {Date} target
         * @param {Date} current
         * @returns {number}
         */
        function getDiffDays(target, current) {
            if (!target || !current) {
                console.log("target or current is invalid");
                return 0;
            }
            var c = new Date(current.getFullYear(), current.getMonth(), current.getDate());
            return Math.ceil((target-c) / (1000 * 3600 * 24));
        }

        /**
         *
         * @param {Object[]} shortForecastList
         * @param {Date} currentForecast
         * @param {Date} current
         * @returns {{timeTable: Array, chartTable: Array}}
         */
        function parseShortTownWeather(shortForecastList, currentForecast, current) {
            var data = [];
            var positionHours = getPositionHours(current.getHours());

            shortForecastList.every(function (shortForecast) {
                var tempObject = {};
                var time = parseInt(shortForecast.time.slice(0,-2));
                var diffDays = getDiffDays(convertStringToDate(shortForecast.date), current);
                var day = getDayString(diffDays, time);
                var isNight = time < 7 || time > 18;

                if (diffDays <= -2 && time < positionHours) {
                    //skip object
                    return true;
                }
                if (positionHours === 0 && diffDays <= -3) {
                   //when current time is 0, skip all -3
                    return true;
                }

                tempObject.day = day;
                tempObject.time = getTimeString(positionHours, diffDays, time);
                tempObject.t3h = shortForecast.t3h;
                tempObject.sky = parseSkyState(shortForecast.sky, shortForecast.pty, shortForecast.lgt, isNight);
                tempObject.pop = shortForecast.pop;
                tempObject.tempIcon = decideTempIcon(shortForecast.t3h, shortForecast.tmx, shortForecast.tmn);

                // 단기 예보의 현재(지금) 데이터를 currentForecast 정보로 업데이트
                if (diffDays === 0 && time === positionHours && time === currentForecast.time) {
                    tempObject.t3h = currentForecast.t1h;
                    tempObject.sky = currentForecast.sky;
                    tempObject.tempIcon = decideTempIcon(currentForecast.t1h, currentForecast.tmx, currentForecast.tmn);
                }

                // 하루 기준의 최고, 최저 온도 찾기
                if (shortForecast.tmx !== 0) {
                    tempObject.tmx = shortForecast.tmx;
                }
                else if (shortForecast.tmn !== 0) {
                    tempObject.tmn = shortForecast.tmn;
                }

                data.push(tempObject);
                if (data.length >= 32) {
                    return false;
                }
                return true;
            });

            if (data.length < 32) {
                var i;
                for (i=0; data.length < 32; i++) {
                    var tempObject = {};
                    tempObject.day = "";
                    tempObject.time = "";
                    tempObject.t3h = data[data.length-1].t3h;
                    tempObject.sky = "Sun";
                    tempObject.pop = 0;
                    tempObject.tempIcon = "Temp-01";
                    data.push(tempObject);
                }
            }

            var timeTable = data.slice(8);
            var chartTable = [
                {
                    name: 'yesterday',
                    values: data.slice(0, data.length - 8).map(function (d) {
                        return { name: 'yesterday', value: d };
                    })
                },
                {
                    name: 'today',
                    values: data.slice(8).map(function (d) {
                        return { name: 'today', value: d };
                    })
                }
            ];

            return {timeTable: timeTable, chartTable: chartTable};
        }

        /**
         *
         * @param {String} fullAddress 대한민국 천하도 강남시 하늘구 가내동 33-2, 대한민국 서울특별시 라임구 마라동
         * @returns {String[]}
         */
        function splitAddress(fullAddress) {
            var splitAddress = [];
            if (fullAddress && fullAddress.split) {
                splitAddress = fullAddress.split(" ");
            }
            return splitAddress;
        }

        /**
         * It's supporting only korean lang
         * return only city namd and dong name
         * @param {String} fullAddress
         * @returns {string}
         */
        function getShortenAddress(fullAddress) {
            var parsedAddress = splitAddress(fullAddress);
            if (!parsedAddress || parsedAddress.length < 2) {
                console.log("Fail to split full address="+fullAddress);
                return "";
            }
            if (parsedAddress.length === 5) {
                //대한민국, 경기도, 성남시, 분당구, 수내동
                parsedAddress.splice(0, 2);
            }
            else if (parsedAddress.length === 4) {
                //대한민국, 서울특별시, 송파구, 잠실동
                parsedAddress.splice(0, 1);
            }
            else if (parsedAddress.length === 3) {
                //대한민국,세종특별자치시, 금난면,
                parsedAddress.splice(0, 1);
            }
            else {
                console.log('Fail to get shorten from ='+fullAddress);
            }
            parsedAddress.splice(1, 1);
            parsedAddress.splice(2, 1);

            console.log(parsedAddress.toString());

            return parsedAddress.toString();
        }

        /**
         *
         * @param {String[]} addressArray
         * @param {cbWeatherInfo} callback
         */
        function getWeatherInfo(addressArray, callback) {
            //var url = 'town';
            var url = 'https://d2ibo8bwl7ifj5.cloudfront.net/town';
            //var url = 'https://todayweather-wizardfactory.rhcloud.com/town';

            if (!Array.isArray(addressArray) || addressArray.length === 0) {
                return callback(new Error("addressArray is NOT array"));
            }

            if (addressArray.length === 5) {
                url += '/'+addressArray[1]+'/'+addressArray[2]+addressArray[3]+'/'+addressArray[4];
            }
            else if (addressArray.length === 4) {
                url += '/'+addressArray[1]+'/'+addressArray[2]+'/'+addressArray[3];
            }
            else if (addressArray.length === 3) {
                url += '/'+addressArray[1]+'/'+addressArray[1]+'/'+addressArray[2];
            }
            else {
                var err = new Error("Fail to parse address array="+addressArray.toString());
                console.log(err);
                return callback(err);
            }

            $http({method: 'GET', url: url})
                .success(function(data) {
                    console.log(data);
                    callback(undefined, data);
                })
                .error(function(error) {
                    if (!error) {
                        error = new Error("Fail to get weatherInfo");
                    }
                    console.log(error);
                    callback(error);
                });
        }
        /**
         * @callback cbWeatherInfo
         * @param {Error} error
         * @param {Object} data
         */

        /**
         *
         * @param {cbCurrentPosition} callback
         */
        function getCurrentPosition(callback) {
            $cordovaGeolocation.getCurrentPosition({
                enableHighAccuracy: false,
                timeout : 5000
            }).then(function(position) {
                    //경기도,광주시,오포읍,37.36340556,127.2307667
                    //callback(undefined, 37.363, 127.230);
                    //세종특별자치시,세종특별자치시,연기면,36.517338,127.259247
                    //callback(undefined, 36.51, 127.259);
                    //callback(undefined, position.coords.latitude, position.coords.longitude);

                }, function (error) {
                    console.log(error);
                    callback(error);
                });
        }
        /**
         * @callback cbCurrentPosition
         * @param {Error} error
         * @param {Number} latitude
         * @param {Number} longitude
         */

        /**
         * It's supporting only korean lang
         * @param {Object[]} results
         * @returns {string}
         */
        function findDongAddressFromGoogleGeoCodeResults(results) {
            var dongAddress = "";
            var length = 0;
            results.forEach(function (result) {
                var lastChar = result.formatted_address.slice(-1);
                if (lastChar === '동' || lastChar === '읍' || lastChar === '면')  {
                    if(length < result.formatted_address.length) {
                        dongAddress = result.formatted_address;
                        length = result.formatted_address.length;
                    }
                }
            });
            if (dongAddress.length === 0) {
                console.log("Fail to find index of dong from="+results);
            }
            return dongAddress;
        }

        /**
         *
         * @param {Number} lat
         * @param {Number} long
         * @param {cbAddressFromGeolocation} callback
         */
        function getAddressFromGeolocation(lat, long, callback) {
            var url = "https://maps.googleapis.com/maps/api/geocode/json?latlng=" + lat + "," + long +
                        "&sensor=true";
            $http({method: 'GET', url: url}).
                success(function (data) {
                    if (data.status === 'OK') {
                        var address = findDongAddressFromGoogleGeoCodeResults(data.results);
                        if (!address || address.length === 0) {
                            return callback(new Error("Fail to find dong address from "+data.results));
                        }

                        console.log(address);
                        callback(undefined, address);
                    }
                    else {

                        //'ZERO_RESULTS', 'OVER_QUERY_LIMIT', 'REQUEST_DENIED',  'INVALID_REQUEST', 'UNKNOWN_ERROR'
                        callback(new Error(data.status));
                    }
                }).
                error(function (err) {
                    callback(err);
                });
        }
        /**
         * @callback cbAddressFromGeolocation
         * @param {Error} error
         * @param {String} address
         */

        /**
         *
         * @param {Object} current
         * @param {Object} yesterday
         * @returns {String}
         */
        function makeSummary(current, yesterday) {
            var str = "어제";
            var diffTemp = current.t1h - yesterday.t3h;

            if (diffTemp == 0) {
               return str += "와 동일";
            }

            str += "보다 " + Math.abs(diffTemp);
            if (diffTemp < 0) {
                str += "도 낮음";
            }
            else if (diffTemp > 0) {
                str += "도 높음";
            }
            return str;
        }

        /**
         *
         * @param weatherData
         */
        function setWeatherData(weatherData) {
            var currentForecast = parseCurrentTownWeather(weatherData.current);
            currentForecast.tmx = weatherData.short[0].tmx;
            currentForecast.tmn = weatherData.short[0].tmn;

            var parsedWeather = parseShortTownWeather(weatherData.short, currentForecast, currentTime);
            currentForecast.summary = makeSummary(currentForecast, parsedWeather.timeTable[0]);

            $scope.currentWeather = currentForecast;
            $scope.timeTable = parsedWeather.timeTable;
            $scope.temp = parsedWeather.chartTable;

            localStorage.setItem("currentWeather", JSON.stringify(currentForecast));
            localStorage.setItem("timeTable", JSON.stringify(parsedWeather.timeTable));
            localStorage.setItem("chartTable", JSON.stringify(parsedWeather.chartTable));

            console.log($scope.currentWeather);
            console.log($scope.temp.length);
            console.log($scope.temp);
        }

        /**
         *
         * @param {cbWeatherData} callback
         */
        function updateWeatherData(callback) {
            if(fullAddress)  {
                getWeatherInfo(splitAddress(fullAddress), function (error, weatherData) {
                    if (error) {
                        return callback(error);
                    }
                    $scope.address = getShortenAddress(fullAddress);
                    setWeatherData(weatherData);
                    return callback(undefined);
                });
            }

            getCurrentPosition(function(error, lat, long) {
                if (error) {
                    showAlert("에러", "현재 위치를 찾을 수 없습니다.");
                    return callback(error);
                }

                location = {"lat": lat, "long": long};
                localStorage.setItem("location", JSON.stringify(location));
                console.log(location);

                getAddressFromGeolocation(lat, long, function (error, newFullAddress) {
                    if (error) {
                        showAlert("에러", "현재 위치에 대한 정보를 찾을 수 없습니다.");
                        return callback(error);
                    }

                    if (fullAddress === newFullAddress) {
                        console.log("Already updated current position weather data");
                        return callback(undefined);
                    }
                    fullAddress = newFullAddress;
                    console.log(fullAddress);

                    localStorage.setItem("fullAddress", newFullAddress);
                    $scope.address = getShortenAddress(newFullAddress);

                    getWeatherInfo(splitAddress(newFullAddress), function (error, weatherData) {
                        if (error) {
                            return callback(error);
                        }
                        setWeatherData(weatherData);
                        return callback(undefined, true);
                    });
                });
            });
        }
        /**
         * @callback cbWeatherData
         * @param {Error} error
         */

        /**
         *
         * @returns {boolean}
         */
        function loadStorage() {
            fullAddress = localStorage.getItem("fullAddress");
            if (!fullAddress || fullAddress === 'undefined') {
                return false;
            }
            try {
                $scope.address = getShortenAddress(fullAddress);
                console.log($scope.address);
                location = JSON.parse(localStorage.getItem("location"));
                console.log($scope.location);
                $scope.currentWeather = JSON.parse(localStorage.getItem("currentWeather"));
                console.log($scope.currentWeather);
                $scope.timeTable = JSON.parse(localStorage.getItem("timeTable"));
                console.log($scope.timeTable);
                $scope.temp = JSON.parse(localStorage.getItem("chartTable"));
                console.log($scope.temp);
            }
            catch(error) {
               return false;
            }
        }

        function loadGuideDate() {
            fullAddress = "대한민국 하늘시 중구 구름동";
            $scope.address = getShortenAddress(fullAddress);
            $scope.currentWeather = {time: 7, t1h: 19, sky: "SunWithCloud", tmn: 14, tmx: 28, summary: "어제보다 1도 낮음"};

            var data = [];
            data[0] = {day: "", time: "6시", t3h: 17, sky:"Cloud", pop: 10, tempIcon:"Temp-01", tmn: 17};
            data[1] = {day: "", time: "9시", t3h: 21, sky:"Lightning", pop: 20, tempIcon:"Temp-02"};
            data[2] = {day: "", time: "12시", t3h: 26, sky:"Moon", pop: 30, tempIcon:"Temp-03"};
            data[3] = {day: "", time: "15시", t3h: 28, sky:"MoonWithCloud", pop: 40, tempIcon:"Temp-04", tmx: 28};
            data[4] = {day: "", time: "18시", t3h: 26, sky:"Rain", pop: 50, tempIcon:"Temp-05"};
            data[5] = {day: "", time: "21시", t3h: 21, sky:"RainWithLightning", pop: 60, tempIcon:"Temp-06"};
            data[6] = {day: "어제", time: "0시", t3h: 18, sky:"RainWithSnow", pop: 70, tempIcon:"Temp-07"};
            data[7] = {day: "", time: "3시", t3h: 16, sky:"Snow", pop: 80, tempIcon:"Temp-08"};
            data[8] = {day: "", time: "6시", t3h: 15, sky:"SnowWithLightning-Big", pop: 90, tempIcon:"Temp-09", tmn: 15};
            data[9] = {day: "", time: "9시", t3h: 21, sky:"Sun", pop: 10, tempIcon:"Temp-10"};
            data[10] = {day: "", time: "12시", t3h: 26, sky:"SunWithCloud", pop: 20, tempIcon:"Temp-10"};
            data[11] = {day: "", time: "15시", t3h: 28, sky:"WindWithCloud", pop: 30, tempIcon:"Temp-01"};
            data[12] = {day: "", time: "18시", t3h: 29, sky:"Rain", pop: 50, tempIcon:"Temp-04", tmx: 29};
            data[13] = {day: "", time: "21시", t3h: 21, sky:"RainWithLightning", pop: 60, tempIcon:"Temp-05"};
            data[14] = {day: "오늘", time: "0시", t3h: 18, sky:"RainWithSnow", pop: 70, tempIcon:"Temp-06"};
            data[15] = {day: "", time: "3시", t3h: 15, sky:"Snow", pop: 80, tempIcon:"Temp-07"};
            data[16] = {day: "", time: "지금", t3h: 14, sky:"SnowWithLightning-Big", pop: 90, tempIcon:"Temp-08", tmn: 14};
            data[17] = {day: "", time: "9시", t3h: 21, sky:"Cloud", pop: 10, tempIcon:"Temp-09"};
            data[18] = {day: "", time: "12시", t3h: 26, sky:"Lightning", pop: 20, tempIcon:"Temp-10"};
            data[19] = {day: "", time: "15시", t3h: 29, sky:"Moon", pop: 30, tempIcon:"Temp-01", tmx: 29};
            data[20] = {day: "", time: "18시", t3h: 28, sky:"MoonWithCloud", pop: 50, tempIcon:"Temp-04"};
            data[21] = {day: "", time: "21시", t3h: 22, sky:"Rain", pop: 60, tempIcon:"Temp-05"};
            data[22] = {day: "모레", time: "0시", t3h: 20, sky:"RainWithSnow", pop: 70, tempIcon:"Temp-06"};
            data[23] = {day: "", time: "3시", t3h: 18, sky:"RainWithLightning", pop: 80, tempIcon:"Temp-07"};
            data[24] = {day: "", time: "6시", t3h: 17, sky:"SnowWithLightning-Big", pop: 90, tempIcon:"Temp-08", tmn: 17};
            data[25] = {day: "", time: "9시", t3h: 21, sky:"Sun", pop: 10, tempIcon:"Temp-09"};
            data[26] = {day: "", time: "12시", t3h: 27, sky:"SunWithCloud", pop: 20, tempIcon:"Temp-10"};
            data[27] = {day: "", time: "15시", t3h: 29, sky:"WindWithCloud", pop: 30, tempIcon:"Temp-01", tmn: 29};
            data[28] = {day: "", time: "18시", t3h: 28, sky:"Rain", pop: 50, tempIcon:"Temp-04"};
            data[29] = {day: "", time: "21시", t3h: 24, sky:"RainWithLightning", pop: 60, tempIcon:"Temp-05"};
            data[30] = {day: "글피", time: "0시", t3h: 21, sky:"RainWithSnow", pop: 70, tempIcon:"Temp-06"};
            data[31] = {day: "", time: "3시", t3h: 18, sky:"Snow", pop: 80, tempIcon:"Temp-07"};
            //data[32] = {day: "", time: "6시", t3h: 17, sky:"SnowWithLightning-Big", pop: 90, tempIcon:"Temp-08"};
            //data[33] = {day: "", time: "9시", t3h: 21, sky:"Sun", pop: 10, tempIcon:"Temp-09"};
            //data[34] = {day: "", time: "12시", t3h: 26, sky:"SunWithCloud", pop: 20, tempIcon:"Temp-10"};
            //data[35] = {day: "", time: "15시", t3h: 29, sky:"WindWithCloud", pop: 30, tempIcon:"Temp-01"};
            //data[36] = {day: "", time: "18시", t3h: 26, sky:"Rain", pop: 50, tempIcon:"Temp-04"};
            //data[37] = {day: "", time: "21시", t3h: 23, sky:"RainWithLightning", pop: 60, tempIcon:"Temp-05"};
            //data[38] = {day: "글피", time: "0시", t3h: 18, sky:"RainWithSnow", pop: 70, tempIcon:"Temp-06"};
            //data[39] = {day: "", time: "3시", t3h: 18, sky:"Snow", pop: 80, tempIcon:"Temp-07"};

            $scope.timeTable = data.slice(8);
            $scope.temp = [
                {
                    name: 'yesterday',
                    values: data.slice(0, data.length - 8).map(function (d) {
                        return { name: 'yesterday', value: d };
                    })
                },
                {
                    name: 'today',
                    values: data.slice(8).map(function (d) {
                        return { name: 'today', value: d };
                    })
                }
            ];
        }

        /**
         * Identifies a user with the Ionic User service
         */
        function identifyUser() {
            console.log('User: Identifying with User service');

            var user = $ionicUser.get();
            if(!user.user_id) {
                user.user_id = $ionicUser.generateGUID();
            }

            // Identify your user with the Ionic User Service
            $ionicUser.identify(user).then(function(){
                $scope.identified = true;
                console.log('Identified user ID ' + user.user_id);
            });
        }

        /**
         *
         * @param date
         * @returns {string}
         */
        function convertTimeString(date) {
            var timeString;
            timeString = (date.getMonth()+1)+"월 "+date.getDate()+ "일";
            switch (date.getDay()) {
                case 0: timeString += "(일) "; break;
                case 1: timeString += "(월) "; break;
                case 2: timeString += "(화) "; break;
                case 3: timeString += "(수) "; break;
                case 4: timeString += "(목) "; break;
                case 5: timeString += "(금) "; break;
                case 6: timeString += "(토) "; break;
            }
            if (date.getHours() < 12) {
                timeString += " "+ date.getHours()+":"+date.getMinutes() + " AM";
            }
            else {
                timeString += " "+ (date.getHours()-12) +":"+date.getMinutes() + " PM";
            }

            return timeString;
        }

        var colWidth;

        function getWidthPerCol() {
            if (colWidth)  {
                return colWidth;
            }

            var bodyWidth =  angular.element(document).find('body')[0].offsetWidth;
            console.log("body of width="+bodyWidth);

            switch (bodyWidth) {
                case 320:   //iphone 4,5
                    colWidth = 53;
                    break;
                case 375:   //iphone 6
                    colWidth = 53;
                    break;
                case 414:   //iphone 6+
                    colWidth =  59;
                    break;
                case 360:   //s4, note3
                default:
                    colWidth = 52;
                    break;
            }
            return colWidth;
        }

        function getTodayNowPosition(index) {
            return getWidthPerCol()*index;
        }

        function showAlert(title, msg) {
            var alertPopup = $ionicPopup.alert({
                title: title,
                template: msg
            });
            alertPopup.then(function(res) {
                console.log('alertPopup close');
            });
        }

        identifyUser();

        $scope.address = "위치 찾는 중";
        $scope.currentTimeString = convertTimeString(currentTime);

        $scope.doRefresh = function() {
            var refreshComplete = false;
            updateWeatherData(function(error, mustUpdate) {
                if (error) {
                    console.log(error);
                    console.log(error.stack);
                }
                if (!refreshComplete || mustUpdate) {
                    console.log("Called refreshComplete");
                    $scope.$broadcast('scroll.refreshComplete');
                    $ionicScrollDelegate.$getByHandle('chart').scrollTo(getTodayNowPosition(7), 0, false);
                    refreshComplete = true;
                }
                else {
                    console.log("Skip refreshComplete");
                }
            });
        };

        $scope.onClickGuide = function() {
            if(typeof(Storage) !== "undefined") {
                localStorage.setItem("skipGuide", true);
            }
            $scope.skipGuide = true;
        };

        $ionicPlatform.ready(function() {
            if(typeof(Storage) !== "undefined") {
                if (localStorage.getItem("skipGuide") !== null) {
                    $scope.skipGuide = localStorage.getItem("skipGuide");
                }
            }

            //It starts first times
            if (!$scope.skipGuide) {
                loadGuideDate();
                $timeout(function() {
                    $ionicScrollDelegate.$getByHandle('chart').scrollTo(getTodayNowPosition(7), 0, false);
                },0);
                return;
            }

            if(typeof(Storage) !== "undefined" && loadStorage()) {
                $timeout(function() {
                    $ionicScrollDelegate.$getByHandle('chart').scrollTo(getTodayNowPosition(7), 0, false);
                },0);
            }
            else {
                updateWeatherData(function(error) {
                    if (error) {
                        console.log(error);
                        console.log(error.stack);
                    }
                    $ionicScrollDelegate.$getByHandle('chart').scrollTo(getTodayNowPosition(7), 0, false);
                });
            }
        });

        $interval(function() {
            var newDate = new Date();
            if(newDate.getMinutes() != currentTime.getMinutes()) {
                currentTime = newDate;
                $scope.currentTimeString =  convertTimeString(currentTime);
            }
        }, 1000);
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
