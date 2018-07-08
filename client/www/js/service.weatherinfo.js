angular.module('service.weatherinfo', [])
    .factory('WeatherInfo', function ($rootScope, WeatherUtil, TwStorage, Util) {
        var cities = [];
        var cityIndex = -1;
        var loadingWeatherPhotos = false;
        var obj = {};

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
                city.photo = null;
            } else {
                city = item;
                city.disable = item.disable === undefined ? false : item.disable;
                city.photo = item.photo === undefined ? null : item.photo;
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

        /**
         *
         * @param {number} index
         */
        obj.setCityIndex = function (index) {
            if (index >= 0 && index < cities.length) {
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
            if (index >= 0 && index < cities.length) {
                var city = cities[index];

                if (city.disable === true) {
                    return false;
                }

                var time = new Date();
                return !!(city.loadTime === null || time.getTime() - city.loadTime.getTime() > (10 * 60 * 1000));
            }
            Util.ga.trackException(new Error('invalid city index='+index), false);
            return false;
        };

        obj.addCity = function (city) {
            var that = this;

            if (that.getIndexOfCity(city) === -1) {
                city.disable = false;
                city.loadTime = new Date();
                city.photo = that._getPhoto(city.currentWeather);
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
            if (newCityInfo.airInfoList) {
                city.airInfoList = newCityInfo.airInfoList;
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

            if (window.updateCityInfo) {
                console.info('update city info for push');
                window.updateCityInfo(index);
            }
            else {
                //Util.ta.trackException(new Error("updateCityInfo is undefined"), false);
            }

            city.loadTime = new Date();
            city.photo = that._getPhoto(city.currentWeather);

            that.saveCities();
        };

        obj.loadWeatherPhotos = function () {
            var that = this;

            if (loadingWeatherPhotos === true || window.weatherPhotos != undefined) {
                return;
            }

            loadingWeatherPhotos = true;
            WeatherUtil.loadWeatherPhotos().then(function () {
                for (var i = 0; i < cities.length; i += 1) {
                    if (cities[i].photo === null) {
                        cities[i].photo = WeatherUtil.findWeatherPhoto(cities[i].currentWeather);
                    }
                }
                that.saveCities();
                $rootScope.$broadcast('loadWeatherPhotosEvent');
            }).finally(function () {
                loadingWeatherPhotos = false;
            });
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

            // load weather photos
            that.loadWeatherPhotos();
        };

        obj._saveCitiesPreference = function (cities) {
            var pList = {cityList: []};
            cities.forEach(function (city, index) {
                if (!city.disable) {
                    var simpleInfo = {};
                    if (city.name) {
                        simpleInfo.name = city.name;
                    }
                    simpleInfo.currentPosition = city.currentPosition;
                    simpleInfo.address = city.address;
                    simpleInfo.location = city.location;
                    simpleInfo.country = city.country;
                    simpleInfo.index = index;
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

        obj._getPhoto = function (currentWeather) {
            var that = this;

            if (window.weatherPhotos == undefined) {
                that.loadWeatherPhotos();
                return null;
            }
            return WeatherUtil.findWeatherPhoto(currentWeather);
        };

        obj.saveCities = function() {
            TwStorage.set("cities", cities);
            this._saveCitiesPreference(cities);
        };

        //endregion

        return obj;
    });
