angular.module('starter.services', [])

    .factory('WeatherInfo', function ($rootScope, WeatherUtil, $ionicPlatform, Util) {
        var cities = [];
        var cityIndex = -1;
        var obj = {
            towns: []
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
            if (index === -1) {
                return false;
            }

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
            else if (cityIndex >= cities.length) {
                console.log('city index is over');
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

            if (window.plugins == undefined || plugins.appPreferences == undefined) {
                console.log('appPreferences is undefined');
                return;
            }

            var suitePrefs = plugins.appPreferences.suite(Util.suiteName);
            suitePrefs.store(function (value) {
                console.log("save preference Success: " + value);
            }, function (error) {
                console.log("save preference Error: " + error);
            }, 'cityList', JSON.stringify(pList));
        };

        obj._loadCitiesPreference = function (callback) {
            if (window.plugins == undefined || plugins.appPreferences == undefined) {
                console.log('appPreferences is undefined');
                return;
            }

            var suitePrefs = plugins.appPreferences.suite(Util.suiteName);
            suitePrefs.fetch(function (value) {
                console.log("fetch preference Success: " + value);
                callback(undefined, value);
            }, function (error) {
                console.log("fetch preference Error: " + error);
                callback(error);
            }, 'cityList');
        };

        obj.saveCities = function() {
            localStorage.setItem("cities", JSON.stringify(cities));
            this._saveCitiesPreference(cities);
        };

        obj.loadTowns = function() {
            var that = this;

            that.towns = window.towns;
        };

        //endregion

        return obj;
    })
    .factory('WeatherUtil', function ($q, $http, Util, $translate) {
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

        function _retryGetHttp(retryCount, url, callback) {
            var retryTimeId = setTimeout(function () {
                retryCount--;
                if (retryCount > 0) {
                    _retryGetHttp(retryCount, url, callback);
                }
            }, 2*1000);

            console.log("retry="+retryCount+" get http");
            $http({method: 'GET', url: url, timeout: 10*1000})
                .success(function (data, status, headers, config, statusText) {
                    console.log("status="+status);
                    clearTimeout(retryTimeId);
                    console.log('clear timeout = '+ retryTimeId);
                    callback(undefined, data);
                })
                .error(function (data, status, headers, config, statusText) {
                    if (!data) {
                        data = data | "Fail to get weatherInfo";
                    }
                    console.log(status +":"+data);
                    console.log('clear timeout = '+ retryTimeId);
                    clearTimeout(retryTimeId);
                    var error = new Error(data);
                    error.code = status;
                    callback(error);
                });
        }

        function getTownWeatherInfo (town) {
            var deferred = $q.defer();
            var url = twClientConfig.serverUrl +'/town';

            url += "/" + town.first;
            if (town.second) {
                url += "/" + town.second;
            }
            if (town.third) {
                url += "/" + town.third;
            }
            console.log(url);

            _retryGetHttp(5, url, function (error, data) {
                if (error != undefined) {
                    return deferred.reject(error);
                }
                deferred.resolve({data: data});
            });

            return deferred.promise;
        }
        //endregion

        //region APIs
        var strSameAsYesterday;
        var strThanYesterday;
        $translate(['LOC_SAME_AS_YESTERDAY', 'LOC_THAN_YESTERDAY']).then(function (translations) {
           strSameAsYesterday = translations.LOC_SAME_AS_YESTERDAY;
            strThanYesterday = translations.LOC_THAN_YESTERDAY;
        }, function (translationIds) {
            strSameAsYesterday = translationIds.LOC_SAME_AS_YESTERDAY;
            strThanYesterday = translationIds.LOC_THAN_YESTERDAY;
        });

        function _diffTempStr(current, yesterday) {
            var str = "";

            if (current.t1h !== undefined && yesterday && yesterday.t1h !== undefined) {
                var diffTemp = Math.round(current.t1h) - Math.round(yesterday.t1h);
                if (diffTemp == 0) {
                    str += strSameAsYesterday;
                }
                else {
                    var tempStr;
                    if (diffTemp > 0) {
                        tempStr = '+' + diffTemp;
                    }
                    else {
                        tempStr = '' + diffTemp;
                    }
                    str += sprintf(strThanYesterday, tempStr);
                }
            }
            return str;
        }

        //Most cloudy, Partly cloud, Clear, Sunnay, Cloud, PM10, PM2.5, AQI, Discomfort feelslike, UV, wind, food posioning
        var translations;
        $translate([
            'LOC_MOSTLY_CLOUDY', 'LOC_PARTLY_CLOUDY', 'LOC_CLEAR', 'LOC_SUNNY', 'LOC_CLOUDY', 'LOC_PM10',
            'LOC_PM25', 'LOC_AQI', 'LOC_DISCOMFORT_INDEX', 'LOC_FEELS_LIKE', 'LOC_UV', 'LOC_WIND',
            'LOC_FOOD_POISONING'
        ]).then(function (trans) {
            translations = trans;
        }, function (translationIds) {
            translations = translationIds;
        });

        function _makeSummary(current, yesterday) {
            var str = "";
            var item;
            var itemList = [];
            var diffTemp;
            var tmpGrade;

            if (current.t1h !== undefined && yesterday && yesterday.t1h !== undefined) {
                diffTemp = Math.round(current.t1h) - Math.round(yesterday.t1h);
                str = current.diffTempStr;
                item = {str: str, grade: Math.abs(diffTemp)};
                itemList.push(item);
            }

            //weather를 type이나, 대치값이 필요.
            if (current.weather) {
                if(current.weather == translations.LOC_MOSTLY_CLOUDY ||
                    current.weather == translations.LOC_PARTLY_CLOUDY ||
                    current.weather == translations.LOC_CLEAR ||
                    current.weather == translations.LOC_SUNNY ||
                    current.weather == translations.LOC_CLOUDY) {
                    //skip
                    item = {str: current.weather, grade: 1};
                }
                else {
                    item = {str: current.weather, grade: 3};
                }
                itemList.push(item);
            }

            if (current.arpltn) {

                if (current.arpltn.pm10Grade && current.arpltn.pm10Str) {
                    tmpGrade = current.arpltn.pm10Grade;
                    str = translations.LOC_PM10 + " " + current.arpltn.pm10Str;
                    item = {str: str, grade: tmpGrade};
                    itemList.push(item);
                }
                if (current.arpltn.pm25Grade && current.arpltn.pm25Str) {
                    tmpGrade = current.arpltn.pm25Grade;
                    str = translations.LOC_PM25 + " " + current.arpltn.pm25Str;
                    item = {str: str, grade: tmpGrade};
                    itemList.push(item);
                }
                if (current.arpltn.khaiGrade && current.arpltn.khaiStr) {
                    tmpGrade = current.arpltn.khaiGrade;
                    str = translations.LOC_AQI + " " + current.arpltn.khaiStr;
                    item = {str: str, grade: tmpGrade};
                    itemList.push(item);
                }
            }
            if (current.rn1 && current.rn1Str && current.ptyStr) {
                item = {str: current.ptyStr + " " + current.rn1Str, grade: current.rn1+3};
                itemList.push(item);
            }

            if (current.dsplsGrade && current.dsplsGrade && current.t1h >= 20) {
                tmpGrade = current.dsplsGrade;
                str = translations.LOC_DISCOMFORT_INDEX + " " + current.dsplsStr;
                item = {str:str, grade: tmpGrade};
                itemList.push(item);
            }

            if (current.sensorytem && current.sensorytem !== current.t1h) {
                diffTemp = Math.round(current.sensorytem - current.t1h);
                str = translations.LOC_FEELS_LIKE + " " + current.sensorytem +"˚";
                item = {str :str, grade: Math.abs(diffTemp)};
                itemList.push(item);
            }

            if (current.ultrvGrade && Number(current.time) < 1800) {
                tmpGrade = current.ultrvGrade;
                str = translations.LOC_UV + " " + current.ultrvStr;
                item = {str: str, grade: tmpGrade+1};
                itemList.push(item);
            }

            if (current.wsdGrade) {
                str = translations.LOC_WIND + " " + current.wsd + "m/s";
                item = {str:str, grade: current.wsdGrade+1};
                itemList.push(item);
            }

            if (current.fsnStr) {
                str = translations.LOC_FOOD_POISONING + " " + current.fsnStr;
                item = {str: str, grade: current.fsnGrade+1};
                itemList.push(item);
            }

            //감기

            itemList.sort(function (a, b) {
                if(a.grade > b.grade){
                    return -1;
                }
                if(a.grade < b.grade){
                    return 1;
                }
                return 0;
            });

            console.log(JSON.stringify(itemList));

            return itemList[0].str+", "+itemList[1].str;
        }

        var airGradeStr = [];
        $translate(['LOC_GOOD', 'LOC_MODERATE', 'LOC_UNHEALTHY_FOR_SENSITIVE_GROUPS', 'LOC_UNHEALTHY', 'LOC_VERY_UNHEALTHY', 'LOC_HAZARDOUS']).then(function (translations) {
            airGradeStr.push(translations.LOC_GOOD);
            airGradeStr.push(translations.LOC_MODERATE);
            airGradeStr.push(translations.LOC_UNHEALTHY_FOR_SENSITIVE_GROUPS);
            airGradeStr.push(translations.LOC_UNHEALTHY);
            airGradeStr.push(translations.LOC_VERY_UNHEALTHY);
            airGradeStr.push(translations.LOC_HAZARDOUS);
        }, function (translationIds) {
            airGradeStr.push(translationIds.LOC_GOOD);
            airGradeStr.push(translationIds.LOC_MODERATE);
            airGradeStr.push(translationIds.LOC_UNHEALTHY_FOR_SENSITIVE_GROUPS);
            airGradeStr.push(translationIds.LOC_UNHEALTHY);
            airGradeStr.push(translationIds.LOC_VERY_UNHEALTHY);
            airGradeStr.push(translationIds.LOC_HAZARDOUS);
        });

        function _getSentimentStr(grade) {
            if (grade >= 3) {
                grade++;
            }
            return airGradeStr[grade-1];
        }

        function _makeStrOfAqiGrade(arpltn) {
            if (arpltn.pm10Grade) {
                arpltn.pm10Str = _getSentimentStr(arpltn.pm10Grade);
            }
            if (arpltn.pm25Grade) {
                arpltn.pm25Str = _getSentimentStr(arpltn.pm25Grade);
            }
            if (arpltn.o3Grade) {
                arpltn.o3Str = _getSentimentStr(arpltn.o3Grade);
            }
            if (arpltn.no2Grade) {
                arpltn.no2Str = _getSentimentStr(arpltn.no2Grade);
            }
            if (arpltn.coGrade) {
                arpltn.coStr = _getSentimentStr(arpltn.coGrade);
            }
            if (arpltn.so2Grade) {
                arpltn.so2Str = _getSentimentStr(arpltn.so2Grade);
            }
            if (arpltn.khaiGrade) {
                arpltn.khaiStr = _getSentimentStr(arpltn.khaiGrade);
            }
        }

        var fsnGradeStr = [];
        $translate(['LOC_ATTENTION', 'LOC_CAUTION', 'LOC_WARNING', 'LOC_HAZARD']).then(function (translations) {
            fsnGradeStr.push(translations.LOC_ATTENTION) ;
            fsnGradeStr.push(translations.LOC_CAUTION) ;
            fsnGradeStr.push(translations.LOC_WARNING) ;
            fsnGradeStr.push(translations.LOC_HAZARD) ;
        }, function (translationIds) {
            fsnGradeStr.push(translationIds.LOC_ATTENTION) ;
            fsnGradeStr.push(translationIds.LOC_CAUTION) ;
            fsnGradeStr.push(translationIds.LOC_WARNING) ;
            fsnGradeStr.push(translationIds.LOC_HAZARD) ;
        });

        var lowHighGradeStr = [];
        $translate(['LOC_LOW', 'LOC_NORMAL', 'LOC_HIGH', 'LOC_VERY_HIGH', 'LOC_HAZARD']).then(function (translations) {
            lowHighGradeStr.push(translations.LOC_LOW) ;
            lowHighGradeStr.push(translations.LOC_NORMAL) ;
            lowHighGradeStr.push(translations.LOC_HIGH) ;
            lowHighGradeStr.push(translations.LOC_VERY_HIGH) ;
            lowHighGradeStr.push(translations.LOC_HAZARD) ;
        }, function (translationIds) {
            lowHighGradeStr.push(translationIds.LOC_LOW) ;
            lowHighGradeStr.push(translationIds.LOC_NORMAL) ;
            lowHighGradeStr.push(translationIds.LOC_HIGH) ;
            lowHighGradeStr.push(translationIds.LOC_VERY_HIGH) ;
            lowHighGradeStr.push(translationIds.LOC_HAZARD) ;
        });

        var lowHighGradeStr = [];
        $translate(['LOC_LOW', 'LOC_NORMAL', 'LOC_HIGH', 'LOC_VERY_HIGH', 'LOC_HAZARD']).then(function (translations) {
            lowHighGradeStr.push(translations.LOC_LOW) ;
            lowHighGradeStr.push(translations.LOC_NORMAL) ;
            lowHighGradeStr.push(translations.LOC_HIGH) ;
            lowHighGradeStr.push(translations.LOC_VERY_HIGH) ;
            lowHighGradeStr.push(translations.LOC_HAZARD) ;
        }, function (translationIds) {
            lowHighGradeStr.push(translationIds.LOC_LOW) ;
            lowHighGradeStr.push(translationIds.LOC_NORMAL) ;
            lowHighGradeStr.push(translationIds.LOC_HIGH) ;
            lowHighGradeStr.push(translationIds.LOC_VERY_HIGH) ;
            lowHighGradeStr.push(translationIds.LOC_HAZARD) ;
        });

        var ptyStr = [];
        $translate(['LOC_RAINFALL', 'LOC_SNOWFALL']).then(function (translations) {
            ptyStr.push(translations.LOC_RAINFALL);
            ptyStr.push(translations.LOC_SNOWFALL);
        }, function (translationIds) {
            ptyStr.push(translationIds.LOC_RAINFALL);
            ptyStr.push(translationIds.LOC_SNOWFALL);
        });

        function _convertKmaPtyToStr(pty) {
            if (pty === 1) {
                return ptyStr[0];
            }
            else if (pty === 2) {
                //return "강수/적설량"
                return ptyStr[0];
            }
            else if (pty === 3) {
                return ptyStr[1];
            }

            return "";
        }

        function _convertKmaRxxToStr(pty, rXX) {
            var str = "~"+rXX;
            if (pty === 1 || pty === 2) {
                str += "mm";
            }
            else if (pty === 3) {
                str += "cm";
            }
            else {
               return "";
            }
            return str;
        }

        var weatherTypeStr = [];
        $translate(['LOC_CLEAR', 'LOC_PARTLY_CLOUDY', 'LOC_MOSTLY_CLOUDY', 'LOC_CLOUDY', 'LOC_MIST', 'LOC_HAZE',
        'LOC_FOG', 'LOC_THIN_FOG', 'LOC_DENSE_FOG', 'LOC_FOG_STOPPED', 'LOC_PARTLY_FOG', 'LOC_YELLOW_DUST',
        'LOC_LIGHT_DRIZZLE', 'LOC_DRIZZLE', 'LOC_HEAVY_DRIZZLE', 'LOC_DRIZZLE_STOPPED', 'LOC_LIGHT_RAIN_AT_TIMES',
        'LOC_LIGHT_RAIN', 'LOC_HEAVY_RAIN_AT_TIMES', 'LOC_HEAVY_RAIN', 'LOC_LIGHT_SHOWERS', 'LOC_SHOWERS',
        'LOC_HEAVY_SHOWERS', 'LOC_SHOWERS_STOPPED', 'LOC_RAIN', 'LOC_RAIN_AT_TIMES', 'LOC_RAIN_STOPPED',
        'LOC_LIGHT_SLEET', 'LOC_HEAVY_SLEET', 'LOC_SLEET_STOPPED', 'LOC_LIGHT_SNOW_AT_TIMES', 'LOC_LIGHT_SNOW',
        'LOC_SNOW_AT_TIMES', 'LOC_SNOW', 'LOC_HEAVY_SNOW_AT_TIMES', 'LOC_HEAVY_SNOW', 'LOC_LIGHT_SNOW_SHOWERS',
        'LOC_HEAVY_SNOW_SHOWERS', 'LOC_SNOW_SHOWERS_STOPPED', 'LOC_SNOW_STOPPED', 'LOC_LIGHT_SNOW_PELLETS',
        'LOC_HEAVY_SNOW_PELLETS', 'LOC_LIGHT_SNOW_STORM', 'LOC_SNOW_STORM', 'LOC_HEAVY_SNOW_STORM', 'LOC_POWDER_SNOW',
        'LOC_WATER_SPOUT', 'LOC_HAIL', 'LOC_THUNDERSHOWERS', 'LOC_THUNDERSHOWERS_STOPPED_RAIN',
        'LOC_THUNDERSHOWERS_STOPPED_SNOW', 'LOC_THUNDERSHOWERS_HAIL', 'LOC_THUNDERSHOWERS_RAIN_SNOW', 'LOC_LIGHTNING',
        'LOC_BOLT_FROM_THE_BLUE', 'LOC_BOLT_STOPPED']).then(function (translations) {
            weatherTypeStr.push(translations.LOC_CLEAR);
            weatherTypeStr.push(translations.LOC_PARTLY_CLOUDY);
            weatherTypeStr.push(translations.LOC_MOSTLY_CLOUDY);
            weatherTypeStr.push(translations.LOC_CLOUDY);
            weatherTypeStr.push(translations.LOC_MIST);
            weatherTypeStr.push(translations.LOC_HAZE);
            weatherTypeStr.push(translations.LOC_FOG); //안개변화무
            weatherTypeStr.push(translations.LOC_THIN_FOG);
            weatherTypeStr.push(translations.LOC_DENSE_FOG);
            weatherTypeStr.push(translations.LOC_FOG_STOPPED);

            weatherTypeStr.push(translations.LOC_FOG); //시계내안개
            weatherTypeStr.push(translations.LOC_PARTLY_FOG);
            weatherTypeStr.push(translations.LOC_YELLOW_DUST);
            weatherTypeStr.push(translations.LOC_RAIN); //시계내강수
            weatherTypeStr.push(translations.LOC_LIGHT_DRIZZLE);
            weatherTypeStr.push(translations.LOC_DRIZZLE);
            weatherTypeStr.push(translations.LOC_HEAVY_DRIZZLE);
            weatherTypeStr.push(translations.LOC_DRIZZLE_STOPPED);
            weatherTypeStr.push(translations.LOC_LIGHT_RAIN_AT_TIMES);
            weatherTypeStr.push(translations.LOC_LIGHT_RAIN);

            weatherTypeStr.push(translations.LOC_RAIN_AT_TIMES);
            weatherTypeStr.push(translations.LOC_RAIN);
            weatherTypeStr.push(translations.LOC_HEAVY_RAIN_AT_TIMES);
            weatherTypeStr.push(translations.LOC_HEAVY_RAIN);
            weatherTypeStr.push(translations.LOC_LIGHT_SHOWERS);
            weatherTypeStr.push(translations.LOC_SHOWERS);
            weatherTypeStr.push(translations.LOC_HEAVY_SHOWERS);
            weatherTypeStr.push(translations.LOC_SHOWERS_STOPPED);
            weatherTypeStr.push(translations.LOC_RAIN_STOPPED);
            weatherTypeStr.push(translations.LOC_LIGHT_SLEET);

            weatherTypeStr.push(translations.LOC_HEAVY_SLEET);
            weatherTypeStr.push(translations.LOC_SLEET_STOPPED);
            weatherTypeStr.push(translations.LOC_LIGHT_SNOW_AT_TIMES);
            weatherTypeStr.push(translations.LOC_LIGHT_SNOW);
            weatherTypeStr.push(translations.LOC_SNOW_AT_TIMES);
            weatherTypeStr.push(translations.LOC_SNOW);
            weatherTypeStr.push(translations.LOC_HEAVY_SNOW_AT_TIMES);
            weatherTypeStr.push(translations.LOC_HEAVY_SNOW);
            weatherTypeStr.push(translations.LOC_LIGHT_SNOW_SHOWERS);
            weatherTypeStr.push(translations.LOC_HEAVY_SNOW_SHOWERS);

            weatherTypeStr.push(translations.LOC_SNOW_SHOWERS_STOPPED);
            weatherTypeStr.push(translations.LOC_SNOW_STOPPED);
            weatherTypeStr.push(translations.LOC_LIGHT_SNOW_PELLETS);
            weatherTypeStr.push(translations.LOC_HEAVY_SNOW_PELLETS);
            weatherTypeStr.push(translations.LOC_LIGHT_SNOW_STORM);
            weatherTypeStr.push(translations.LOC_SNOW_STORM);
            weatherTypeStr.push(translations.LOC_HEAVY_SNOW_STORM);
            weatherTypeStr.push(translations.LOC_POWDER_SNOW);
            weatherTypeStr.push(translations.LOC_WATER_SPOUT);
            weatherTypeStr.push(translations.LOC_HAIL);

            weatherTypeStr.push(translations.LOC_THUNDERSHOWERS);
            weatherTypeStr.push(translations.LOC_THUNDERSHOWERS_HAIL);
            weatherTypeStr.push(translations.LOC_THUNDERSHOWERS_RAIN_SNOW);
            weatherTypeStr.push(translations.LOC_THUNDERSHOWERS_STOPPED_RAIN);
            weatherTypeStr.push(translations.LOC_THUNDERSHOWERS_STOPPED_SNOW);
            weatherTypeStr.push(translations.LOC_LIGHTNING);
            weatherTypeStr.push(translations.LOC_BOLT_FROM_THE_BLUE);
            weatherTypeStr.push(translations.LOC_BOLT_STOPPED);
        }, function (translationIds) {
            weatherTypeStr.push(translationIds.LOC_CLEAR);
            weatherTypeStr.push(translationIds.LOC_PARTLY_CLOUDY);
            weatherTypeStr.push(translationIds.LOC_MOSTLY_CLOUDY);
            weatherTypeStr.push(translationIds.LOC_CLOUDY);
            weatherTypeStr.push(translationIds.LOC_MIST);
            weatherTypeStr.push(translationIds.LOC_HAZE);
            weatherTypeStr.push(translationIds.LOC_FOG); //안개변화무
            weatherTypeStr.push(translationIds.LOC_THIN_FOG);
            weatherTypeStr.push(translationIds.LOC_DENSE_FOG);
            weatherTypeStr.push(translationIds.LOC_FOG_STOPPED);
            weatherTypeStr.push(translationIds.LOC_FOG); //시계내안개
            weatherTypeStr.push(translationIds.LOC_PARTLY_FOG);
            weatherTypeStr.push(translationIds.LOC_YELLOW_DUST);
            weatherTypeStr.push(translationIds.LOC_RAIN); //시계내강수
            weatherTypeStr.push(translationIds.LOC_LIGHT_DRIZZLE);
            weatherTypeStr.push(translationIds.LOC_DRIZZLE);
            weatherTypeStr.push(translationIds.LOC_HEAVY_DRIZZLE);
            weatherTypeStr.push(translationIds.LOC_DRIZZLE_STOPPED);
            weatherTypeStr.push(translationIds.LOC_LIGHT_RAIN_AT_TIMES);
            weatherTypeStr.push(translationIds.LOC_LIGHT_RAIN);
            weatherTypeStr.push(translationIds.LOC_RAIN_AT_TIMES);
            weatherTypeStr.push(translationIds.LOC_RAIN);
            weatherTypeStr.push(translationIds.LOC_HEAVY_RAIN_AT_TIMES);
            weatherTypeStr.push(translationIds.LOC_HEAVY_RAIN);
            weatherTypeStr.push(translationIds.LOC_LIGHT_SHOWERS);
            weatherTypeStr.push(translationIds.LOC_SHOWERS);
            weatherTypeStr.push(translationIds.LOC_HEAVY_SHOWERS);
            weatherTypeStr.push(translationIds.LOC_SHOWERS_STOPPED);
            weatherTypeStr.push(translationIds.LOC_RAIN_STOPPED);
            weatherTypeStr.push(translationIds.LOC_LIGHT_SLEET);
            weatherTypeStr.push(translationIds.LOC_HEAVY_SLEET);
            weatherTypeStr.push(translationIds.LOC_SLEET_STOPPED);
            weatherTypeStr.push(translationIds.LOC_LIGHT_SNOW_AT_TIMES);
            weatherTypeStr.push(translationIds.LOC_LIGHT_SNOW);
            weatherTypeStr.push(translationIds.LOC_SNOW_AT_TIMES);
            weatherTypeStr.push(translationIds.LOC_SNOW);
            weatherTypeStr.push(translationIds.LOC_HEAVY_SNOW_AT_TIMES);
            weatherTypeStr.push(translationIds.LOC_HEAVY_SNOW);
            weatherTypeStr.push(translationIds.LOC_LIGHT_SNOW_SHOWERS);
            weatherTypeStr.push(translationIds.LOC_HEAVY_SNOW_SHOWERS);
            weatherTypeStr.push(translationIds.LOC_SNOW_SHOWERS_STOPPED);
            weatherTypeStr.push(translationIds.LOC_SNOW_STOPPED);
            weatherTypeStr.push(translationIds.LOC_LIGHT_SNOW_PELLETS);
            weatherTypeStr.push(translationIds.LOC_HEAVY_SNOW_PELLETS);
            weatherTypeStr.push(translationIds.LOC_LIGHT_SNOW_STORM);
            weatherTypeStr.push(translationIds.LOC_SNOW_STORM);
            weatherTypeStr.push(translationIds.LOC_HEAVY_SNOW_STORM);
            weatherTypeStr.push(translationIds.LOC_POWDER_SNOW);
            weatherTypeStr.push(translationIds.LOC_WATER_SPOUT);
            weatherTypeStr.push(translationIds.LOC_HAIL);
            weatherTypeStr.push(translationIds.LOC_THUNDERSHOWERS);
            weatherTypeStr.push(translationIds.LOC_THUNDERSHOWERS_HAIL);
            weatherTypeStr.push(translationIds.LOC_THUNDERSHOWERS_RAIN_SNOW);
            weatherTypeStr.push(translationIds.LOC_THUNDERSHOWERS_STOPPED_RAIN);
            weatherTypeStr.push(translationIds.LOC_THUNDERSHOWERS_STOPPED_SNOW);
            weatherTypeStr.push(translationIds.LOC_LIGHTNING);
            weatherTypeStr.push(translationIds.LOC_BOLT_FROM_THE_BLUE);
            weatherTypeStr.push(translationIds.LOC_BOLT_STOPPED);
        });

        function _convertKmaWeatherTypeToStr(weatherType) {
            return weatherTypeStr[weatherType];
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

            if (!(currentForecast.arpltn == undefined)) {
                _makeStrOfAqiGrade(currentForecast.arpltn);
            }
            if (!(currentForecast.dsplsGrade == undefined)) {
                currentForecast.dsplsStr = lowHighGradeStr[currentForecast.dsplsGrade-1];
            }
            if (!(currentForecast.ultrvGrade == undefined)) {
                currentForecast.ultrvStr = lowHighGradeStr[currentForecast.ultrvGrade];
            }
            if (!(currentForecast.fsnGrade == undefined)) {
                currentForecast.fsnStr = fsnGradeStr[currentForecast.fsnGrade];
            }
            if (!(currentForecast.pty == undefined)) {
                currentForecast.ptyStr = _convertKmaPtyToStr(currentForecast.pty);
            }
            if (!(currentForecast.rn1 == undefined)) {
               currentForecast.rn1Str = _convertKmaRxxToStr(currentForecast.pty, currentForecast.rn1);
            }
            if (!(currentForecast.weatherType == undefined)) {
                if (Util.language != 'ko') {
                   currentForecast.weather = _convertKmaWeatherTypeToStr(currentForecast.weatherType);
                }
            }
            currentForecast.diffTempStr = _diffTempStr(currentTownWeather, currentTownWeather.yesterday);
            currentForecast.summary = _makeSummary(currentTownWeather, currentTownWeather.yesterday);
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
                var isNight = time < 7 || time > 18;

                tempObject = shortForecast;

                tempObject.skyIcon = parseSkyState(shortForecast.sky, shortForecast.pty, shortForecast.lgt, isNight);
                tempObject.fromToday = diffDays;
                tempObject.time = time;

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
                data.dayOfWeek = convertStringToDate(data.date).getDay();

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

                if (!(data.dustForecast == undefined)) {
                    if (!(data.dustForecast.PM10Grade == undefined)) {
                        data.dustForecast.pm10Grade = data.dustForecast.PM10Grade+1;
                    }
                    if (!(data.dustForecast.PM25Grade == undefined)) {
                        data.dustForecast.pm25Grade = data.dustForecast.PM25Grade+1;
                    }
                    if (!(data.dustForecast.O3Grade == undefined)) {
                        data.dustForecast.o3Grade = data.dustForecast.O3Grade+1;
                    }
                    _makeStrOfAqiGrade(data.dustForecast);
                }
                if (!(data.ultrvGrade == undefined)) {
                    data.ultrvStr = lowHighGradeStr[data.ultrvGrade];
                }
                if (!(data.fsnGrade == undefined)) {
                    data.fsnStr = fsnGradeStr[data.fsnGrade];
                }
                if (!(data.pty == undefined)) {
                    data.ptyStr = _convertKmaPtyToStr(data.pty);
                }
                if (!(data.rn1 == undefined)) {
                    data.rn1Str = _convertKmaRxxToStr(data.pty, data.rn1);
                }
                if (!(data.r06 == undefined)) {
                    data.r06Str = _convertKmaRxxToStr(data.pty, data.r06);
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
        //obj.convertTimeString = function (date) {
        //    return (date.getMonth()+1)+"월 "+date.getDate()+ "일" + "("+dayToString(date.getDay()) +") " +
        //            " " + (date.getHours()<10?"0":"") + date.getHours() +
        //            ":" + (date.getMinutes()<10?"0":"") + date.getMinutes();
        //};

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
                '?apikey=' + twClientConfig.daumServiceKey +
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
                '?apikey=' + twClientConfig.daumServiceKey +
                '&longitude='+ lng +
                '&latitude='+lat+
                '&inputCoordSystem=WGS84'+
                '&output=json';

            $http({method: 'GET', url: url, timeout: 3000})
                .success(function (data, status, headers, config, statusText) {
                    if (data.fullName) {
                        var address = data.fullName;

                        address = '대한민국 ' + address;
                        deferred.resolve(address);
                    }
                    else {
                        deferred.reject(new Error('Fail to get address name'));
                    }
                })
                .error(function (data, status, headers, config, statusText) {
                    var error = new Error(data);
                    error.code = status;
                    deferred.reject(error);
                });

            return deferred.promise;
        }

        function getAddressFromGoogle(lat, lng) {
            var deferred = $q.defer();
            var url = "https://maps.googleapis.com/maps/api/geocode/json?latlng=" + lat + "," + lng;
            url += "&language=ko";
            $http({method: 'GET', url: url, timeout: 3000})
                .success(function (data, status, headers, config, statusText) {
                    if (data.status === "OK") {
                        var address = findDongAddressFromGoogleGeoCodeResults(data.results);
                        if (!address || address.length === 0) {
                            deferred.reject(new Error("Fail to find dong address from " + data.results[0].formatted_address));
                            return;
                        }
                        deferred.resolve(address);
                    }
                    else {
                        //'ZERO_RESULTS', 'OVER_QUERY_LIMIT', 'REQUEST_DENIED',  'INVALID_REQUEST', 'UNKNOWN_ERROR'
                        deferred.reject(new Error(data.status));
                    }
                })
                .error(function (data, status, headers, config, statusText) {
                    var error = new Error(data);
                    error.code = status;
                    deferred.reject(error);
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
            var startTime = new Date().getTime();
            var endTime;

            getAddressFromDaum(lat, long).then(function(address) {
                console.log(address);
                endTime = new Date().getTime();
                Util.ga.trackTiming('address', endTime - startTime, 'get', 'daum');
                Util.ga.trackEvent('address', 'get', 'daum', endTime - startTime);

                deferred.resolve(address);
            }, function (err) {
                console.log(err);
                endTime = new Date().getTime();
                Util.ga.trackTiming('address', endTime - startTime, 'error', 'daum');
                if (err instanceof Error) {
                    Util.ga.trackEvent('address', 'error', 'daum(message:' + err.message + ', code:' + err.code + ')', endTime - startTime);
                } else {
                    Util.ga.trackEvent('address', 'error', 'daum(' + err + ')', endTime - startTime);
                }

                startTime = new Date().getTime();
                getAddressFromGoogle(lat, long).then(function (address) {
                    console.log(address);
                    endTime = new Date().getTime();
                    Util.ga.trackTiming('address', endTime - startTime, 'get', 'google');
                    Util.ga.trackEvent('address', 'get', 'google', endTime - startTime);

                    deferred.resolve(address);
                }, function (err) {
                    endTime = new Date().getTime();
                    Util.ga.trackTiming('address', endTime - startTime, 'error', 'google');
                    if (err instanceof Error) {
                        Util.ga.trackEvent('address', 'error', 'google(message:' + err.message + ', code:' + err.code + ')', endTime - startTime);
                    } else {
                        Util.ga.trackEvent('address', 'error', 'google(' + err + ')', endTime - startTime);
                    }

                    deferred.reject(err);
                });
            });
            return deferred.promise;
        };

        function _navigatorRetryGetCurrentPosition(retryCount, callback)  {
            navigator.geolocation.getCurrentPosition(function (position) {
                //경기도,광주시,오포읍,37.36340556,127.2307667
                //deferred.resolve({latitude: 37.363, longitude: 127.230});
                //세종특별자치시,세종특별자치시,연기면,36.517338,127.259247
                //37.472595, 126.795249
                //경상남도/거제시옥포2동 "lng":128.6875, "lat":34.8966
                //deferred.resolve({latitude: 34.8966, longitude: 128.6875});
                //서울특별시
                //deferred.resolve({latitude: 37.5635694, longitude: 126.9800083});
                //경기 수원시 영통구 광교1동
                //deferred.resolve({latitude: 37.298876, longitude: 127.047527});

                console.log('navigator geolocation');
                console.log(position);

                callback(undefined, position, retryCount);
            }, function (error) {
                console.log("Fail to get current position from navigator");
                console.log("retry:"+retryCount+" code:"+error.code+" message:"+error.message);

                retryCount--;
                if (retryCount <= 0) {
                    return callback(error, undefined, retryCount);
                }
                else {
                    //간격을 주지 않으면 계속 실패해버림.
                    setTimeout(function () {
                        _navigatorRetryGetCurrentPosition(retryCount, callback);
                    }, 500);
                }
            }, { maximumAge: 3000, timeout: 5000, enableHighAccuracy: retryCount%2!=0 });
        }

        function _nativeRetryGetCurrentPosition(retryCount, callback) {
            var orgGeo = cordova.require('cordova/modulemapper').getOriginalSymbol(window, 'navigator.geolocation');

            orgGeo.getCurrentPosition(function (position) {
                    console.log('native geolocation');
                    console.log(position);

                    callback(undefined, position, retryCount);
                },
                function (error) {
                    console.log("Fail to get current position from native");
                    console.log("code:"+error.code+" message:"+error.message);

                    retryCount--;
                    if (retryCount <= 0) {
                        return callback(error, undefined, retryCount);
                    }
                    else {
                        setTimeout(function () {
                            _nativeRetryGetCurrentPosition(retryCount, callback);
                        }, 500);
                    }
                }, { maximumAge: 3000, timeout: 5000, enableHighAccuracy: retryCount%2!=0 });
        }

        obj.getCurrentPosition = function () {
            var deferred = $q.defer();

            ionic.Platform.ready(function() {
                var startTime = new Date().getTime();
                var endTime;

                _navigatorRetryGetCurrentPosition(2, function (error, position, retryCount) {
                    endTime = new Date().getTime();
                    if (error) {
                        Util.ga.trackTiming('position', endTime - startTime, 'error', 'default');
                        Util.ga.trackEvent('position', 'error', 'default(retry:' + retryCount + ', message: ' + error.message + ', code:' + error.code + ')', endTime - startTime);
                        return deferred.reject();
                    }

                    Util.ga.trackTiming('position', endTime - startTime, 'get', 'default');
                    Util.ga.trackEvent('position', 'get', 'default(retry:' + retryCount + ')', endTime - startTime);
                    deferred.resolve(position.coords);
                });

                if (ionic.Platform.isAndroid() && window.cordova) {
                    _nativeRetryGetCurrentPosition(2, function (error, position, retryCount) {
                        endTime = new Date().getTime();
                        if (error) {
                            Util.ga.trackTiming('position', endTime - startTime, 'error', 'native');
                            Util.ga.trackEvent('position', 'error', 'native(retry:' + retryCount + ', message: ' + error.message + ', code:' + error.code + ')', endTime - startTime);
                            return deferred.reject();
                        }

                        Util.ga.trackTiming('position', endTime - startTime, 'get', 'native');
                        Util.ga.trackEvent('position', 'get', 'native(retry:' + retryCount + ')', endTime - startTime);
                        deferred.resolve(position.coords);
                    });
                }
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
            var promises = [];
            promises.push(getTownWeatherInfo(townAddress));

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

        return obj;
    })
    .factory('Util', function ($window) {
        var obj = {};
        var gaArray = [];

        //region Function

        //endregion

        //region APIs

        obj.ga = {
            startTrackerWithId: function (id, dispatchPeriod) {
                if (typeof $window.ga !== "undefined") {
                    return $window.ga.startTrackerWithId(id, dispatchPeriod, function(result) {
                        console.log("startTrackerWithId success = " + result);
                    }, function(error) {
                        console.log("startTrackerWithId error = " + error);
                    });
                }
            },
            setAllowIDFACollection: function (enable) {
                if (typeof $window.ga !== "undefined") {
                    return $window.ga.setAllowIDFACollection(enable, function(result) {
                        console.log("setAllowIDFACollection success = " + result);
                    }, function(error) {
                        console.log("setAllowIDFACollection error = " + error);
                    });
                }
            },
            setUserId: function (id) {
                if (typeof $window.ga !== "undefined") {
                    return $window.ga.setUserId(id, function(result) {
                        console.log("setUserId success = " + result);
                    }, function(error) {
                        console.log("setUserId error = " + error);
                    });
                }
            },
            setAnonymizeIp: function (anonymize) {
                if (typeof $window.ga !== "undefined") {
                    return $window.ga.setAnonymizeIp(anonymize, function(result) {
                        console.log("setAnonymizeIp success = " + result);
                    }, function(error) {
                        console.log("setAnonymizeIp error = " + error);
                    });
                }
            },
            setOptOut: function (optout) {
                if (typeof $window.ga !== "undefined") {
                    return $window.ga.setOptOut(optout, function(result) {
                        console.log("setOptOut success = " + result);
                    }, function(error) {
                        console.log("setOptOut error = " + error);
                    });
                }
            },
            setAppVersion: function (version) {
                if (typeof $window.ga !== "undefined") {
                    return $window.ga.setAppVersion(version, function(result) {
                        console.log("setAppVersion success = " + result);
                    }, function(error) {
                        console.log("setAppVersion error = " + error);
                    });
                }
            },
            debugMode: function () {
                if (typeof $window.ga !== "undefined") {
                    return $window.ga.debugMode(function(result) {
                        console.log("debugMode success = " + result);
                    }, function(error) {
                        console.log("debugMode error = " + error);
                    });
                }
            },
            trackMetric: function (key, value) {
                if (typeof $window.ga !== "undefined") {
                    return $window.ga.trackMetric(key, value, function(result) {
                        console.log("trackMetric success = " + result);
                    }, function(error) {
                        console.log("trackMetric error = " + error);
                    });
                }
            },
            trackView: function (screen, campaingUrl, newSession) {
                if (typeof $window.ga !== "undefined") {
                    return $window.ga.trackView(screen, campaingUrl, newSession, function(result) {
                        console.log("trackView success = " + result);
                    }, function(error) {
                        console.log("trackView error = " + error);
                        gaArray.push(["trackView", screen, campaingUrl]);
                    });
                } else {
                    console.log("trackView undefined");
                    gaArray.push(["trackView", screen, campaingUrl]);
                }
            },
            addCustomDimension: function (key, value) {
                if (typeof $window.ga !== "undefined") {
                    return $window.ga.addCustomDimension(key, value, function(result) {
                        console.log("addCustomDimension success = " + result);
                    }, function(error) {
                        console.log("addCustomDimension error = " + error);
                    });
                }
            },
            trackEvent: function (category, action, label, value, newSession) {
                if (typeof $window.ga !== "undefined") {
                    return $window.ga.trackEvent(category, action, label, value, newSession, function(result) {
                        console.log("trackEvent success = " + result);
                    }, function(error) {
                        console.log("trackEvent error = " + error);
                        gaArray.push(["trackEvent", category, action, label, value, newSession]);
                    });
                } else {
                    console.log("trackEvent undefined");
                    gaArray.push(["trackEvent", category, action, label, value, newSession]);
                }
            },
            trackException: function (description, fatal) {
                if (typeof $window.ga !== "undefined") {
                    return $window.ga.trackException(description, fatal, function(result) {
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
            trackTiming: function (category, intervalInMilliseconds, name, label) {
                if (typeof $window.ga !== "undefined") {
                    return $window.ga.trackTiming(category, intervalInMilliseconds, name, label, function(result) {
                        console.log("trackTiming success = " + result);
                    }, function(error) {
                        console.log("trackTiming error = " + error);
                    });
                }
            },
            addTransaction: function (transactionId, affiliation, revenue, tax, shipping, currencyCode) {
                if (typeof $window.ga !== "undefined") {
                    return $window.ga.addTransaction(transactionId, affiliation, revenue, tax, shipping, currencyCode, function(result) {
                        console.log("addTransaction success = " + result);
                    }, function(error) {
                        console.log("addTransaction error = " + error);
                    });
                }
            },
            addTransactionItem: function (transactionId, name, sku, category, price, quantity, currencyCode) {
                if (typeof $window.ga !== "undefined") {
                    return $window.ga.addTransactionItem(transactionId, name, sku, category, price, quantity, currencyCode, function(result) {
                        console.log("addTransactionItem success = " + result);
                    }, function(error) {
                        console.log("addTransactionItem error = " + error);
                    });
                }
            },
            enableUncaughtExceptionReporting: function (enable) {
                if (typeof $window.ga !== "undefined") {
                    return $window.ga.enableUncaughtExceptionReporting(enable, function(result) {
                        console.log("enableUncaughtExceptionReporting success = " + result);
                    }, function(error) {
                        console.log("enableUncaughtExceptionReporting error = " + error);
                    });
                }
            },
            platformReady: function() {
                if (typeof $window.ga !== "undefined") {
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
        obj.suiteName = "group.net.wizardfactory.todayweather";
        obj.language;

        //obj.url = "/v000705";
        //obj.url = "https://todayweather-wizardfactory.rhcloud.com/v000705";
        //obj.url = "https://tw-wzdfac.rhcloud.com/v000705";
        //obj.url = "https://todayweather.wizardfactory.net/v000705";
        //obj.url = window.twClientConfig.serverUrl;

        return obj;
    })
    .run(function($rootScope, $ionicPlatform, WeatherInfo, Util) {
        //위치 재조정해야 함.
        if (twClientConfig.debug) {
            Util.ga.debugMode();
        }

        if (ionic.Platform.isIOS()) {
            Util.ga.startTrackerWithId(twClientConfig.gaIOSKey);
        } else if (ionic.Platform.isAndroid()) {
            Util.ga.startTrackerWithId(twClientConfig.gaAndroidKey, 30);

            /**
             * 기존 버전 호환성이슈로 Android는 유지.
             */
            Util.suiteName = "net.wizardfactory.todayweather_preferences";
        }
        else {
            console.log("Error : Unknown platform");
        }

        Util.language = navigator.userLanguage || navigator.language;

        Util.ga.platformReady();

        Util.ga.enableUncaughtExceptionReporting(true);
        Util.ga.setAllowIDFACollection(true);

        if (window.hasOwnProperty("device")) {
            console.log("UUID:"+window.device.uuid);
        }
        console.log("UA:"+ionic.Platform.ua);
        console.log("Height:" + window.innerHeight + ", Width:" + window.innerWidth + ", PixelRatio:" + window.devicePixelRatio);
        console.log("OuterHeight:" + window.outerHeight + ", OuterWidth:" + window.outerWidth);
        console.log("ScreenHeight:"+window.screen.height+", ScreenWidth:"+window.screen.width);

        if (window.screen) {
            Util.ga.trackEvent('app', 'screen width', window.screen.width);
            Util.ga.trackEvent('app', 'screen height', window.screen.height);
        }
        else if (window.outerHeight) {
            Util.ga.trackEvent('app', 'outer width', window.outerWidth);
            Util.ga.trackEvent('app', 'outer height', window.outerHeight);
        }

        if (window.hasOwnProperty("device")) {
            Util.ga.trackEvent('app', 'uuid', window.device.uuid);
        }
        Util.ga.trackEvent('app', 'ua', ionic.Platform.ua);
        if (window.cordova && cordova.getAppVersion) {
            cordova.getAppVersion.getVersionNumber().then(function (version) {
                Util.version = version;
                Util.ga.trackEvent('app', 'version', Util.version);
            });
        }

        window.onerror = function(msg, url, line) {
            var idx = url.lastIndexOf("/");
            if(idx > -1) {url = url.substring(idx+1);}
            var errorMsg = "ERROR in " + url + " (line #" + line + "): " + msg;
            Util.ga.trackEvent('window', 'error', errorMsg);
            Util.ga.trackException(errorMsg, true);
            console.log(errorMsg);
            if (twClientConfig.debug) {
                alert("ERROR in " + url + " (line #" + line + "): " + msg);
            }
            return false; //suppress Error Alert;
        };

        document.addEventListener("resume", function() {
            Util.ga.trackEvent('app', 'status', 'resume');
        }, false);
        document.addEventListener("pause", function() {
            Util.ga.trackEvent('app', 'status', 'pause');
        }, false);

        WeatherInfo.loadCities();
        WeatherInfo.loadTowns();
        $ionicPlatform.on('resume', function(){
            if (WeatherInfo.canLoadCity(WeatherInfo.getCityIndex()) === true) {
                $rootScope.$broadcast('reloadEvent', 'resume');
            }
        });
    });
