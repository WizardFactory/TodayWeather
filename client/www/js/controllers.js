angular.module('starter.controllers', [])

    .controller('DashCtrl', function($scope, $ionicPlatform, $ionicScrollDelegate, $ionicPopup,
                                     $cordovaGeolocation, $timeout, $interval, $http)
    {
        $scope.skipGuide = false;
        if(typeof(Storage) !== "undefined") {
            if (localStorage.getItem("skipGuide") !== null) {
                $scope.skipGuide = localStorage.getItem("skipGuide");
            }
        }
        $scope.shortForecast = true;

        //String
        $scope.address = "";

        //{time: Number, t1h: Number, sky: String, tmn: Number, tmx: Number, summary: String};
        $scope.currentWeather;

        //{day: String, time: Number, t3h: Number, sky: String, pop: Number, tempIcon: String, tempInfo: String, tmn: Number, tmx: Number}
        $scope.timeTable = [];
        //{week: String, sky:String, pop: Number, humidityIcon: String, reh: Number, tmn: Number, tmx: Number};
        $scope.dayTable = [];

        //[ {name: String, values:[{name: String, value: Number}, ]},
        //  {name: String, values:[{name: String, value: number}, ]} ]
        $scope.timeChart;
        //
        $scope.dayChart;

        //10월 8일(수) 12:23 AM
        $scope.currentTimeString;

        //String
        var fullAddress = "";
        var currentTime = new Date();

        //{date: String, sky: String, tmx: Number, tmn: Number, reh: Number}
        var dailyInfoArray = [];

        //{"lat": Number, "long": Number};
        var location;

        var deploy = new Ionic.Deploy();
        // "dev" is the channel tag for the Dev channel.
        //deploy.setChannel("Dev");

        // Update app code with new release from Ionic Deploy
        function doUpdate() {
            var progressString = "";
            progressString = "업데이트 시작";
            $scope.currentWeather.summary = progressString;
            deploy.update().then(function(res) {
                progressString = '최신버젼으로 업데이트 되었습니다! ' + res;
                $scope.currentWeather.summary = progressString;
            }, function(err) {
                progressString = '업데이트 실패 '+ err;
                $scope.currentWeather.summary = progressString;
            }, function(prog) {
                progressString = '업데이트중 '+ prog +'%';
                $scope.currentWeather.summary = progressString;
            });
        }

        // A confirm dialog
        function showConfirm(title, template, callback) {
            var confirmPopup = $ionicPopup.confirm({
                title: title,
                template: template
            });
            confirmPopup.then(function(res) {
                if(res) {
                    console.log('You are sure');
                } else {
                    console.log('You are not sure');
                }
                callback(res);
            });
        }

        // Check Ionic Deploy for new code
        function checkForUpdates() {
            console.log('Ionic Deploy: Checking for updates');
            deploy.info().then(function(deployInfo) {
                console.log(deployInfo);
            }, function() {}, function() {});

            deploy.check().then(function(hasUpdate) {
                console.log('Ionic Deploy: Update available: ' + hasUpdate);
                if (hasUpdate) {
                    showConfirm("업데이트", "새로운 버전이 확인되었습니다. 업데이트 하시겠습니까?", function (res) {
                        if (res)   {
                            doUpdate();
                        }
                    });
                }
            }, function(err) {
                console.error('Ionic Deploy: Unable to check for updates', err);
            });
        }

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
         * YYYYMMDD
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
         * @param dailyInfoList
         * @param date
         * @returns {*}
         */
        function getDayInfo(dailyInfoList, date) {
            if (dailyInfoList.length === 0) {
                return undefined;
            }

            for(var i=0; i<dailyInfoList.length; i++) {
                if (dailyInfoList[i].date === date) {
                    return dailyInfoList[i];
                }
            }

            return undefined;
        }

        /**
         *
         * @param shortForecastList
         * @returns {Array}
         */
        function parsePreShortTownWeather(shortForecastList) {
            //It's the same type of dailyInfoArray
            var dailyTemp = [];

            shortForecastList.forEach(function (shortForecast) {
                var dayInfo = getDayInfo(dailyTemp, shortForecast.date);
                if (!dayInfo) {
                    var data = {date: shortForecast.date, sky: "Sun", tmx: null, tmn: null, pop: 0, reh: 0};
                    dailyTemp.push(data);
                    dayInfo = dailyTemp[dailyTemp.length-1];
                    dayInfo.sky = parseSkyState(shortForecast.sky, shortForecast.pty, shortForecast.lgt, false);
                }
                if(shortForecast.tmx != -50 && shortForecast.tmx != 0) {
                    dayInfo.tmx = shortForecast.tmx;
                }
                //sometims, t3h over tmx;
                if (shortForecast.t3h > dayInfo.tmx) {
                    dayInfo.tmx = shortForecast.t3h;
                }

                if(shortForecast.tmn != -50 && shortForecast.tmn != 0) {
                    dayInfo.tmn = shortForecast.tmn;
                }
                if (shortForecast.t3h < dayInfo.tmn) {
                    dayInfo.tmn = shortForecast.t3h;
                }

                if (shortForecast.pty > 0) {
                    dayInfo.sky = parseSkyState(shortForecast.sky, shortForecast.pty, shortForecast.lgt, false);
                }
                dayInfo.pop = shortForecast.pop > dayInfo.pop ? shortForecast.pop : dayInfo.pop;
                dayInfo.reh = shortForecast.reh > dayInfo.reh ? shortForecast.reh : dayInfo.reh;
            });

            console.log(dailyTemp);
            return dailyTemp;
        }

        /**
         * r06 6시간 강수량, s06 6시간 신적설,
         * @param {Object[]} shortForecastList
         * @param {Date} currentForecast
         * @param {Date} current
         * @param {Object[]} dailyInfoList
         * @returns {{timeTable: Array, timeChart: Array}}
         */
        function parseShortTownWeather(shortForecastList, currentForecast, current, dailyInfoList) {
            var data = [];
            var positionHours = getPositionHours(current.getHours());

            shortForecastList.every(function (shortForecast) {
                var tempObject = {};
                var time = parseInt(shortForecast.time.slice(0,-2));
                var diffDays = getDiffDays(convertStringToDate(shortForecast.date), current);
                var day = getDayString(diffDays, time);
                var isNight = time < 7 || time > 18;
                var dayInfo = getDayInfo(dailyInfoList, shortForecast.date);
                if (!dayInfo) {
                    console.log("Fail to find dayInfo date="+shortForecast.date);
                    dayInfo = {date: shortForecast.date, tmx: 100, tmn: -49};
                }

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
                //It means invaild data
                if (!shortForecast.pop && !shortForecast.sky && !shortForecast.pty && !shortForecast.reh && !shortForecast.t3h) {
                    tempObject.t3h = undefined;
                    tempObject.pop = undefined;
                    tempObject.sky = "Sun";
                    tempObject.tempIcon = "Temp-01";
                }
                else {
                    tempObject.t3h = shortForecast.t3h;
                    tempObject.sky = parseSkyState(shortForecast.sky, shortForecast.pty, shortForecast.lgt, isNight);
                    tempObject.pop = shortForecast.pop;
                    tempObject.tempIcon = decideTempIcon(shortForecast.t3h, dayInfo.tmx, dayInfo.tmn);
                }

                // 단기 예보의 현재(지금) 데이터를 currentForecast 정보로 업데이트
                if (diffDays === 0 && time === positionHours &&
                            (time <= currentForecast.time && currentForecast.time < time+3)) {
                    tempObject.t3h = currentForecast.t1h;
                    tempObject.sky = currentForecast.sky;
                    tempObject.tempIcon = decideTempIcon(currentForecast.t1h, dayInfo.tmx, dayInfo.tmn);
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
                    //tempObject.t3h = data[data.length-1].t3h;
                    tempObject.t3h = undefined;
                    tempObject.sky = "Sun";
                    tempObject.pop = 0;
                    tempObject.tempIcon = "Temp-01";
                    data.push(tempObject);
                }
            }

            var timeTable = data.slice(8);
            var timeChart = [
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

            return {timeTable: timeTable, timeChart: timeChart};
        }

        function dayToString(day) {
            switch (day) {
                case 0: return "일"; break;
                case 1: return "월"; break;
                case 2: return "화"; break;
                case 3: return "수"; break;
                case 4: return "목"; break;
                case 5: return "금"; break;
                case 6: return "토"; break;
            }
            return "";
        }

        function decideHumidityIcon(reh) {
            var tempIconName = "Humidity-";

            if (reh == 100) {
               tempIconName += "90";
            }
            else  {
                tempIconName += parseInt(reh/10)*10;
            }
            return tempIconName;
        }

        function convertMidSkyString(skyInfo) {
            switch(skyInfo) {
                case "맑음": return "Sun"; break;
                case "구름조금": return "SunWithCloud"; break;
                case "구름많음": return "SunWithCloud"; break;
                case "흐림": return "Cloud"; break;
                case "구름적고 비": return "Rain"; break;
                case "구름많고 비": return "Rain"; break;
                case "흐리고 비": return "Rain"; break;
                case "구름적고 눈": return "Snow"; break;
                case "구름많고 눈": return "Snow"; break;
                case "흐리고 눈": return "Snow"; break;
            }

            console.log("Fail to convert skystring="+skyInfo);
            return "";
        }

        function getHighPrioritySky(sky1, sky2) {
            if (sky2 === 'Rain') {
                return sky2;
            }

            return sky1;
        }

        function parseMidTownWeather(midData, dailyInfoList, currentTime) {
            if (!midData) {
                console.log("midData is undefined");
                midData = {
                    "forecast": {
                        "date": "20151005",
                        "time": "1800",
                        "pointNumber": "109",
                        "cnt": 0,
                        "wfsv": "기압골의 영향으로 10일에 비가 오겠으며, 그 밖의 날에는 고기압의 가장자리에 들어 가끔 구름많겠습니다.     \n기온은 평년(최저기온 : 7~11도, 최고기온 : 20~22도)과 비슷하겠습니다. \n강수량은 평년(0~3mm)과 비슷하겠습니다.  \n서해중부해상의 물결은 10일과 11일에는 1.0~2.5m로 일겠고, 그 밖의 날은 0.5~2.0m로 일겠습니다."
                    },
                    "dailyData": [{
                        "date": "20150928",
                        "wfAm": "구름조금",
                        "wfPm": "구름조금",
                        "taMin": 15,
                        "taMax": 28
                    }, {
                        "date": "20150929",
                        "wfAm": "구름조금",
                        "wfPm": "구름조금",
                        "taMin": 15,
                        "taMax": 27
                    }, {
                        "date": "20150930",
                        "wfAm": "구름많음",
                        "wfPm": "구름많음",
                        "taMin": 16,
                        "taMax": 25
                    }, {
                        "date": "20151001",
                        "wfAm": "흐리고 비",
                        "wfPm": "흐리고 비",
                        "taMin": 17,
                        "taMax": 22
                    }, {
                        "date": "20151002",
                        "wfAm": "구름조금",
                        "wfPm": "구름조금",
                        "taMin": 12,
                        "taMax": 21
                    }, {
                        "date": "20151003",
                        "wfAm": "구름많음",
                        "wfPm": "구름조금",
                        "taMin": 15,
                        "taMax": 22
                    }, {
                        "date": "20151004",
                        "wfAm": "구름조금",
                        "wfPm": "구름조금",
                        "taMin": 12,
                        "taMax": 22
                    }, {
                        "date": "20151005",
                        "wfAm": "구름조금",
                        "wfPm": "구름많음",
                        "taMin": 11,
                        "taMax": 24
                    }, {
                        "date": "20151006",
                        "wfAm": "맑음",
                        "wfPm": "맑음",
                        "taMin": 11,
                        "taMax": 25
                    }, {
                        "date": "20151007",
                        "wfAm": "맑음",
                        "wfPm": "구름조금",
                        "taMin": 12,
                        "taMax": 25
                    }, {
                        "date": "20151008",
                        "wfAm": "구름많음",
                        "wfPm": "구름많음",
                        "taMin": 13,
                        "taMax": 23
                    }, {
                        "date": "20151009",
                        "wfAm": "구름많음",
                        "wfPm": "구름많음",
                        "taMin": 13,
                        "taMax": 23
                    }, {
                        "date": "20151010",
                        "wfAm": "구름많음",
                        "wfPm": "구름많음",
                        "taMin": 12,
                        "taMax": 21
                    }, {
                        "date": "20151011",
                        "wfAm": "구름많고 비",
                        "wfPm": "흐리고 비",
                        "taMin": 11,
                        "taMax": 18
                    }, {
                        "date": "20151012",
                        "wfAm": "구름많음",
                        "wfPm": "구름많음",
                        "taMin": 10,
                        "taMax": 19
                    }, {
                        "date": "20151013",
                        "wfAm": "구름많음",
                        "wfPm": "구름많음",
                        "taMin": 10,
                        "taMax": 21
                    }, {
                        "date": "20151014",
                        "wfAm": "구름조금",
                        "wfPm": "구름조금",
                        "taMin": 10,
                        "taMax": 21
                    }, {
                        "date": "20151015",
                        "wfAm": "구름조금",
                        "wfPm": "구름조금",
                        "taMin": 10,
                        "taMax": 22
                    }, {
                        "date": "20151016",
                        "wfAm": "구름조금",
                        "wfPm": "구름조금",
                        "taMin": 10,
                        "taMax": 22
                    }]
                }
            }

            var tmpDayTable = [];
            midData.dailyData.forEach(function(dayInfo) {
                var data = {};

                data.date = dayInfo.date;
                if (getDiffDays(convertStringToDate(data.date), currentTime) == 0) {
                    data.week = "오늘";
                }
                else {
                    data.week = dayToString(convertStringToDate(data.date).getDay());
                }

                var skyAm = convertMidSkyString(dayInfo.wfAm);
                var skyPm = convertMidSkyString(dayInfo.wfPm);
                data.sky = getHighPrioritySky(skyAm, skyPm);
                data.tmx = dayInfo.taMax;
                data.tmn = dayInfo.taMin;
                data.humidityIcon = "Humidity-00";
                tmpDayTable.push(data);
            });

            console.log(tmpDayTable);

            var index = 0;
            for (var i=0; i<tmpDayTable.length; i++) {
                var tmpDate = dailyInfoList[0].date;
                console.log(tmpDate);
                if (tmpDayTable[i].date === tmpDate) {
                    index = i;
                    break;
                }
            }

            //{week: "목", sky:"Cloud", pop: 10, humidityIcon:"Humidity-10", reh: 10, tmn: 10, tmx: 28};
            dailyInfoList.forEach(function (dayInfo) {
                var data;
                if (tmpDayTable[index].date === dayInfo.date) {
                    data = tmpDayTable[index];
                    data.sky = dayInfo.sky;
                    data.pop = dayInfo.pop;
                    data.reh = dayInfo.reh;
                    data.humidityIcon = decideHumidityIcon(data.reh);
                    index++;
                }
                else {
                    console.log("Date was mismatched index:"+index+" date:"+tmpDayTable[index].date+
                                " dayInfo.date="+dayInfo.date);
                }
            });

            return tmpDayTable;
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
            //var url = 'http://todayweather1-wizardfactory.rhcloud.com/town';

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

            console.log(url);

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
                timeout : 3000
            }).then(function(position) {
                    //경기도,광주시,오포읍,37.36340556,127.2307667
                    //callback(undefined, 37.363, 127.230);
                    //세종특별자치시,세종특별자치시,연기면,36.517338,127.259247
                    //callback(undefined, 36.51, 127.259);
                    callback(undefined, position.coords.latitude, position.coords.longitude);
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
                console.log("Fail to find index of dong from="+results[0].formatted_address);
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
                        "&sensor=true&language=ko";
            $http({method: 'GET', url: url}).
                success(function (data) {
                    if (data.status === 'OK') {
                        var address = findDongAddressFromGoogleGeoCodeResults(data.results);
                        if (!address || address.length === 0) {
                            return callback(new Error("Fail to find dong address from "+data.results[0].formatted_address));
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

            dailyInfoArray = parsePreShortTownWeather(weatherData.short);

            var parsedWeather = parseShortTownWeather(weatherData.short, currentForecast, currentTime, dailyInfoArray);
            currentForecast.summary = makeSummary(currentForecast, parsedWeather.timeTable[0]);

            $scope.currentWeather = currentForecast;
            $scope.timeTable = parsedWeather.timeTable;
            $scope.timeChart = parsedWeather.timeChart;

            $scope.dayTable = parseMidTownWeather(weatherData.midData, dailyInfoArray, currentTime);
            $scope.dayChart = [{
                values: $scope.dayTable,
                temp: $scope.currentWeather.t1h
            }];

            localStorage.setItem("currentWeather", JSON.stringify(currentForecast));
            localStorage.setItem("timeTable", JSON.stringify(parsedWeather.timeTable));
            localStorage.setItem("timeChart", JSON.stringify(parsedWeather.timeChart));

            console.log($scope.currentWeather);
            console.log($scope.timeChart.length);
            console.log($scope.timeChart);
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
                $scope.timeChart = JSON.parse(localStorage.getItem("timeChart"));
                console.log($scope.timeChart);
            }
            catch(error) {
               return false;
            }
        }

        function loadGuideDate() {
            fullAddress = "대한민국 하늘시 중구 구름동";
            $scope.address = getShortenAddress(fullAddress);
            $scope.currentWeather = {time: 7, t1h: 19, sky: "SunWithCloud", tmn: 14, tmx: 28, summary: "어제보다 1도 낮음"};

            var timeData = [];
            timeData[0] = {day: "", time: "6시", t3h: 17, sky:"Cloud", pop: 10, tempIcon:"Temp-01", tmn: 17};
            timeData[1] = {day: "", time: "9시", t3h: 21, sky:"Lightning", pop: 20, tempIcon:"Temp-02"};
            timeData[2] = {day: "", time: "12시", t3h: 26, sky:"Moon", pop: 30, tempIcon:"Temp-03"};
            timeData[3] = {day: "", time: "15시", t3h: 28, sky:"MoonWithCloud", pop: 40, tempIcon:"Temp-04", tmx: 28};
            timeData[4] = {day: "", time: "18시", t3h: 26, sky:"Rain", pop: 50, tempIcon:"Temp-05"};
            timeData[5] = {day: "", time: "21시", t3h: 21, sky:"RainWithLightning", pop: 60, tempIcon:"Temp-06"};
            timeData[6] = {day: "어제", time: "0시", t3h: 18, sky:"RainWithSnow", pop: 70, tempIcon:"Temp-07"};
            timeData[7] = {day: "", time: "3시", t3h: 16, sky:"Snow", pop: 80, tempIcon:"Temp-08"};
            timeData[8] = {day: "", time: "6시", t3h: 15, sky:"SnowWithLightning-Big", pop: 90, tempIcon:"Temp-09", tmn: 15};
            timeData[9] = {day: "", time: "9시", t3h: 21, sky:"Sun", pop: 10, tempIcon:"Temp-10"};
            timeData[10] = {day: "", time: "12시", t3h: 26, sky:"SunWithCloud", pop: 20, tempIcon:"Temp-10"};
            timeData[11] = {day: "", time: "15시", t3h: 28, sky:"WindWithCloud", pop: 30, tempIcon:"Temp-01"};
            timeData[12] = {day: "", time: "18시", t3h: 29, sky:"Rain", pop: 50, tempIcon:"Temp-04", tmx: 29};
            timeData[13] = {day: "", time: "21시", t3h: 21, sky:"RainWithLightning", pop: 60, tempIcon:"Temp-05"};
            timeData[14] = {day: "오늘", time: "0시", t3h: 18, sky:"RainWithSnow", pop: 70, tempIcon:"Temp-06"};
            timeData[15] = {day: "", time: "3시", t3h: 15, sky:"Snow", pop: 80, tempIcon:"Temp-07"};
            timeData[16] = {day: "", time: "지금", t3h: 14, sky:"SnowWithLightning-Big", pop: 90, tempIcon:"Temp-08", tmn: 14};
            timeData[17] = {day: "", time: "9시", t3h: 21, sky:"Cloud", pop: 10, tempIcon:"Temp-09"};
            timeData[18] = {day: "", time: "12시", t3h: 26, sky:"Lightning", pop: 20, tempIcon:"Temp-10"};
            timeData[19] = {day: "", time: "15시", t3h: 29, sky:"Moon", pop: 30, tempIcon:"Temp-01", tmx: 29};
            timeData[20] = {day: "", time: "18시", t3h: 28, sky:"MoonWithCloud", pop: 50, tempIcon:"Temp-04"};
            timeData[21] = {day: "", time: "21시", t3h: 22, sky:"Rain", pop: 60, tempIcon:"Temp-05"};
            timeData[22] = {day: "내일", time: "0시", t3h: 20, sky:"RainWithSnow", pop: 70, tempIcon:"Temp-06"};
            timeData[23] = {day: "", time: "3시", t3h: 18, sky:"RainWithLightning", pop: 80, tempIcon:"Temp-07"};
            timeData[24] = {day: "", time: "6시", t3h: 17, sky:"SnowWithLightning-Big", pop: 90, tempIcon:"Temp-08", tmn: 17};
            timeData[25] = {day: "", time: "9시", t3h: 21, sky:"Sun", pop: 10, tempIcon:"Temp-09"};
            timeData[26] = {day: "", time: "12시", t3h: 27, sky:"SunWithCloud", pop: 20, tempIcon:"Temp-10"};
            timeData[27] = {day: "", time: "15시", t3h: 29, sky:"WindWithCloud", pop: 30, tempIcon:"Temp-01", tmn: 29};
            timeData[28] = {day: "", time: "18시", t3h: 28, sky:"Rain", pop: 50, tempIcon:"Temp-04"};
            timeData[29] = {day: "", time: "21시", t3h: 24, sky:"RainWithLightning", pop: 60, tempIcon:"Temp-05"};
            timeData[30] = {day: "모레", time: "0시", t3h: 21, sky:"RainWithSnow", pop: 70, tempIcon:"Temp-06"};
            timeData[31] = {day: "", time: "3시", t3h: 18, sky:"Snow", pop: 80, tempIcon:"Temp-07"};
            //timeData[32] = {day: "", time: "6시", t3h: 17, sky:"SnowWithLightning-Big", pop: 90, tempIcon:"Temp-08"};
            //timeData[33] = {day: "", time: "9시", t3h: 21, sky:"Sun", pop: 10, tempIcon:"Temp-09"};
            //timeData[34] = {day: "", time: "12시", t3h: 26, sky:"SunWithCloud", pop: 20, tempIcon:"Temp-10"};
            //timeData[35] = {day: "", time: "15시", t3h: 29, sky:"WindWithCloud", pop: 30, tempIcon:"Temp-01"};
            //timeData[36] = {day: "", time: "18시", t3h: 26, sky:"Rain", pop: 50, tempIcon:"Temp-04"};
            //timeData[37] = {day: "", time: "21시", t3h: 23, sky:"RainWithLightning", pop: 60, tempIcon:"Temp-05"};
            //timeData[38] = {day: "글피", time: "0시", t3h: 18, sky:"RainWithSnow", pop: 70, tempIcon:"Temp-06"};
            //timeData[39] = {day: "", time: "3시", t3h: 18, sky:"Snow", pop: 80, tempIcon:"Temp-07"};

            $scope.timeTable = timeData.slice(8);
            $scope.timeChart = [
                {
                    name: 'yesterday',
                    values: timeData.slice(0, timeData.length - 8).map(function (d) {
                        return { name: 'yesterday', value: d };
                    })
                },
                {
                    name: 'today',
                    values: timeData.slice(8).map(function (d) {
                        return { name: 'today', value: d };
                    })
                }
            ];

            var dayData = [];
            dayData[0] = {week: "목", sky:"Cloud", pop: 10, humidityIcon:"Humidity-10", reh: 10, tmn: 10, tmx: 28};
            dayData[1] = {week: "금", sky:"Lightning", pop: 20, humidityIcon:"Humidity-20", reh: 10, tmn: 17, tmx: 26};
            dayData[2] = {week: "토", sky:"Moon", pop: 30, humidityIcon:"Humidity-30", reh: 10, tmn: 16, tmx: 23};
            dayData[3] = {week: "일", sky:"MoonWithCloud", pop: 40, humidityIcon:"Humidity-40", reh: 10, tmn: 14, tmx: 22};
            dayData[4] = {week: "월", sky:"Rain", pop: 50, humidityIcon:"Humidity-50", reh: 10, tmn: 14, tmx: 22};
            dayData[5] = {week: "화", sky:"RainWithLightning", pop: 60, humidityIcon:"Humidity-60", reh: 10, tmn: 12, tmx: 22};
            dayData[6] = {week: "수", sky:"RainWithSnow", pop: 70, humidityIcon:"Humidity-70", reh: 10, tmn: 15, tmx: 27};
            dayData[7] = {week: "오늘", sky:"Snow", pop: 80, humidityIcon:"Humidity-80", reh: 10, tmn: 15, tmx: 25};
            dayData[8] = {week: "금", sky:"SnowWithLightning-Big", pop: 90, humidityIcon:"Humidity-90", reh: 10, tmn: 15, tmx: 22};
            dayData[9] = {week: "토", sky:"Sun", pop: 10, humidityIcon:"Humidity-10", reh: 10, tmn: 12, tmx: 22};
            dayData[10] = {week: "일", sky:"SunWithCloud", pop: 20, humidityIcon:"Humidity-10", reh: 10, tmn: 17, tmx: 28};
            dayData[11] = {week: "월", sky:"WindWithCloud", pop: 30, humidityIcon:"Humidity-10", reh: 10, tmn: 17, tmx: 27};
            dayData[12] = {week: "화", sky:"Rain", pop: 50, humidityIcon:"Humidity-40", reh: 10, tmn: 17, tmx: 26};
            dayData[13] = {week: "수", sky:"RainWithLightning", pop: 60, humidityIcon:"Humidity-50", reh: 10, tmn: 16, tmx: 24};
            dayData[14] = {week: "목", sky:"RainWithSnow", pop: 70, humidityIcon:"Humidity-60", reh: 10, tmn: 15, tmx: 28};
            dayData[15] = {week: "금", sky:"Snow", pop: 80, humidityIcon:"Humidity-70", reh: 10, tmn: 17, tmx: 26};
            dayData[16] = {week: "토", sky:"SnowWithLightning-Big", pop: 90, humidityIcon:"Humidity-80", reh: 10, tmn: 13, tmx: 24};
            dayData[17] = {week: "일", sky:"Cloud", pop: 10, humidityIcon:"Humidity-90", reh: 10, tmn: 12, tmx: 25};

            $scope.dayTable = dayData;
            $scope.dayChart = [{
                values: dayData,
                temp: $scope.currentWeather.t1h
            }];
        }

        /**
         * Identifies a user with the Ionic User service
         */
        function identifyUser() {
            console.log('User: Identifying with User service');

            // kick off the platform web client
            Ionic.io();

            // this will give you a fresh user or the previously saved 'current user'
            var user = Ionic.User.current();

            // if the user doesn't have an id, you'll need to give it one.
            if (!user.id) {
                user.id = Ionic.User.anonymousId();
                // user.id = 'your-custom-user-id';
            }

            //persist the user
            user.save();
        }

        /**
         *
         * @param date
         * @returns {string}
         */
        function convertTimeString(date) {
            var timeString;
            timeString = (date.getMonth()+1)+"월 "+date.getDate()+ "일";
            timeString += "("+dayToString(date.getDay()) +") ";

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
                    $ionicScrollDelegate.$getByHandle('timeChart').scrollTo(getTodayNowPosition(7), 0, false);
                    $ionicScrollDelegate.$getByHandle('weeklyChart').scrollTo(getTodayNowPosition(7), 0, false);
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
            //It starts first times
            if (!$scope.skipGuide) {
                loadGuideDate();
                $timeout(function() {
                    $ionicScrollDelegate.$getByHandle('timeChart').scrollTo(getTodayNowPosition(7), 0, false);
                    $ionicScrollDelegate.$getByHandle('weeklyChart').scrollTo(getTodayNowPosition(7), 0, false);
                },0);
                return;
            }

            if(typeof(Storage) !== "undefined" && loadStorage()) {
                $timeout(function() {
                    $ionicScrollDelegate.$getByHandle('timeChart').scrollTo(getTodayNowPosition(7), 0, false);
                    $ionicScrollDelegate.$getByHandle('weeklyChart').scrollTo(getTodayNowPosition(7), 0, false);
                },0);
            }
            else {
                updateWeatherData(function(error) {
                    if (error) {
                        console.log(error);
                        console.log(error.stack);
                    }
                    $ionicScrollDelegate.$getByHandle('timeChart').scrollTo(getTodayNowPosition(7), 0, false);
                    $ionicScrollDelegate.$getByHandle('weeklyChart').scrollTo(getTodayNowPosition(7), 0, false);
                });
            }

            checkForUpdates();
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

