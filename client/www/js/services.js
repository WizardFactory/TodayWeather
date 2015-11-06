angular.module('starter.services', [])

    .factory('WeatherData', function () {
        var cities = [];

        var getCity = function (address) {
            var city = cities.filter(function (value) {
                    return (typeof value.address === address);
                }
            );
            return city;
        };

        return {
            all: function () {
                return cities;
            },
            addCity: function (address) {
                if (getCity(address) === null) {
                    var city = {
                        address: address,
                        currentWeather: {},
                        timeTable: [],
                        dayTable: [],
                        timeChart: {},
                        dayChart: {}
                    };
                    cities.push(city);
                }
            },
            getCity: function (address) {
                return getCity(address);
            },
            removeCity: function (address) {
                var city = getCity(address);
                if (city === null) {
                    cities.splice(cities.indexOf(city), 1);
                }
            }
        };
    })
    .factory('WeatherService', function () {

    })
    .factory('WeatherUtil', function () {
        /**
         *
         * @param pm10Grade
         * @returns {*}
         */
        function parsePm10Grade(pm10Value) {
            if (pm10Value <= 30) {
                return '좋음';
            }
            else if (pm10Value <= 80) {
                return '보통';
            }
            else if (pm10Value <= 150) {
                return '나쁨';
            }
            else if (pm10Value > 150) {
                return '매우 나쁨';
            }
            return '-';
        }
        /**
         * wsd : 풍속 4~8 약간 강, 9~13 강, 14~ 매우강
         * pm10Value, pm10Grade
         * {date: String, lgt: Number, mx: Number, my: Number, pty: Number, reh: Number, rn1: Number,
         *          sky: Number, t1h: Number, time: String, uuu: Number, vec: Number, vvv: Number,
         *          wsd: Number}
         * @param {Object} currentTownWeather
         * @returns {{}}
         */
        function parseCurrentTownWeather(currentTownWeather) {
            var currentForecast = {};
            var time = parseInt(currentTownWeather.time.substr(0, 2));
            var isNight = time < 7 || time > 18;

            currentForecast.time = time;
            currentForecast.t1h = currentTownWeather.t1h;
            currentForecast.sky = parseSkyState(currentForecast.sky, currentTownWeather.pty,
                currentTownWeather.lgt, isNight);
            currentForecast.wsd = currentTownWeather.wsd;
            currentForecast.pm10Value = currentTownWeather.arpltn.pm10Value;
            currentForecast.pm10Grade = currentTownWeather.arpltn.pm10Grade;
            currentForecast.pm10Str = parsePm10Grade(currentTownWeather.arpltn.pm10Value);
            return currentForecast;
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
                    dayInfo = dailyTemp[dailyTemp.length - 1];
                    dayInfo.sky = parseSkyState(shortForecast.sky, shortForecast.pty, shortForecast.lgt, false);
                }
                if (shortForecast.tmx != -50 && shortForecast.tmx != 0) {
                    dayInfo.tmx = shortForecast.tmx;
                }
                //sometimes, t3h over tmx;
                if (shortForecast.t3h > dayInfo.tmx) {
                    dayInfo.tmx = shortForecast.t3h;
                }

                if (shortForecast.tmn != -50 && shortForecast.tmn != 0) {
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

        function parseSensoryTem(sensoryTem) {
            if (sensoryTem >= 0 ) {
                return '';
            }
            else if ( -10 < sensoryTem < 0) {
                return '관심';
            }
            else if ( -25 < sensoryTem <= -10) {
                return '주의';
            }
            else if ( -45 < sensoryTem <= -25) {
                return '경고';
            }
            else if (sensoryTem <= -45) {
                return '위험';
            }
            return '';
        }
        /**
         * r06 6시간 강수량, s06 6시간 신적설, Sensorytem 체감온도, 부패, 동상가능, 열, 불쾌, 동파가능, 대기확산
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
                var time = parseInt(shortForecast.time.slice(0, -2));
                var diffDays = getDiffDays(convertStringToDate(shortForecast.date), current);
                var day = getDayString(diffDays, time);
                var isNight = time < 7 || time > 18;
                var dayInfo = getDayInfo(dailyInfoList, shortForecast.date);
                if (!dayInfo) {
                    console.log("Fail to find dayInfo date=" + shortForecast.date);
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
                //It means invalid data
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
                    (time <= currentForecast.time && currentForecast.time < time + 3)) {
                    tempObject.t3h = currentForecast.t1h;
                    tempObject.sky = currentForecast.sky;
                    tempObject.tempIcon = decideTempIcon(currentForecast.t1h, dayInfo.tmx, dayInfo.tmn);
                }

                // 하루 기준의 최고, 최저 온도 찾기
                // t3h를 tmx, tmn로 대처함
                if (shortForecast.tmx !== 0) {
                    if (tempObject.t3h < shortForecast.tmx) {
                        tempObject.t3h = shortForecast.tmx;
                    }
                    tempObject.tmx = shortForecast.tmx;
                }
                else if (shortForecast.tmn !== 0) {
                    if (tempObject.tmn < tempObject.t3h) {
                        tempObject.t3h = tempObject.tmn;
                    }
                    tempObject.tmn = shortForecast.tmn;
                }

                if (diffDays === 0 && time === positionHours) {
                    currentForecast.sensorytem = shortForecast.sensorytem;
                    currentForecast.sensorytemStr = parseSensoryTem(shortForecast.sensorytem);
                }

                data.push(tempObject);

                return data.length < 32;
            });

            if (data.length < 32) {
                var i;
                for (i = 0; data.length < 32; i++) {
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
                        return {name: 'yesterday', value: d};
                    })
                },
                {
                    name: 'today',
                    values: data.slice(8).map(function (d) {
                        return {name: 'today', value: d};
                    })
                }
            ];

            return {timeTable: timeTable, timeChart: timeChart};
        }

        function parseUltrv(ultrv) {
            if (0 <= ultrv  && ultrv <= 2) return '낮음';
            else if(3 <= ultrv && ultrv <= 5) return '보통';
            else if(6 <= ultrv && ultrv <= 7) return '높음';
            else if(8 <= ultrv && ultrv <= 10) return '매우 높음';
            else if(11 <= ultrv) return '위험';
            return '';
        }
        /**
         * 식중독, ultra 자외선,
         * @param midData
         * @param dailyInfoList
         * @param currentTime
         * @param currentWeather
         * @returns {Array}
         */
        function parseMidTownWeather(midData, dailyInfoList, currentTime, currentWeather) {
            var tmpDayTable = [];
            midData.dailyData.forEach(function (dayInfo) {
                var data = {};
                data.date = dayInfo.date;

                var diffDays = getDiffDays(convertStringToDate(data.date), currentTime);
                if (diffDays < -7 || diffDays > 10) {
                    return;
                }
                if (diffDays == 0) {
                    data.week = "오늘";
                }
                else {
                    data.week = dayToString(convertStringToDate(data.date).getDay());
                }

                var skyAm = convertMidSkyString(dayInfo.wfAm);
                var skyPm = convertMidSkyString(dayInfo.wfPm);
                data.sky = getHighPrioritySky(skyAm, skyPm);
                if (diffDays === 0) {
                    data.tmx = currentWeather.t1h>dayInfo.taMax?currentWeather.t1h:dayInfo.taMax;
                    data.tmn = currentWeather.t1h<dayInfo.taMin?currentWeather.t1h:dayInfo.taMin;
                }
                else {
                    data.tmx = dayInfo.taMax;
                    data.tmn = dayInfo.taMin;
                }

                if (diffDays === 0) {
                    currentWeather.ultrv = dayInfo.ultrv;
                    currentWeather.ultrvStr = parseUltrv(dayInfo.ultrvStr);
                }
                data.humidityIcon = "Humidity-00";
                tmpDayTable.push(data);
            });

            console.log(tmpDayTable);

            var index = 0;
            for (var i = 0; i < tmpDayTable.length; i++) {
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
                    console.log("Date was mismatched index:" + index + " date:" + tmpDayTable[index].date +
                    " dayInfo.date=" + dayInfo.date);
                }
            });

            return tmpDayTable;
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
         * @param dailyInfoList
         * @param date
         * @returns {*}
         */
        function getDayInfo(dailyInfoList, date) {
            if (dailyInfoList.length === 0) {
                return undefined;
            }

            for (var i = 0; i < dailyInfoList.length; i++) {
                if (dailyInfoList[i].date === date) {
                    return dailyInfoList[i];
                }
            }

            return undefined;
        }

        /**
         *
         * @param currentHours
         * @returns {number}
         */
        function getPositionHours(currentHours) {
            return Math.floor(currentHours / 3) * 3;
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
            var date = new Date(current.getFullYear(), current.getMonth(), current.getDate());
            return Math.ceil((target - date) / (1000 * 3600 * 24));
        }

        /**
         * YYYYMMDD
         * @param {String} str
         * @returns {*}
         */
        function convertStringToDate(str) {
            var y = str.substr(0, 4),
                m = str.substr(4, 2) - 1,
                d = str.substr(6, 2);
            var data = new Date(y, m, d);
            return (data.getFullYear() == y && data.getMonth() == m && data.getDate() == d) ? data : undefined;
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

            var dayString = ['그제', '어제', '오늘', '내일', '모레', '글피'];
            if (-2 <= day && day <= 3) {
                return dayString[day + 2];
            }
            console.error("Fail to get day string day=" + day + " hours=" + hours);
            return '';
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
            return hours + '시';
        }

        /**
         *
         * @param temp
         * @param tmx
         * @param tmn
         * @returns {string}
         */
        function decideTempIcon(temp, tmx, tmn) {
            var max = tmx - tmn;
            var cur = temp - tmn;
            var p = Math.max(1, Math.ceil(cur / max * 10));

            if (p > 9) {
                return "Temp-" + p;
            }
            else {
                return "Temp-0" + p;
            }
        }

        function dayToString(day) {
            switch (day) {
                case 0:
                    return "일";
                    break;
                case 1:
                    return "월";
                    break;
                case 2:
                    return "화";
                    break;
                case 3:
                    return "수";
                    break;
                case 4:
                    return "목";
                    break;
                case 5:
                    return "금";
                    break;
                case 6:
                    return "토";
                    break;
            }
            return "";
        }

        function convertMidSkyString(skyInfo) {
            switch (skyInfo) {
                case "맑음":
                    return "Sun";
                    break;
                case "구름조금":
                    return "SunWithCloud";
                    break;
                case "구름많음":
                    return "SunWithCloud";
                    break;
                case "흐림":
                    return "Cloud";
                    break;
                case "구름적고 비":
                    return "Rain";
                    break;
                case "구름많고 비":
                    return "Rain";
                    break;
                case "흐리고 비":
                    return "Rain";
                    break;
                case "구름적고 눈":
                    return "Snow";
                    break;
                case "구름많고 눈":
                    return "Snow";
                    break;
                case "흐리고 눈":
                    return "Snow";
                    break;
            }

            console.log("Fail to convert skystring=" + skyInfo);
            return "";
        }

        function getHighPrioritySky(sky1, sky2) {
            if (sky2 === 'Rain') {
                return sky2;
            }

            return sky1;
        }

        function decideHumidityIcon(reh) {
            var tempIconName = "Humidity-";

            if (reh == 100) {
                tempIconName += "90";
            }
            else {
                tempIconName += parseInt(reh / 10) * 10;
            }
            return tempIconName;
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

        return {
            parseCurrentTownWeather: function (currentTownWeather) {
                return parseCurrentTownWeather(currentTownWeather);
            },
            parsePreShortTownWeather: function (shortForecastList) {
                return parsePreShortTownWeather(shortForecastList);
            },
            parseShortTownWeather: function (shortForecastList, currentForecast, current, dailyInfoList) {
                return parseShortTownWeather(shortForecastList, currentForecast, current, dailyInfoList);
            },
            parseMidTownWeather: function (midData, dailyInfoList, currentTime, currentForecast) {
                return parseMidTownWeather(midData, dailyInfoList, currentTime, currentForecast);
            },
            dayToString: function (day) {
                return dayToString(day);
            },
            convertTimeString: function(date) {
                return convertTimeString(date);
            }
        };
    })
    .factory('Chats', function () {
        // Might use a resource here that returns a JSON array

        // Some fake testing data
        var chats = [{
            id: 0,
            name: 'Ben Sparrow',
            lastText: 'You on your way?',
            face: 'https://pbs.twimg.com/profile_images/514549811765211136/9SgAuHeY.png'
        }, {
            id: 1,
            name: 'Max Lynx',
            lastText: 'Hey, it\'s me',
            face: 'https://avatars3.githubusercontent.com/u/11214?v=3&s=460'
        }, {
            id: 2,
            name: 'Adam Bradleyson',
            lastText: 'I should buy a boat',
            face: 'https://pbs.twimg.com/profile_images/479090794058379264/84TKj_qa.jpeg'
        }, {
            id: 3,
            name: 'Perry Governor',
            lastText: 'Look at my mukluks!',
            face: 'https://pbs.twimg.com/profile_images/598205061232103424/3j5HUXMY.png'
        }, {
            id: 4,
            name: 'Mike Harrington',
            lastText: 'This is wicked good ice cream.',
            face: 'https://pbs.twimg.com/profile_images/578237281384841216/R3ae1n61.png'
        }];

        return {
            all: function () {
                return chats;
            },
            remove: function (chat) {
                chats.splice(chats.indexOf(chat), 1);
            },
            get: function (chatId) {
                for (var i = 0; i < chats.length; i++) {
                    if (chats[i].id === parseInt(chatId)) {
                        return chats[i];
                    }
                }
                return null;
            }
        };
    });
