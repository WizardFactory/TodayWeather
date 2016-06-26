angular.module('starter.services', [])

    .factory('WeatherInfo', function ($rootScope, WeatherUtil, $ionicPlatform, $cordovaPreferences) {
        var cities = [];
        var cityIndex = -1;
        var obj = {
            towns: [],
            isLoadComplete: false
        };

        var createCity = function (item) {
            var city = {};

            if (item === undefined) {
                city.currentPosition = true;
                city.address = null;
                city.location = null;
                city.currentWeather = null;
                city.timeTable = null;
                city.timeChart = null;
                city.dayTable = null;
                city.dayChart = null;
                city.disable = true; // 현재 위치 off
            } else {
                city.currentPosition = item.currentPosition;
                city.address = item.address;
                city.location = item.location;
                city.currentWeather = item.currentWeather;
                city.timeTable = item.timeTable;
                city.timeChart = item.timeChart;
                city.dayTable = item.dayTable;
                city.dayChart = item.dayChart;
                city.disable = item.disable === undefined ? false : item.disable;
            }
            city.loadTime = null;
            cities.push(city);
        };

        //region APIs

        obj.getIndexOfCity = function (city) {
            for (var i = 0; i < cities.length; i += 1) {
                if (cities[i].currentPosition === true) {
                    if (city.currentPosition === true) {
                        return i;
                    }
                }
                else {
                    if (cities[i].address === city.address) {
                        return i;
                    }
                }
            }
            return -1;
        };

        obj.getCityOfIndex = function (index) {
            if (index < 0 || index >= cities.length) {
                return null;
            }
            return cities[index];
        };

        obj.getCityCount = function () {
            return cities.length;
        };

        obj.getEnabledCityCount = function () {
            var count = cities.length;

            for (var i = 0; i < cities.length; i += 1) {
                if (cities[i].disable === true) {
                    count -= 1;
                }
            }
            return count;
        };

        obj.getCityIndex = function () {
            return cityIndex;
        };

        obj.setCityIndex = function (index) {
            if (index >= -1 && index < cities.length) {
                cityIndex = index;
                // save current cityIndex
                localStorage.setItem("cityIndex", JSON.stringify(cityIndex));
                console.log("cityIndex = " + cityIndex);
            }
        };

        obj.setFirstCityIndex = function () {
            var that = this;
            var city = cities[0];

            if (city.disable === true) {
                if (cities.length === 1) {
                    that.setCityIndex(-1);
                } else {
                    that.setCityIndex(1);
                }
            } else {
                that.setCityIndex(0);
            }
        };

        obj.setPrevCityIndex = function () {
            var that = this;
            var city = cities[0];

            if (cityIndex === 0 || (cityIndex === 1 && city.disable === true)) {
                that.setCityIndex(cities.length - 1);
            }
            else {
                that.setCityIndex(cityIndex - 1);
            }
        };

        obj.setNextCityIndex = function () {
            var that = this;

            if (cityIndex === cities.length - 1) {
                that.setFirstCityIndex();
            }
            else {
                that.setCityIndex(cityIndex + 1);
            }
        };

        obj.canLoadCity = function (index) {
            var city = cities[index];

            if (city.disable === true) {
                return false;
            }

            var time = new Date();
            return !!(city.loadTime === null || time.getTime() - city.loadTime.getTime() > (10 * 60 * 1000));
        };

        obj.addCity = function (city) {
            var that = this;

            if (that.getIndexOfCity(city) === -1) {
                city.disable = false;
                city.loadTime = null;
                cities.push(city);
                that.saveCities();
                return true;
            }
            return false;
        };

        obj.removeCity = function (index) {
            var that = this;

            if (index !== -1) {
                cities.splice(index, 1);
                that.saveCities();

                if (cityIndex === that.getCityCount()) {
                    that.setFirstCityIndex();
                }
                return true;
            }
            return false;
        };

        obj.disableCity = function (disable) {
            var that = this;

            cities[0].disable = disable;
            that.saveCities();

            if (cityIndex <= 0) {
                that.setFirstCityIndex();
            }
        };

        obj.reloadCity = function (index) {
            var city = cities[index];

            city.loadTime = null;
        };

        obj.updateCity = function (index, weatherData) {
            var that = this;
            var city = cities[index];

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
            if (window.push && city.currentPosition == true) {
                if (window.push.getAlarm(index)) {
                    window.push.updateAlarm(index, city.address);
                }
            }
            city.loadTime = new Date();

            that.saveCities();
        };

        obj.loadCities = function() {
            var that = this;
            var items = JSON.parse(localStorage.getItem("cities"));

            if (items === null) {
                createCity();
            } else {
                items.forEach(function (item) {
                    createCity(item);
                });
                that._loadCitiesPreference(function (err) {
                    if (err) {
                        //restore cities
                        that._saveCitiesPreference(items);
                    }
                });
            }

            // load last cityIndex
            cityIndex = JSON.parse(localStorage.getItem("cityIndex"));
            if (cityIndex === null) {
                that.setFirstCityIndex();
            }
        };

        obj._saveCitiesPreference = function (cities) {
            var pList = {cityList: []};
            cities.forEach(function (city) {
                if (!city.disable) {
                    var simpleInfo = {};
                    simpleInfo.currentPosition = city.currentPosition;
                    simpleInfo.address = city.address;
                    simpleInfo.location = city.location;
                    pList.cityList.push(simpleInfo);
                }
            });

            console.log('save preference plist='+JSON.stringify(pList));

            $cordovaPreferences.store('cityList', JSON.stringify(pList))
                .success(function(value) {
                    console.log("save preference Success: " + value);
                })
                .error(function(error) {
                    console.log("save preference Error: " + error);
                });
        };

        obj._loadCitiesPreference = function (callback) {
            $cordovaPreferences.fetch('cityList')
                .success(function(value) {
                    console.log("fetch preference Success: " + value);
                    callback(undefined, value);
                })
                .error(function(error) {
                    console.log("fetch preference Error: " + error);
                    callback(error);
                })
        };

        obj.saveCities = function() {
            localStorage.setItem("cities", JSON.stringify(cities));
            this._saveCitiesPreference(cities);
        };

        obj.updateCities = function(index) {
            var that = this;
            var city = cities[index];

            if (city === undefined) {
                $ionicPlatform.ready(function() {
                    that.isLoadComplete = true;
                    $rootScope.$broadcast('loadCompleteEvent');
                });
                return;
            }

            if (that.canLoadCity(index) && !city.currentPosition) {
                WeatherUtil.getWeatherInfo(city.address, that.towns).then(function (weatherDatas) {
                    var city = WeatherUtil.convertWeatherData(weatherDatas);
                    that.updateCity(index, city);
                }).finally(function () {
                    that.updateCities(index + 1);
                });
            } else {
                that.updateCities(index + 1);
            }
        };

        obj.loadTowns = function() {
            var that = this;

            that.towns = window.towns;
        };

        //endregion

        return obj;
    })
    .factory('WeatherUtil', function ($q, $http, Util) {
        var obj = {};

        //region Function

        /**
         * sun/moon/cloud + big/small cloud + rain + snow + lighting
         * @param {Number} sky 맑음(1) 구름조금(2) 구름많음(3) 흐림(4) , invalid : -1
         * @param {Number} pty 없음(0) 비(1) 비/눈(2) 눈(3), invalid : -1
         * @param {Number} lgt 없음(0) 있음(1), invalid : -1
         * @param {Boolean} isNight
         */
        function parseSkyState(sky, pty, lgt, isNight) {
            var skyIconName = "";

            if (isNight) {
                skyIconName = "Moon";
            }
            else {
                skyIconName = "Sun";
            }

            switch (sky) {
                case 1:
                    skyIconName += "";
                    break;
                case 2:
                    skyIconName += "SmallCloud";
                    break;
                case 3:
                    skyIconName += "BigCloud";
                    break;
                case 4:
                    skyIconName = "Cloud";
                    break;
                default:
                    console.log('Fail to parse sky='+sky);
                    break;
            }

            switch (pty) {
                case 0:
                    skyIconName += "";
                    break;
                case 1:
                    skyIconName += "Rain";
                    break;
                case 2:
                    skyIconName += "RainSnow";
                    break;
                case 3:
                    skyIconName += "Snow";
                    break;
                default:
                    console.log('Fail to parse pty='+pty);
                    break;
            }

            if (lgt === 1) {
                skyIconName += "Lightning";
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
            else {
                if (day < 0) {
                    return Math.abs(day)+"일 전";
                }
                else if (day > 0) {
                    return Math.abs(day)+"일 후";
                }
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
                return "Temp-10";
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
                    return "SunSmallCloud";
                    break;
                case "구름많음":
                    return "SunBigCloud";
                    break;
                case "흐림":
                    return "Cloud";
                    break;
                case "흐리고 한때 비":
                case "흐리고 비":
                    return "CloudRain";
                case "구름적고 한때 비":
                case "구름적고 비":
                    return "SunSmallCloudRain";
                case "구름많고 한때 비":
                case "구름많고 비":
                    return "SunBigCloudRain";
                    break;
                case "흐리고 한때 눈":
                case "흐리고 눈":
                    return "CloudSnow";
                case "구름적고 한때 눈":
                case "구름적고 눈":
                    return "SunSmallCloudSnow";
                case "구름많고 한때 눈":
                case "구름많고 눈":
                    return "SunBigCloudSnow";
                    break;
                case "구름적고 비/눈":
                case "구름적고 눈/비":
                    return "SunSmallCloudRainSnow";
                case "구름많고 비/눈":
                case "구름많고 눈/비":
                    return "SunBigCloudRainSnow";
                case "흐리고 비/눈":
                case "흐리고 눈/비":
                    return "CloudRainSnow";
            }

            console.log("Fail to convert skystring=" + skyInfo);
            return "";
        }

        function getHighPrioritySky(sky1, sky2) {

            if (sky1.indexOf("RainSnow") != -1) {
                return sky1;
            }
            if (sky2.indexOf("RainSnow") != -1) {
                return sky2;
            }

            if (sky1.indexOf("Rain") != -1 && sky2.indexOf("Snow") != -1) {
                return sky1 + "Snow";
            }

            if (sky1.indexOf("Snow") != -1 && sky2.indexOf("Rain") != -1) {
                return sky2 + "Snow";
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
                    var arrayStr = result.formatted_address.split(" ");
                    var secondLastChar = arrayStr[arrayStr.length-2].slice(-1);
                    if (secondLastChar === "시" || secondLastChar === "군" || secondLastChar === "구")  {
                        if(length < result.formatted_address.length) {
                            dongAddress = result.formatted_address;
                            length = result.formatted_address.length;
                        }
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
            var url = Util.url +'/town';

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
                    //console.log(data);
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
         * @param {Object} currentForecast
         * @param {Date} current
         * @param {Object[]} dailyInfoList midData.dailyData
         * @returns {{timeTable: Array, timeChart: Array}}
         */
        obj.parseShortTownWeather = function (shortForecastList, currentForecast, current, dailyInfoList) {
            var data = [];

            if (!shortForecastList || !Array.isArray(shortForecastList)) {
                return {timeTable: [], timeChart: []};
            }

            var currentIndex = -1;

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
                tempObject.time = time;
                tempObject.timeStr = time + "시";

                if (currentForecast.date == tempObject.date && currentForecast.time == tempObject.time) {
                    currentIndex = index-1;
                    shortForecastList[index].currentIndex = true;
                }
                else if (currentForecast.date == tempObject.date && currentForecast.time > tempObject.time) {
                    if (index == shortForecastList.length-1) {
                        currentIndex = index;
                        tempObject.currentIndex = true;
                    }
                    else {
                        var nextTime = parseInt(shortForecastList[index+1].time.slice(0, -2));
                        if (currentForecast.time < nextTime) {
                            currentIndex = index;
                            /**
                             * chart는 기준 index부터 뒤로 rect를 그리고, table은 기준값 기준으로 앞으로 데이터를 선정하기 때문에 선택된 index에 한칸으로 가야 함
                             */
                            shortForecastList[index+1].currentIndex = true;
                        }
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
                    currentIndex: currentIndex - 8
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

                data.fromToday = diffDays;
                data.fromTodayStr = getDayString(diffDays);
                data.week = dayToString(convertStringToDate(data.date).getDay());

                var skyAm = convertMidSkyString(dayInfo.wfAm);
                var skyPm = convertMidSkyString(dayInfo.wfPm);
                data.skyIcon = getHighPrioritySky(skyAm, skyPm);
                data.skyAm = skyAm;
                data.skyPm = skyPm;

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

            //console.log(tmpDayTable);
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
        obj._getShortSiDoName = function(name) {
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
                return that._getShortSiDoName(parsedAddress[2])+","+parsedAddress[4];
            }
            else if (parsedAddress.length === 4) {
                if (parsedAddress[1].slice(-1) === '도') {
                    //nation + do + si + gu
                    return that._getShortSiDoName(parsedAddress[2])+","+parsedAddress[3];
                }
                else {
                    //nation + si + gu + dong
                    return that._getShortSiDoName(parsedAddress[1])+","+parsedAddress[3];
                }
            }
            else if (parsedAddress.length === 3) {
                //nation + do + si
                //nation + si + gu
                //nation + si + eup,myeon
                return that._getShortSiDoName(parsedAddress[1])+","+parsedAddress[2];
            }
            else if (parsedAddress.length === 2) {
                //nation + si,do
                return that._getShortSiDoName(parsedAddress[1]);
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
                        return;
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
            //console.log(shortTownWeather);

            /**
             * @type {Array}
             */
            var midTownWeather = that.parseMidTownWeather(weatherData.midData, currentTime);
            //console.log(midTownWeather);

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

        return obj;
    })
    .factory('Util', function ($window, $cordovaGoogleAnalytics) {
        var obj = {};
        var debug = true;

        //region Function

        //endregion

        //region APIs

        obj.isDebug = function () {
            return debug;
        };

        obj.ga = {
            startTrackerWithId: function (id) {
                if (typeof $window.analytics !== "undefined") {
                    return $cordovaGoogleAnalytics.startTrackerWithId(id);
                }
            },
            setUserId: function (id) {
                if (typeof $window.analytics !== "undefined") {
                    return $cordovaGoogleAnalytics.setUserId(id);
                }
            },
            debugMode: function () {
                if (typeof $window.analytics !== "undefined") {
                    return $cordovaGoogleAnalytics.debugMode();
                }
            },
            trackView: function (screenName) {
                if (typeof $window.analytics !== "undefined") {
                    return $cordovaGoogleAnalytics.trackView(screenName);
                }
            },
            addCustomDimension: function (key, value) {
                if (typeof $window.analytics !== "undefined") {
                    return $cordovaGoogleAnalytics.addCustomDimension(key, value);
                }
            },
            trackEvent: function (category, action, label, value) {
                if (typeof $window.analytics !== "undefined") {
                    return $cordovaGoogleAnalytics.trackEvent(category, action, label, value);
                }
            },
            trackException: function (description, fatal) {
                if (typeof $window.analytics !== "undefined") {
                    return $cordovaGoogleAnalytics.trackException(description, fatal);
                }
            },
            trackTiming: function (category, milliseconds, variable, label) {
                if (typeof $window.analytics !== "undefined") {
                    return $cordovaGoogleAnalytics.trackTiming(category, milliseconds, variable, label);
                }
            },
            addTransaction: function (transactionId, affiliation, revenue, tax, shipping, currencyCode) {
                if (typeof $window.analytics !== "undefined") {
                    return $cordovaGoogleAnalytics.addTransaction(transactionId, affiliation, revenue, tax, shipping, currencyCode);
                }
            },
            addTransactionItem: function (transactionId, name, sku, category, price, quantity, currencyCode) {
                if (typeof $window.analytics !== "undefined") {
                    return $cordovaGoogleAnalytics.addTransactionItem(transactionId, name, sku, category, price, quantity, currencyCode);
                }
            }
        };

        //endregion

        obj.imgPath = 'img/weatherIcon2-color';
        obj.version = '0.8.6'; // sync with config.xml
        obj.guideVersion = 1.0;
        obj.admobIOSBannerAdUnit = '';
        obj.admobIOSInterstitialAdUnit = '';
        obj.admobAndroidBannerAdUnit = '';
        obj.admobAndroidInterstitialAdUnit = '';
        obj.googleSenderId = '';

        if (debug) {
            //obj.url = "./v000705";
            //obj.url = "http://todayweather-wizardfactory.rhcloud.com/v000705";
            obj.url = "http://tw-wzdfac.rhcloud.com/v000705";
        }
        else {
            obj.url = "http://todayweather.wizardfactory.net/v000705";
        }

        return obj;
    })
    .run(function(WeatherInfo) {
        WeatherInfo.loadCities();
        WeatherInfo.loadTowns();
        WeatherInfo.updateCities(0);
    });
