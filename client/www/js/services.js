angular.module('starter.services', [])

    .factory('WeatherInfo', function ($q, $http, WeatherUtil) {
        var obj = {
            cities: [],
            towns: [],
            cityIndex: 0, // 최초 지역은 현재 위치가 보여지도록 함
            loadIndex: -1 // 초기 로드 중인 city index
        };

        //region APIs

        obj.addCity = function (city) {
            var that = this;

            if (that.getIndexOfCity(city) === -1) {
                that.cities.push(city);
                that.saveCities();
                return true;
            }
            return false;
        };

        obj.removeCity = function (index) {
            var that = this;

            if (index !== -1) {
                that.cities.splice(index, 1);
                that.saveCities();
                return true;
            }
            return false;
        };

        obj.updateCity = function (index, weatherData) {
            var that = this;
            var city = that.cities[index];

            if (weatherData.address) {
                city.address = weatherData.address;
            }
            if (weatherData.location) {
                city.location = weatherData.location;
            }
            if (weatherData.currentWeather) {
                city.currentWeather = weatherData.currentWeather;
            }
            if (weatherData.timeTable) {
                city.timeTable = weatherData.timeTable;
            }
            if (weatherData.timeChart) {
                city.timeChart = weatherData.timeChart;
            }
            if (weatherData.dayTable) {
                city.dayTable = weatherData.dayTable;
            }
            if (weatherData.dayChart) {
                city.dayChart = weatherData.dayChart;
            }

            that.saveCities();
        };

        obj.getIndexOfCity = function (city) {
            var that = this;

            for (var i = 0; i < that.cities.length; i += 1) {
                if (that.cities[i].currentPosition === true) {
                    if (city.currentPosition === true) {
                        return i;
                    }
                }
                else {
                    if (that.cities[i].address === city.address) {
                        return i;
                    }
                }
            }
            return -1;
        };

        obj.getCityOfIndex = function (index) {
            var that = this;

            if (index < 0 || index >= that.cities.length) {
                return null;
            }
            return that.cities[index];
        };

        obj.getCityCount = function () {
            var that = this;
            return that.cities.length;
        };

        obj.loadCities = function() {
            if (typeof(Storage) === "undefined") {
                return false;
            }

            var that = this;
            that.cities = JSON.parse(localStorage.getItem("cities"));
            if (that.cities === null) { // set guide data
                var city = {};
                city.currentPosition = true;
                city.address = "대한민국 하늘시 중구 구름동";
                city.location = null;
                city.currentWeather = {time: 7, t1h: 19, skyIcon: "SunWithCloud", tmn: 14, tmx: 28, summary: "어제보다 1도 낮음,미세먼지보통"};

                var timeData = [];
                timeData[0] = {day: "", time: "6시", t3h: 17, skyIcon:"Cloud", pop: 10, tempIcon:"Temp-01", tmn: 17, tmx: -50};
                timeData[1] = {day: "", time: "9시", t3h: 21, skyIcon:"Lightning", pop: 20, tempIcon:"Temp-02", tmn: -50, tmx:-50};
                timeData[2] = {day: "", time: "12시", t3h: 26, skyIcon:"Moon", pop: 30, tempIcon:"Temp-03", tmn: -50, tmx:-50};
                timeData[3] = {day: "", time: "15시", t3h: 28, skyIcon:"MoonWithCloud", pop: 40, tempIcon:"Temp-04", tmn:-50, tmx: 28};
                timeData[4] = {day: "", time: "18시", t3h: 26, skyIcon:"Rain", pop: 50, tempIcon:"Temp-05", tmn: -50, tmx:-50};
                timeData[5] = {day: "", time: "21시", t3h: 21, skyIcon:"RainWithLightning", pop: 60, tempIcon:"Temp-06", tmn: -50, tmx:-50};
                timeData[6] = {day: "어제", time: "0시", t3h: 18, skyIcon:"RainWithSnow", pop: 70, tempIcon:"Temp-07", tmn: -50, tmx:-50};
                timeData[7] = {day: "", time: "3시", t3h: 16, skyIcon:"Snow", pop: 80, tempIcon:"Temp-08", tmn: -50, tmx:-50};
                timeData[8] = {day: "", time: "6시", t3h: 15, skyIcon:"SnowWithLightning-Big", pop: 90, tempIcon:"Temp-09", tmn: 15, tmx:-50};
                timeData[9] = {day: "", time: "9시", t3h: 21, skyIcon:"Sun", pop: 10, tempIcon:"Temp-10", tmn: -50, tmx:-50};
                timeData[10] = {day: "", time: "12시", t3h: 26, skyIcon:"SunWithCloud", pop: 20, tempIcon:"Temp-10", tmn: -50, tmx:-50};
                timeData[11] = {day: "", time: "15시", t3h: 28, skyIcon:"WindWithCloud", pop: 30, tempIcon:"Temp-01", tmn: -50, tmx:-50};
                timeData[12] = {day: "", time: "18시", t3h: 29, skyIcon:"Rain", pop: 50, tempIcon:"Temp-04", tmn: -50, tmx: 29};
                timeData[13] = {day: "", time: "21시", t3h: 21, skyIcon:"RainWithLightning", pop: 60, tempIcon:"Temp-05", tmn: -50, tmx:-50};
                timeData[14] = {day: "오늘", time: "0시", t3h: 18, skyIcon:"RainWithSnow", pop: 70, tempIcon:"Temp-06", tmn: -50, tmx:-50};
                timeData[15] = {day: "", time: "3시", t3h: 15, skyIcon:"Snow", pop: 80, tempIcon:"Temp-07", tmn: -50, tmx:-50};
                timeData[16] = {day: "", time: "6시", t3h: 14, skyIcon:"SnowWithLightning-Big", pop: 90, tempIcon:"Temp-08", tmn: 14, tmx:-50};
                timeData[17] = {day: "", time: "9시", t3h: 21, skyIcon:"Cloud", pop: 10, tempIcon:"Temp-09", tmn: -50, tmx:-50};
                timeData[18] = {day: "", time: "12시", t3h: 26, skyIcon:"Lightning", pop: 20, tempIcon:"Temp-10", tmn: -50, tmx:-50};
                timeData[19] = {day: "", time: "15시", t3h: 29, skyIcon:"Moon", pop: 30, tempIcon:"Temp-01", tmn:-50, tmx: 29};
                timeData[20] = {day: "", time: "18시", t3h: 28, skyIcon:"MoonWithCloud", pop: 50, tempIcon:"Temp-04", tmn: -50, tmx:-50};
                timeData[21] = {day: "", time: "21시", t3h: 22, skyIcon:"Rain", pop: 60, tempIcon:"Temp-05", tmn: -50, tmx:-50};
                timeData[22] = {day: "내일", time: "0시", t3h: 20, skyIcon:"RainWithSnow", pop: 70, tempIcon:"Temp-06", tmn: -50, tmx:-50};
                timeData[23] = {day: "", time: "3시", t3h: 18, skyIcon:"RainWithLightning", pop: 80, tempIcon:"Temp-07", tmn: -50, tmx:-50};
                timeData[24] = {day: "", time: "6시", t3h: 17, skyIcon:"SnowWithLightning-Big", pop: 90, tempIcon:"Temp-08", tmn: 17, tmx:-50};
                timeData[25] = {day: "", time: "9시", t3h: 21, skyIcon:"Sun", pop: 10, tempIcon:"Temp-09", tmn: -50, tmx:-50};
                timeData[26] = {day: "", time: "12시", t3h: 27, skyIcon:"SunWithCloud", pop: 20, tempIcon:"Temp-10", tmn: -50, tmx:-50};
                timeData[27] = {day: "", time: "15시", t3h: 29, skyIcon:"WindWithCloud", pop: 30, tempIcon:"Temp-01", tmn: -50, tmx: 29};
                timeData[28] = {day: "", time: "18시", t3h: 28, skyIcon:"Rain", pop: 50, tempIcon:"Temp-04", tmn: -50, tmx:-50};
                timeData[29] = {day: "", time: "21시", t3h: 24, skyIcon:"RainWithLightning", pop: 60, tempIcon:"Temp-05", tmn: -50, tmx:-50};
                timeData[30] = {day: "모레", time: "0시", t3h: 21, skyIcon:"RainWithSnow", pop: 70, tempIcon:"Temp-06", tmn: -50, tmx:-50};
                timeData[31] = {day: "", time: "3시", t3h: 18, skyIcon:"Snow", pop: 80, tempIcon:"Temp-07", tmn: -50, tmx:-50};
                //timeData[32] = {day: "", time: "6시", t3h: 17, skyIcon:"SnowWithLightning-Big", pop: 90, tempIcon:"Temp-08"};
                //timeData[33] = {day: "", time: "9시", t3h: 21, skyIcon:"Sun", pop: 10, tempIcon:"Temp-09"};
                //timeData[34] = {day: "", time: "12시", t3h: 26, skyIcon:"SunWithCloud", pop: 20, tempIcon:"Temp-10"};
                //timeData[35] = {day: "", time: "15시", t3h: 29, skyIcon:"WindWithCloud", pop: 30, tempIcon:"Temp-01"};
                //timeData[36] = {day: "", time: "18시", t3h: 26, skyIcon:"Rain", pop: 50, tempIcon:"Temp-04"};
                //timeData[37] = {day: "", time: "21시", t3h: 23, skyIcon:"RainWithLightning", pop: 60, tempIcon:"Temp-05"};
                //timeData[38] = {day: "글피", time: "0시", t3h: 18, skyIcon:"RainWithSnow", pop: 70, tempIcon:"Temp-06"};
                //timeData[39] = {day: "", time: "3시", t3h: 18, skyIcon:"Snow", pop: 80, tempIcon:"Temp-07"};

                city.timeTable = timeData.slice(8);
                city.timeChart = [
                    {
                        name: "yesterday",
                        values: timeData.slice(0, timeData.length - 8).map(function (d) {
                            return { name: "yesterday", value: d };
                        })
                    },
                    {
                        name: "today",
                        values: timeData.slice(8).map(function (d) {
                            return { name: "today", value: d };
                        })
                    }
                ];

                var dayData = [];
                dayData[0] = {week: "목", skyIcon:"Cloud", pop: 10, humidityIcon:"Humidity-10", reh: 10, tmn: 10, tmx: 28};
                dayData[1] = {week: "금", skyIcon:"Lightning", pop: 20, humidityIcon:"Humidity-20", reh: 10, tmn: 17, tmx: 26};
                dayData[2] = {week: "토", skyIcon:"Moon", pop: 30, humidityIcon:"Humidity-30", reh: 10, tmn: 16, tmx: 23};
                dayData[3] = {week: "일", skyIcon:"MoonWithCloud", pop: 40, humidityIcon:"Humidity-40", reh: 10, tmn: 14, tmx: 22};
                dayData[4] = {week: "월", skyIcon:"Rain", pop: 50, humidityIcon:"Humidity-50", reh: 10, tmn: 14, tmx: 22};
                dayData[5] = {week: "화", skyIcon:"RainWithLightning", pop: 60, humidityIcon:"Humidity-60", reh: 10, tmn: 12, tmx: 22};
                dayData[6] = {week: "수", skyIcon:"RainWithSnow", pop: 70, humidityIcon:"Humidity-70", reh: 10, tmn: 15, tmx: 27};
                dayData[7] = {week: "오늘", skyIcon:"Snow", pop: 80, humidityIcon:"Humidity-80", reh: 10, tmn: 15, tmx: 25};
                dayData[8] = {week: "금", skyIcon:"SnowWithLightning-Big", pop: 90, humidityIcon:"Humidity-90", reh: 10, tmn: 15, tmx: 22};
                dayData[9] = {week: "토", skyIcon:"Sun", pop: 10, humidityIcon:"Humidity-10", reh: 10, tmn: 12, tmx: 22};
                dayData[10] = {week: "일", skyIcon:"SunWithCloud", pop: 20, humidityIcon:"Humidity-10", reh: 10, tmn: 17, tmx: 28};
                dayData[11] = {week: "월", skyIcon:"WindWithCloud", pop: 30, humidityIcon:"Humidity-10", reh: 10, tmn: 17, tmx: 27};
                dayData[12] = {week: "화", skyIcon:"Rain", pop: 50, humidityIcon:"Humidity-40", reh: 10, tmn: 17, tmx: 26};
                dayData[13] = {week: "수", skyIcon:"RainWithLightning", pop: 60, humidityIcon:"Humidity-50", reh: 10, tmn: 16, tmx: 24};
                dayData[14] = {week: "목", skyIcon:"RainWithSnow", pop: 70, humidityIcon:"Humidity-60", reh: 10, tmn: 15, tmx: 28};
                dayData[15] = {week: "금", skyIcon:"Snow", pop: 80, humidityIcon:"Humidity-70", reh: 10, tmn: 17, tmx: 26};
                dayData[16] = {week: "토", skyIcon:"SnowWithLightning-Big", pop: 90, humidityIcon:"Humidity-80", reh: 10, tmn: 13, tmx: 24};
                dayData[17] = {week: "일", skyIcon:"Cloud", pop: 10, humidityIcon:"Humidity-90", reh: 10, tmn: 12, tmx: 25};

                city.dayTable = dayData;
                city.dayChart = [{
                    values: dayData,
                    temp: city.currentWeather.t1h
                }];

                that.cities = [];
                that.cities.push(city);
            }
        };

        obj.saveCities = function() {
            if (typeof(Storage) === "undefined") {
                return false;
            }

            var that = this;
            localStorage.setItem("cities", JSON.stringify(that.cities));
        };

        obj.updateCities = function() {
            var that = this;
            var city = that.cities[++that.loadIndex];

            if (city) {
                WeatherUtil.getWeatherInfo(city.address, that.towns).then(function (weatherDatas) {
                    var city = WeatherUtil.convertWeatherData(weatherDatas);
                    that.updateCity(that.loadIndex, city);
                }).finally(function() {
                    that.updateCities();
                });
            }
        };

        obj.loadTowns = function() {
            var that = this;
            var deferred = $q.defer();

            $http.get('data/town.json')
                .then(function (res) {
                    that.towns = res.data;
                    deferred.resolve();
                }, function () {
                    deferred.reject();
                });

            return deferred.promise;
        };

        //endregion

        return obj;
    })
    .factory('WeatherUtil', function ($q, $http, Util) {
        var obj = {};

        //region Function

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

            if (lgt === 1) {
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
         * day시작 값이 index 0부터 시작하도록, padding value을 맞추어야 함.
         * @param day
         * @returns {*}
         */
        function getDayString(day) {
            var dayString = ["엊그제", "그제", "어제", "오늘", "내일", "모레", "글피"];
            if (-3 <= day && day <= 3) {
                return dayString[day + 3];
            }
            console.error("Fail to get day string day=" + day);
            return "";
        }

        /**
         *
         * @param temp
         * @param tmx
         * @param tmn
         * @returns {string}
         */
        function decideTempIcon(temp, tmx, tmn) {
            if ( (tmx === undefined || tmx === null) || (tmn === undefined || tmn === null) || tmx < tmn) {
                return "Temp-01";
            }

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
                case "흐리고 한때 비":
                case "구름적고 한때 비":
                case "구름많고 한때 비":
                case "구름적고 비":
                case "구름많고 비":
                case "흐리고 비":
                    return "Rain";
                    break;
                case "흐리고 한때 눈":
                case "구름적고 한때 눈":
                case "구름많고 한때 눈":
                case "구름적고 눈":
                case "구름많고 눈":
                case "흐리고 눈":
                    return "Snow";
                    break;
                case "구름적고 비/눈":
                case "구름적고 눈/비":
                case "구름많고 비/눈":
                case "구름많고 눈/비":
                case "흐리고 비/눈":
                case "흐리고 눈/비":
                    return "RainWithSnow";
            }

            console.log("Fail to convert skystring=" + skyInfo);
            return "";
        }

        function getHighPrioritySky(sky1, sky2) {
            if (sky2 === "RainWithSnow" || sky1 === "RainWithSnow") {
                return "RainWithSnow";
            }
            if (sky2 === "Rain") {
                if (sky1 === "Show") {
                   return "RainWithSnow";
                }
                return sky2;
            }
            if (sky2 === "Snow") {
                if (sky1 === "Rain") {
                    return "RainWithSnow";
                }
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
         * It's supporting only korean lang
         * @param {Object[]} results
         * @returns {string}
         */
        function findDongAddressFromGoogleGeoCodeResults(results) {
            var dongAddress = "";
            var length = 0;

            results.forEach(function (result) {
                var lastChar = result.formatted_address.slice(-1);
                if (lastChar === "동" || lastChar === "읍" || lastChar === "면")  {
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
         * @param {Object[]} results
         * @returns {string}
         */
        function findLocationFromGoogleGeoCodeResults(results) {
            var location = {}; //{"lat": Number, "long": Number};

            results.forEach(function (result) {
                location.lat = result.geometry.location.lat;
                location.long = result.geometry.location.lng;
            });
            return location;
        }

        function getTownWeatherInfo (town) {
            var deferred = $q.defer();
            var url;
            if (Util.isDebug()) {
                //url = "town";
                //url = "http://localhost:3000/v000705/town";
                url = "http://todayweather-wizardfactory.rhcloud.com/v000705/town";
            }
            else {
                url = "http://todayweather.wizardfactory.net/v000705/town";
            }

            url += "/" + town.first;
            if (town.second) {
                url += "/" + town.second;
            }
            if (town.third) {
                url += "/" + town.third;
            }
            console.log(url);

            $http({method: 'GET', url: url, timeout: 10*1000})
                .success(function (data) {
                    console.log(data);
                    deferred.resolve({data: data});
                })
                .error(function (error) {
                    if (!error) {
                        error = new Error("Fail to get weatherInfo");
                    }
                    console.log(error);
                    deferred.reject(error);
                });

            return deferred.promise;
        }
        //endregion

        //region APIs

        /**
         * wsd : 풍속 4~8 약간 강, 9~13 강, 14~ 매우강
         * pm10Value, pm10Grade
         * {date: String, lgt: Number, mx: Number, my: Number, pty: Number, reh: Number, rn1: Number,
         *          sky: Number, t1h: Number, time: String, uuu: Number, vec: Number, vvv: Number,
         *          wsd: Number}
         * @param {Object} currentTownWeather
         * @returns {{}}
         */
        obj.parseCurrentTownWeather = function (currentTownWeather) {
            var currentForecast = {};
            var time;
            var isNight;

            if (!currentTownWeather) {
                return currentForecast;
            }
            time = parseInt(currentTownWeather.time.substr(0, 2));
            isNight = time < 7 || time > 18;
            currentForecast = currentTownWeather;
            //time is used in ngShortChart
            currentForecast.time = time;

            currentForecast.skyIcon = parseSkyState(currentTownWeather.sky, currentTownWeather.pty,
                currentTownWeather.lgt, isNight);

            return currentForecast;
        };

        /**
         * @param {Object[]} shortForecastList
         * @param {Date} currentForecast
         * @param {Date} current
         * @param {Object[]} midData.dailyData
         * @returns {{timeTable: Array, timeChart: Array}}
         */
        obj.parseShortTownWeather = function (shortForecastList, currentForecast, current, dailyInfoList) {
            var data = [];

            if (!shortForecastList || !Array.isArray(shortForecastList)) {
                return {timeTable: [], timeChart: []};
            }

            shortForecastList.every(function (shortForecast, index) {
                var tempObject;
                var time = parseInt(shortForecast.time.slice(0, -2));
                var diffDays = getDiffDays(convertStringToDate(shortForecast.date), current);
                var day = "";
                if (index === 0 || (shortForecastList[index-1].date !== shortForecast.date)) {
                    day = getDayString(diffDays);
                }
                var isNight = time < 7 || time > 18;
                var dayInfo = getDayInfo(dailyInfoList, shortForecast.date);
                if (!dayInfo) {
                    console.log("Fail to find dayInfo date=" + shortForecast.date);
                    dayInfo = {date: shortForecast.date, taMax: 100, taMin: -49};
                }

                tempObject = shortForecast;

                tempObject.skyIcon = parseSkyState(shortForecast.sky, shortForecast.pty, shortForecast.lgt, isNight);
                tempObject.tempIcon = decideTempIcon(shortForecast.t3h, dayInfo.taMax, dayInfo.taMin);

                tempObject.day = day;
                tempObject.time = time + "시";
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
                    })
                }
            ];

            return {timeTable: timeTable, timeChart: timeChart};
        };
        
        /**
         * 식중독, ultra 자외선,
         * @param midData
         * @param currentTime
         * @returns {Array}
         */
        obj.parseMidTownWeather = function (midData, currentTime) {
            var tmpDayTable = [];

            if (!midData || !midData.hasOwnProperty('dailyData') || !Array.isArray(midData.dailyData)) {
                return tmpDayTable;
            }
            midData.dailyData.forEach(function (dayInfo) {
                var data;
                data = dayInfo;

                var diffDays = getDiffDays(convertStringToDate(data.date), currentTime);

                if (diffDays == 0) {
                    data.week = "오늘";
                }
                else {
                    data.week = dayToString(convertStringToDate(data.date).getDay());
                }

                var skyAm = convertMidSkyString(dayInfo.wfAm);
                var skyPm = convertMidSkyString(dayInfo.wfPm);
                data.skyIcon = getHighPrioritySky(skyAm, skyPm);

                data.tmx = dayInfo.taMax;
                data.tmn = dayInfo.taMin;

                if (data.reh !== undefined) {
                    data.humidityIcon = decideHumidityIcon(data.reh);
                }
                else {
                    data.humidityIcon = "Humidity-00";
                }

                tmpDayTable.push(data);
            });

            console.log(tmpDayTable);
            return tmpDayTable;
        };

        /**
         *
         * @param date
         * @returns {string}
         */
        obj.convertTimeString = function (date) {
            return (date.getMonth()+1)+"월 "+date.getDate()+ "일" + "("+dayToString(date.getDay()) +") " +
                    " " + (date.getHours()<10?"0":"") + date.getHours() +
                    ":" + (date.getMinutes()<10?"0":"") + date.getMinutes();
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
         * 남해군 같은 경우 군을 버리면 남해 라고 표시되어 이상해보이므로, 시,군 표시함.
         * @param name
         * @returns {*}
         * @private
         */
        obj._getShortSiName = function(name) {
            //특별시, 특별자치시, 광역시,
            var aStr = ["특별시", "광역시", "특별자치시"];
            for (var i=0; i<aStr.length; i++) {
                if (name.slice(-1*aStr[i].length) === aStr[i]) {
                    return name.replace(aStr[i], "시");
                }
            }
            return name;
        };

        /**
         * It's supporting only korean lang
         * return si+dong, si+gu, si or do
         * @param {String} fullAddress
         * @returns {string}
         */
        obj.getShortenAddress = function (fullAddress) {
            var that = this;
            var parsedAddress = that.convertAddressArray(fullAddress);

            if (!parsedAddress || parsedAddress.length < 2) {
                console.log("Fail to split full address="+fullAddress);
                return "";
            }

            if (parsedAddress.length === 5) {
                //nation + do + si + gu + dong
                return that._getShortSiName(parsedAddress[2])+","+parsedAddress[4];
            }
            else if (parsedAddress.length === 4) {
                if (parsedAddress[1].slice(-1) === '도') {
                    //nation + do + si + gu
                    return parsedAddress[2]+","+parsedAddress[3];
                }
                else {
                    //nation + si + gu + dong
                    return that._getShortSiName(parsedAddress[1])+","+parsedAddress[3];
                }
            }
            else if (parsedAddress.length === 3) {
                //nation + do + si
                //nation + si + gu
                //nation + si + eup,myeon
                return that._getShortSiName(parsedAddress[1])+","+parsedAddress[2];
            }
            else if (parsedAddress.length === 2) {
                //nation + si,do
                return that._getShortSiName(parsedAddress[1]);
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

        function getGeoCodeFromDaum(address) {
            var deferred = $q.defer();
            var url = 'https://apis.daum.net/local/geo/addr2coord'+
                '?apikey=' + '[DAUM_SERVICE_KEY]' +
                '&q='+ encodeURIComponent(address) +
                '&output=json';

            $http({method: 'GET', url: url, timeout: 3000}).success(function (data) {
                var lat = data.channel.item[0].lat;
                var lng = data.channel.item[0].lng;
                var location = {"lat":lat, "long":lng};
                deferred.resolve(location);
            }).error(function (err) {
                deferred.reject(err);
            });

            return deferred.promise;
        }

        function getGeoCodeFromGoogle(address) {
            var deferred = $q.defer();
            var url = "https://maps.googleapis.com/maps/api/geocode/json?address=" + address;

            $http({method: 'GET', url: url, timeout: 3000}).success(function (data) {
                if (data.status === 'OK') {
                    var location = findLocationFromGoogleGeoCodeResults(data.results);
                    console.log(location);
                    deferred.resolve(location);
                }
                else {
                    //'ZERO_RESULTS', 'OVER_QUERY_LIMIT', 'REQUEST_DENIED',  'INVALID_REQUEST', 'UNKNOWN_ERROR'
                    deferred.reject(new Error(data.status));
                }
            }).error(function (err) {
                deferred.reject(err);
            });

            return deferred.promise;
        }

        /**
         *
         * @param {String} address
         */
        obj.getAddressToGeolocation = function (address) {
            var deferred = $q.defer();

            getGeoCodeFromDaum(address).then(function(location) {

                console.log(location);
                deferred.resolve(location);
            }, function (err) {

                console.log(err);
                getGeoCodeFromGoogle(address).then(function (location) {
                    console.log(location);
                    deferred.resolve(location);
                }, function (err) {
                    console.log(err);
                    deferred.reject(err);
                });
            });

            return deferred.promise;
        };

        function getAddressFromDaum(lat, lng) {
            var deferred = $q.defer();
            var url = 'https://apis.daum.net/local/geo/coord2addr'+
                '?apikey=' + '[DAUM_SERVICE_KEY]'+
                '&longitude='+ lng +
                '&latitude='+lat+
                '&inputCoordSystem=WGS84'+
                '&output=json';

            $http({method: 'GET', url: url, timeout: 3000}).success(function (data) {
                if (data.fullName) {
                    var address = data.fullName;

                    address = '대한민국 ' + address;
                    deferred.resolve(address);
                }
                else {
                    deferred.reject(new Error('Fail to get address name'));
                }
            }).error(function (err) {
                deferred.reject(err);
            });

            return deferred.promise;
        }

        function getAddressFromGoogle(lat, lng) {
            var deferred = $q.defer();
            var url = "https://maps.googleapis.com/maps/api/geocode/json?latlng=" + lat + "," + lng +
                "&sensor=true&language=ko";

            $http({method: 'GET', url: url, timeout: 3000}).success(function (data) {
                if (data.status === "OK") {
                    var address = findDongAddressFromGoogleGeoCodeResults(data.results);
                    if (!address || address.length === 0) {
                        deferred.reject(new Error("Fail to find dong address from " + data.results[0].formatted_address));
                    }
                    console.log(address);
                    deferred.resolve(address);
                }
                else {
                    //'ZERO_RESULTS', 'OVER_QUERY_LIMIT', 'REQUEST_DENIED',  'INVALID_REQUEST', 'UNKNOWN_ERROR'
                    deferred.reject(new Error(data.status));
                }
            }).error(function (err) {
                deferred.reject(err);
            });

            return deferred.promise;
        }

        /**
         * related to #380
         * @param {Number} lat
         * @param {Number} long
         */
        obj.getAddressFromGeolocation = function (lat, long) {
            var deferred = $q.defer();

            getAddressFromDaum(lat, long).then(function(address) {

                console.log(address);
                deferred.resolve(address);
            }, function (err) {

                console.log(err);
                getAddressFromGoogle(lat, long).then(function (address) {
                    console.log(address);
                    deferred.resolve(address);
                }, function (err) {
                    deferred.reject(err);
                });
            });

            return deferred.promise;
        };

        obj.getCurrentPosition = function () {
            var deferred = $q.defer();

            if (ionic.Platform.isAndroid() && window.cordova) {

                var orgGeo = cordova.require('cordova/modulemapper').getOriginalSymbol(window, 'navigator.geolocation');

                orgGeo.getCurrentPosition(function (position) {
                        //console.log('native geolocation');
                        //console.log(position);
                        deferred.resolve(position.coords);
                    },
                    function (error) {
                        console.log("Fail to get current position from native");
                        console.log(error);
                        deferred.reject();
                    },{timeout:5000});
            }
            else {
                navigator.geolocation.getCurrentPosition(function(position) {
                    //경기도,광주시,오포읍,37.36340556,127.2307667
                    //deferred.resolve({latitude: 37.363, longitude: 127.230});
                    //세종특별자치시,세종특별자치시,연기면,36.517338,127.259247
                    //37.472595, 126.795249
                    //경상남도/거제시옥포2동 "lng":128.6875, "lat":34.8966
                    //deferred.resolve({latitude: 34.8966, longitude: 128.6875});

                    deferred.resolve(position.coords);
                }, function(error) {
                    console.log("Fail to get current position from navigator");
                    console.log(error);
                    deferred.reject();
                },{timeout:3000});
            }
            return deferred.promise;
        };

        /**
         *
         * @param address
         * @param towns
         * @returns {*}
         */
        obj.getWeatherInfo = function (address, towns) {
            var that = this;
            var addressArray = that.convertAddressArray(address);
            var townAddress = that.getTownFromFullAddress(addressArray);

            var town = towns.filter(function (town) {
                return !!(town.first === townAddress.first && town.second === townAddress.second
                && town.third === townAddress.third);
            })[0];

            if (town === undefined) {
                var deferred = $q.defer();
                deferred.reject("address is empty");
                return deferred.promise;
            }

            var promises = [];
            promises.push(getTownWeatherInfo(town));

            return $q.all(promises);
        };

        /**
         *
         * @param weatherDatas
         * @returns {{}}
         */
        obj.convertWeatherData = function (weatherDatas) {
            var that = this;
            var data = {};
            var currentTime = new Date();
            var weatherData = {};
            weatherDatas.forEach(function (data) {
                if (data.hasOwnProperty("data")) {
                    weatherData = data.data;
                }
            });

            var currentForecast = that.parseCurrentTownWeather(weatherData.current);

            /**
             * @type {{name, value}|{timeTable, timeChart}|{timeTable: Array, timeChart: Array}}
             */
            var shortTownWeather = that.parseShortTownWeather(weatherData.short, currentForecast, currentTime, weatherData.midData.dailyData);
            console.log(shortTownWeather);

            /**
             * @type {Array}
             */
            var midTownWeather = that.parseMidTownWeather(weatherData.midData, currentTime);
            console.log(midTownWeather);

            data.currentWeather = currentForecast;
            data.timeTable = shortTownWeather.timeTable;
            data.timeChart = shortTownWeather.timeChart;
            data.dayTable = midTownWeather;
            data.dayChart = [{
                values: midTownWeather,
                temp: currentForecast.t1h
            }];

            return data;
        };

        //endregion

        return obj;
    })
    .factory('Util', function () {
        var obj = {};
        var debug = true;

        //region Function

        //endregion

        //region APIs

        obj.isDebug = function () {
            return debug;
        };

        //endregion

        return obj;
    });
