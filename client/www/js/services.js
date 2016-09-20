angular.module('starter.services', [])

    .factory('WeatherInfo', function ($rootScope, WeatherUtil, $ionicPlatform, Util) {
        var cities = [];
        var cityIndex = -1;
        var obj = {
            //towns: []
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
                //if (item.name) {
                //   city.name = item.name;
                //}
                //city.currentPosition = item.currentPosition;
                //city.address = item.address;
                //city.location = item.location;
                //city.currentWeather = item.currentWeather;
                //city.timeTable = item.timeTable;
                //city.timeChart = item.timeChart;
                //city.dayTable = item.dayTable;
                //city.dayChart = item.dayChart;
                city = item;
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
                city.loadTime = new Date();
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

        obj.updateCity = function (index, newCityInfo) {
            var that = this;
            var city = cities[index];

            if (newCityInfo.country) {
                city.country = newCityInfo.country;
            }
            if (newCityInfo.address) {
                city.address = newCityInfo.address;
            }
            if (newCityInfo.location) {
                city.location = newCityInfo.location;
            }
            if (newCityInfo.currentWeather) {
                city.currentWeather = newCityInfo.currentWeather;
            }
            if (newCityInfo.timeTable) {
                city.timeTable = newCityInfo.timeTable;
            }
            if (newCityInfo.timeChart) {
                city.timeChart = newCityInfo.timeChart;
            }
            if (newCityInfo.dayTable) {
                city.dayTable = newCityInfo.dayTable;
            }
            if (newCityInfo.dayChart) {
                city.dayChart = newCityInfo.dayChart;
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
                Util.ga.trackEvent('app', 'user', 'new');
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
                Util.ga.trackEvent('app', 'user', 'returning', that.getCityCount());
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
                    if (city.name) {
                        simpleInfo.name = city.name;
                    }
                    simpleInfo.currentPosition = city.currentPosition;
                    simpleInfo.address = city.address;
                    simpleInfo.location = city.location;
                    simpleInfo.name = city.name;
                    simpleInfo.country = city.country;
                    pList.cityList.push(simpleInfo);
                }
            });

            console.log('save preference plist='+JSON.stringify(pList));

            $ionicPlatform.ready(function() {
                if (window.plugins == undefined || plugins.appPreferences == undefined) {
                    console.log('appPreferences is undefined');
                    return;
                }

                var suitePrefs = plugins.appPreferences.iosSuite("group.net.wizardfactory.todayweather");
                suitePrefs.store('cityList', JSON.stringify(pList)).then(
                    function (value) {
                        console.log("save preference Success: " + value);
                    },
                    function (error) {
                        console.log("save preference Error: " + error);
                    }
                );
            });
        };

        obj._loadCitiesPreference = function (callback) {
            $ionicPlatform.ready(function() {
                if (window.plugins == undefined || plugins.appPreferences == undefined) {
                    console.log('appPreferences is undefined');
                    return;
                }

                /**
                 * android에서는 ios suite name과 상관없이 아래 이름으로 저장됨.
                 * net.wizardfactory.todayweather.widget.Provider.WidgetProvider
                 * @type {AppPreferences}
                 */
                var suitePrefs = plugins.appPreferences.iosSuite("group.net.wizardfactory.todayweather");
                suitePrefs.fetch('cityList').then(
                    function (value) {
                        console.log("fetch preference Success: " + value);
                        callback(undefined, value);
                    }, function (error) {
                        console.log("fetch preference Error: " + error);
                        callback(error);
                    }
                );
            });
        };

        obj.saveCities = function() {
            localStorage.setItem("cities", JSON.stringify(cities));
            this._saveCitiesPreference(cities);
        };

        //obj.loadTowns = function() {
        //    var that = this;
        //    that.towns = window.towns;
        //};

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

        function getGeoWeatherInfo (location) {
            var deferred = $q.defer();
            var url = Util.url +'/coordinates';
            url += "/" + location.lat + '/'+location.long;

            console.log(url);
            url = Util.url +'/town/'+encodeURIComponent('서울특별시');
            console.log("convert to "+url);

            $http({method: 'GET', url: url, timeout: 10*1000})
                .success(function (data) {
                    //console.log(data);
                    deferred.resolve({data: data});
                })
                .error(function (error) {
                    if (!error) {
                        error = new Error("Fail to get geo weatherInfo");
                    }
                    console.log(error);
                    deferred.reject(error);
                });

            return deferred.promise;
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
         * @returns {{timeTable: Array, timeChart: Array}}
         */
        obj.parseShortTownWeather = function (shortForecastList, currentForecast) {
            var data = [];

            if (!shortForecastList || !Array.isArray(shortForecastList)) {
                return {timeTable: [], timeChart: []};
            }

            var currentIndex = -1;
            var displayItemCount = 0;

            shortForecastList.every(function (shortForecast, index) {
                var tempObject;
                var time = parseInt(shortForecast.time.slice(0, -2));
                var diffDays = getDiffDays(convertStringToDate(shortForecast.date), convertStringToDate(currentForecast.date));
                var day = "";
                if (index === 0 || (shortForecastList[index-1].date !== shortForecast.date)) {
                    day = getDayString(diffDays);
                }
                var isNight = time < 7 || time > 18;

                tempObject = shortForecast;

                tempObject.skyIcon = parseSkyState(shortForecast.sky, shortForecast.pty, shortForecast.lgt, isNight);
                tempObject.day = day;
                tempObject.time = time;
                tempObject.timeStr = time + "시";

                if (currentForecast.date == tempObject.date && currentForecast.time == tempObject.time) {
                    currentIndex = index;
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
                else if (currentForecast.time < 3) {
                    if (currentForecast.date == tempObject.date && shortForecastList[index-1].date != currentForecast.date) {
                        shortForecastList[index-1].currentIndex = true;
                        currentIndex = index-1;
                    }
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
        };
        
        /**
         * 식중독, ultra 자외선,
         * @param midData
         * @param currentTime
         * @returns {Array}
         */
        obj.parseMidTownWeather = function (midData, currentTime) {
            var tmpDayTable = [];
            var displayItemCount = 0;

            if (!midData || !midData.hasOwnProperty('dailyData') || !Array.isArray(midData.dailyData)) {
                return {displayItemCount: displayItemCount, dayTable: tmpDayTable};
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
            return {displayItemCount: displayItemCount, dayTable: tmpDayTable};
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

        obj.getGeoCodeFromGoogle = function (address) {
            var deferred = $q.defer();
            var url = "https://maps.googleapis.com/maps/api/geocode/json?address=" + address;

            $http({method: 'GET', url: url, timeout: 3000}).success(function (data) {
                if (data.status === 'OK') {
                    try {
                        var location = findLocationFromGoogleGeoCodeResults(data.results);
                        //"KR"
                        var country = data.results[0].address_components[data.results[0].address_components.length-1].short_name;
                        var address = data.results[0].formatted_address;
                        console.log(location);
                        deferred.resolve({location: location, country: country, address: address});
                    }
                    catch (e) {
                        deferred.reject(e);
                    }

                }
                else {
                    //'ZERO_RESULTS', 'OVER_QUERY_LIMIT', 'REQUEST_DENIED',  'INVALID_REQUEST', 'UNKNOWN_ERROR'
                    deferred.reject(new Error(data.status));
                }
            }).error(function (err) {
                deferred.reject(err);
            });

            return deferred.promise;
        };

        //obj.getGeoCodeFromGoogle = getGeoCodeFromGoogle;

        /**
         *
         * @param {String} address
         */
        //obj.getAddressToGeolocation = function (address) {
        //    var deferred = $q.defer();
        //
        //    getGeoCodeFromDaum(address).then(function(location) {
        //
        //        console.log(location);
        //        deferred.resolve(location);
        //    }, function (err) {
        //
        //        console.log(err);
        //        getGeoCodeFromGoogle(address).then(function (location) {
        //            console.log(location);
        //            deferred.resolve(location);
        //        }, function (err) {
        //            console.log(err);
        //            deferred.reject(err);
        //        });
        //    });
        //
        //    return deferred.promise;
        //};

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

        function getGeoInfoFromGoogle(lat, lng) {
            var deferred = $q.defer();
            var url = "https://maps.googleapis.com/maps/api/geocode/json?latlng=" + lat + "," + lng;

            $http({method: 'GET', url: url, timeout: 3000}).success(function (data) {
                if (data.status === "OK") {
                    var result;
                    for (var i=0; i < data.results.length; i++) {
                        if (data.results[i].types[0] == "postal_code") {
                            result = data.results[i];
                            break;
                        }
                    }
                    var address = result.formatted_address;
                    if (!address || address.length === 0) {
                        deferred.reject(new Error("Fail to find formatted_address from " + data.results[0].formatted_address));
                        return;
                    }
                    var country = result.address_components[result.address_components.length-1].short_name;
                    console.log(address);
                    deferred.resolve({country: country, address: address});
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

        function getAddressFromGoogle(lat, lng) {
            var deferred = $q.defer();
            var url = "https://maps.googleapis.com/maps/api/geocode/json?latlng=" + lat + "," + lng;

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

        obj.getGeoInfoFromGeolocation = function (lat, long) {
            var deferred = $q.defer();
            var startTime = new Date().getTime();
            var endTime;
            //check kr by mCoord

            getGeoInfoFromGoogle(lat, long).then(function (geoInfo) {
                console.log(geoInfo);
                endTime = new Date().getTime();
                Util.ga.trackTiming('data', endTime - startTime, 'get', 'google address');
                Util.ga.trackEvent('data', 'get', 'google address', endTime - startTime);

                deferred.resolve(geoInfo);
            }, function () {
                endTime = new Date().getTime();
                Util.ga.trackTiming('data error', endTime - startTime, 'get', 'google address');
                Util.ga.trackEvent('data error', 'get', 'google address', endTime - startTime);

                deferred.reject(err);
            });
            return deferred.promise;
        };

        /**
         * related to #380
         * @param {Number} lat
         * @param {Number} long
         */
        obj.getAddressFromGeolocation = function (lat, long) {
            var deferred = $q.defer();
            var startTime = new Date().getTime();
            var endTime;

            getAddressFromDaum(lat, long).then(function(address) {
                console.log(address);
                endTime = new Date().getTime();
                Util.ga.trackTiming('data', endTime - startTime, 'get', 'daum address');
                Util.ga.trackEvent('data', 'get', 'daum address', endTime - startTime);

                deferred.resolve({country : "KR", address : address});
            }, function (err) {
                console.log(err);
                endTime = new Date().getTime();
                Util.ga.trackTiming('data error', endTime - startTime, 'get', 'daum address');
                Util.ga.trackEvent('data error', 'get', 'daum address', endTime - startTime);

                startTime = new Date().getTime();
                getAddressFromGoogle(lat, long).then(function (address) {
                    console.log(address);
                    endTime = new Date().getTime();
                    Util.ga.trackTiming('data', endTime - startTime, 'get', 'google address');
                    Util.ga.trackEvent('data', 'get', 'google address', endTime - startTime);

                    deferred.resolve(address);
                }, function (err) {
                    endTime = new Date().getTime();
                    Util.ga.trackTiming('data error', endTime - startTime, 'get', 'google address');
                    Util.ga.trackEvent('data error', 'get', 'google address', endTime - startTime);

                    deferred.reject(err);
                });
            });

            return deferred.promise;
        };

        obj.getCurrentPosition = function () {
            var deferred = $q.defer();

            ionic.Platform.ready(function() {
                var startTime = new Date().getTime();
                var endTime;
                navigator.geolocation.getCurrentPosition(function (position) {
                    //경기도,광주시,오포읍,37.36340556,127.2307667
                    //deferred.resolve({latitude: 37.363, longitude: 127.230});
                    //세종특별자치시,세종특별자치시,연기면,36.517338,127.259247
                    //37.472595, 126.795249
                    //경상남도/거제시옥포2동 "lng":128.6875, "lat":34.8966
                    //deferred.resolve({latitude: 34.8966, longitude: 128.6875});
                    //서울특별시
                    //deferred.resolve({latitude: 37.5635694, longitude: 126.9800083});

                    endTime = new Date().getTime();
                    Util.ga.trackTiming('data', endTime - startTime, 'get', 'position');
                    Util.ga.trackEvent('data', 'get', 'position', endTime - startTime);

                    deferred.resolve(position.coords);
                }, function (error) {
                    console.log("Fail to get current position from navigator");
                    console.log(error.message);
                    endTime = new Date().getTime();
                    Util.ga.trackTiming('data error', endTime - startTime, 'get', 'position');
                    Util.ga.trackEvent('data error', 'get', 'position', endTime - startTime);

                    if (ionic.Platform.isAndroid() && window.cordova) {
                        var orgGeo = cordova.require('cordova/modulemapper').getOriginalSymbol(window, 'navigator.geolocation');

                        startTime = new Date().getTime();
                        orgGeo.getCurrentPosition(function (position) {
                                //console.log('native geolocation');
                                //console.log(position);

                                endTime = new Date().getTime();
                                Util.ga.trackTiming('data', endTime - startTime, 'get', 'native position');
                                Util.ga.trackEvent('data', 'get', 'native position', endTime - startTime);

                                deferred.resolve(position.coords);
                            },
                            function (error) {
                                console.log("Fail to get current position from native");
                                console.log(error.message);
                                endTime = new Date().getTime();
                                Util.ga.trackTiming('data error', endTime - startTime, 'get', 'native position');
                                Util.ga.trackEvent('data error', 'get', 'native position', endTime - startTime);

                                deferred.reject();
                            }, {timeout: 5000});
                    }
                    else {
                        deferred.reject();
                    }
                }, {maximumAge: 3000, timeout: 3000});
            });

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

            if (towns) {
                var town = towns.filter(function (town) {
                    return !!(town.first === townAddress.first && town.second === townAddress.second
                    && town.third === townAddress.third);
                })[0];

                if (town === undefined) {
                    var deferred = $q.defer();
                    deferred.reject("address is empty");
                    return deferred.promise;
                }
            }
            else {
                town = townAddress;
            }

            var promises = [];
            promises.push(getTownWeatherInfo(town));

            return $q.all(promises);
        };

        /**
         *
         * @param {country, address, location}
         * @returns {Promise}
         */
        obj.getWorldWeatherInfo = function (geoInfo) {
            var promises = [];
            var that = this;

            if (geoInfo.country === "KR") {
                var addressArray = that.convertAddressArray(geoInfo.address);
                var town = that.getTownFromFullAddress(addressArray);
                promises.push(getTownWeatherInfo(town));
            }
            else {
                var location = obj.geolocationNormalize(geoInfo.location);
                promises.push(getGeoWeatherInfo(location));
            }

            return $q.all(promises);
        };

        /**
         *
         * @param weatherData
         * @returns {{}}
         */
        obj.convertWeatherData = function (weatherData) {
            var that = this;
            var data = {};
            var currentTime = new Date();
            weatherData.forEach(function (data) {
                if (data.hasOwnProperty("data")) {
                    weatherData = data.data;
                }
            });

            var currentForecast = that.parseCurrentTownWeather(weatherData.current);

            /**
             * @type {{name, value}|{timeTable, timeChart}|{timeTable: Array, timeChart: Array}}
             */
            var shortTownWeather = that.parseShortTownWeather(weatherData.short, currentForecast);
            //console.log(shortTownWeather);

            /**
             * @type {Array}
             */
            var midTownWeather = that.parseMidTownWeather(weatherData.midData, currentTime);
            //console.log(midTownWeather);

            data.currentWeather = currentForecast;
            data.timeTable = shortTownWeather.timeTable;
            data.timeChart = shortTownWeather.timeChart;
            data.dayTable = midTownWeather.dayTable;
            data.dayChart = [{
                values: midTownWeather.dayTable,
                temp: currentForecast.t1h,
                displayItemCount: midTownWeather.displayItemCount
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

        obj.geolocationNormalize = function (coords) {
            var baseLength = 0.25;
            var lat = coords.lat;
            var lon = coords.long;
            console.log (lat + " " + lon);

            var normal_lat = lat - (lat%baseLength) + baseLength/2;
            var normal_lon = lon - (lon%baseLength) + baseLength/2;
            return {lat: normal_lat, long: normal_lon};
        };

        return obj;
    })
    .factory('Util', function ($window) {
        var obj = {};
        var debug = true;
        var gaArray = [];

        //region Function

        //endregion

        //region APIs

        obj.isDebug = function () {
            return debug;
        };

        obj.ga = {
            startTrackerWithId: function (id) {
                if (typeof $window.analytics !== "undefined") {
                    return $window.analytics.startTrackerWithId(id, function(result) {
                        console.log("startTrackerWithId success = " + result);
                    }, function(error) {
                        console.log("startTrackerWithId error = " + error);
                    });
                }
            },
            setAllowIDFACollection: function (enable) {
                if (typeof $window.analytics !== "undefined") {
                    return $window.analytics.setAllowIDFACollection(enable, function(result) {
                        console.log("setAllowIDFACollection success = " + result);
                    }, function(error) {
                        console.log("setAllowIDFACollection error = " + error);
                    });
                }
            },
            setUserId: function (id) {
                if (typeof $window.analytics !== "undefined") {
                    return $window.analytics.setUserId(id, function(result) {
                        console.log("setUserId success = " + result);
                    }, function(error) {
                        console.log("setUserId error = " + error);
                    });
                }
            },
            setAnonymizeIp: function (anonymize) {
                if (typeof $window.analytics !== "undefined") {
                    return $window.analytics.setAnonymizeIp(anonymize, function(result) {
                        console.log("setAnonymizeIp success = " + result);
                    }, function(error) {
                        console.log("setAnonymizeIp error = " + error);
                    });
                }
            },
            setAppVersion: function (version) {
                if (typeof $window.analytics !== "undefined") {
                    return $window.analytics.setAppVersion(version, function(result) {
                        console.log("setAppVersion success = " + result);
                    }, function(error) {
                        console.log("setAppVersion error = " + error);
                    });
                }
            },
            debugMode: function () {
                if (typeof $window.analytics !== "undefined") {
                    return $window.analytics.debugMode(function(result) {
                        console.log("debugMode success = " + result);
                    }, function(error) {
                        console.log("debugMode error = " + error);
                    });
                }
            },
            trackMetric: function (key, value) {
                if (typeof $window.analytics !== "undefined") {
                    return $window.analytics.trackMetric(key, value, function(result) {
                        console.log("trackMetric success = " + result);
                    }, function(error) {
                        console.log("trackMetric error = " + error);
                    });
                }
            },
            trackView: function (screenName, campaingUrl) {
                if (typeof $window.analytics !== "undefined") {
                    return $window.analytics.trackView(screenName, campaingUrl, function(result) {
                        console.log("trackView success = " + result);
                    }, function(error) {
                        console.log("trackView error = " + error);
                        gaArray.push(["trackView", screenName, campaingUrl]);
                    });
                } else {
                    console.log("trackView undefined");
                    gaArray.push(["trackView", screenName, campaingUrl]);
                }
            },
            addCustomDimension: function (key, value) {
                if (typeof $window.analytics !== "undefined") {
                    return $window.analytics.addCustomDimension(key, value, function(result) {
                        console.log("addCustomDimension success = " + result);
                    }, function(error) {
                        console.log("addCustomDimension error = " + error);
                    });
                }
            },
            trackEvent: function (category, action, label, value) {
                if (typeof $window.analytics !== "undefined") {
                    return $window.analytics.trackEvent(category, action, label, value, function(result) {
                        console.log("trackEvent success = " + result);
                    }, function(error) {
                        console.log("trackEvent error = " + error);
                        gaArray.push(["trackEvent", category, action, label, value]);
                    });
                } else {
                    console.log("trackEvent undefined");
                    gaArray.push(["trackEvent", category, action, label, value]);
                }
            },
            trackException: function (description, fatal) {
                if (typeof $window.analytics !== "undefined") {
                    return $window.analytics.trackException(description, fatal, function(result) {
                        console.log("trackException success = " + result);
                    }, function(error) {
                        console.log("trackException error = " + error);
                        gaArray.push(["trackException", description, fatal]);
                    });
                } else {
                    console.log("trackException undefined");
                    gaArray.push(["trackException", description, fatal]);
                }
            },
            trackTiming: function (category, milliseconds, variable, label) {
                if (typeof $window.analytics !== "undefined") {
                    return $window.analytics.trackTiming(category, milliseconds, variable, label, function(result) {
                        console.log("trackTiming success = " + result);
                    }, function(error) {
                        console.log("trackTiming error = " + error);
                    });
                }
            },
            addTransaction: function (transactionId, affiliation, revenue, tax, shipping, currencyCode) {
                if (typeof $window.analytics !== "undefined") {
                    return $window.analytics.addTransaction(transactionId, affiliation, revenue, tax, shipping, currencyCode, function(result) {
                        console.log("addTransaction success = " + result);
                    }, function(error) {
                        console.log("addTransaction error = " + error);
                    });
                }
            },
            addTransactionItem: function (transactionId, name, sku, category, price, quantity, currencyCode) {
                if (typeof $window.analytics !== "undefined") {
                    return $window.analytics.addTransactionItem(transactionId, name, sku, category, price, quantity, currencyCode, function(result) {
                        console.log("addTransactionItem success = " + result);
                    }, function(error) {
                        console.log("addTransactionItem error = " + error);
                    });
                }
            },
            enableUncaughtExceptionReporting: function (enable) {
                if (typeof $window.analytics !== "undefined") {
                    return $window.analytics.enableUncaughtExceptionReporting(enable, function(result) {
                        console.log("enableUncaughtExceptionReporting success = " + result);
                    }, function(error) {
                        console.log("enableUncaughtExceptionReporting error = " + error);
                    });
                }
            },
            platformReady: function() {
                if (typeof $window.analytics !== "undefined") {
                    for (var i = 0; i < gaArray.length; i++) {
                        if (gaArray[i][0] === "trackView") {
                            this.trackView(gaArray[i][1]);
                        } else if (gaArray[i][0] === "trackEvent") {
                            this.trackEvent(gaArray[i][1], gaArray[i][2], gaArray[i][3], gaArray[i][4]);
                        }
                    }
                }
                gaArray = [];
            }
        };

        //endregion

        obj.imgPath = 'img/weatherIcon2-color';
        obj.version = '';
        obj.guideVersion = 1.0;
        obj.admobIOSBannerAdUnit = '';
        obj.admobIOSInterstitialAdUnit = '';
        obj.admobAndroidBannerAdUnit = '';
        obj.admobAndroidInterstitialAdUnit = '';
        obj.googleSenderId = '';

        if (debug) {
            //obj.url = "/v000705";
            //obj.url = "http://todayweather-wizardfactory.rhcloud.com/v000705";
            obj.url = "http://tw-wzdfac.rhcloud.com/v000705";
        }
        else {
            obj.url = "http://todayweather.wizardfactory.net/v000705";
        }

        return obj;
    })
    .run(function($rootScope, $ionicPlatform, WeatherInfo, Util) {
        WeatherInfo.loadCities();
        //WeatherInfo.loadTowns();
        $ionicPlatform.on('resume', function(){
            if (WeatherInfo.canLoadCity(WeatherInfo.getCityIndex()) === true) {
                $rootScope.$broadcast('reloadEvent', 'resume');
            }
        });
        $ionicPlatform.ready(function() {
            console.log("UA:"+ionic.Platform.ua);
            console.log("Height:" + window.innerHeight + ", Width:" + window.innerWidth + ", PixelRatio:" + window.devicePixelRatio);
            console.log("OuterHeight:" + window.outerHeight + ", OuterWidth:" + window.outerWidth);
            console.log("ScreenHeight:"+window.screen.height+", ScreenWidth:"+window.screen.width);

            if (window.cordova && cordova.getAppVersion) {
                cordova.getAppVersion.getVersionNumber().then(function (version) {
                    Util.version = version;
                });
            }

        });

    });
