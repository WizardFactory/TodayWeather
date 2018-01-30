angular.module('service.weatherinfo', [])
    .factory('WeatherInfo', function (WeatherUtil, TwStorage, Util) {
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
                        if (city.name || cities[i].name) {
                           if (city.name === cities[i].name)  {
                               return i;
                           }
                        }
                        else {
                            return i;
                        }
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
                TwStorage.set("cityIndex", cityIndex);
                console.log("cityIndex = " + cityIndex);
                Util.ga.trackEvent('city', 'set', 'index', index);
            }
            else {
                Util.ga.trackEvent('city', 'error', 'Invalid set index', index);
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
            var city;
            try {
                city = cities[index];
                city.loadTime = null;
            }
            catch (err) {
                Util.ga.trackEvent('city', 'error', 'fail to reload index='+index);
                Util.ga.trackException(err, false);
            }
        };

        obj.updateCity = function (index, newCityInfo) {
            var that = this;
            var city = cities[index];
            var updatePush = false;

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
            if (newCityInfo.source) {
                city.source = newCityInfo.source;
            }
            if (newCityInfo.airInfo) {
                city.airInfo = newCityInfo.airInfo;
            }

            if (city.currentPosition == true) {
                if (newCityInfo.name) {
                    city.name = newCityInfo.name;
                }
                if (newCityInfo.country) {
                    city.country = newCityInfo.country;
                }
                if (newCityInfo.address) {
                    city.address = newCityInfo.address;
                }
                if (newCityInfo.location) {
                    if (JSON.stringify(city.location) !== JSON.stringify(newCityInfo.location)) {
                        updatePush = true;
                    }
                    city.location = newCityInfo.location;
                }
            }
            else {
                //구버전에 저장된 도시정보에는 location이 없는 경우가 있음. #1971
                //v000901/kma/addr 에서 추가해주어야 함.
                if (!city.location && newCityInfo.location) {
                    city.location = newCityInfo.location;
                    console.info('update location ', city);
                }
            }

            if (updatePush && window.push) {
                var alarmInfo = window.push.getAlarm(index);

                if (alarmInfo) {
                    window.push.updateAlarm(index, alarmInfo.time);
                }
            }

            city.loadTime = new Date();

            that.saveCities();
        };

        obj.loadCities = function() {
            var that = this;
            var items = TwStorage.get("cities");

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
            cityIndex = TwStorage.get("cityIndex");
            if (cityIndex === null) {
                Util.ga.trackEvent('city', 'error', 'loadIndexNull');
                that.setFirstCityIndex();
            }
            else if (cityIndex >= cities.length) {
                Util.ga.trackEvent('city', 'error', 'loadIndexOver');
                that.setFirstCityIndex();
            }
            else {
                Util.ga.trackEvent('city', 'load', 'index', cityIndex);
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
                    simpleInfo.country = city.country;
                    pList.cityList.push(simpleInfo);
                }
            });

            console.log('save preference plist='+JSON.stringify(pList));
            TwStorage.set("cityList", pList);
        };

        obj._loadCitiesPreference = function (callback) {
            var cityList = TwStorage.get("cityList");
            if (cityList == undefined) {
                callback(new Error("Can not find cityList"));
            } else {
                callback(undefined, cityList);
            }
        };

        obj.saveCities = function() {
            TwStorage.set("cities", cities);
            this._saveCitiesPreference(cities);
        };

        obj.loadTowns = function() {
            var that = this;

            that.towns = window.towns;
        };

        //endregion

        return obj;
    });
