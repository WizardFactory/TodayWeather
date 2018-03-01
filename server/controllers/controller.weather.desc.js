/**
 *
 * Created by aleckim on 2017. 12. 10..
 */

'use strict';

class WeatherDescription {
    constructor() {

    }

    static makeWeatherType(weatherStr) {
        if (!weatherStr.hasOwnProperty('length') || weatherStr.length <= 0) {
            return -1;
        }

        /**
         *  'light rain and breezy' -> 'light rain'
         */
        weatherStr = weatherStr.toLowerCase();
        if (weatherStr.indexOf('and')) {
            //log.info('weatherStr='+weatherStr);
            weatherStr = weatherStr.split(' and ')[0];
        }

        switch (weatherStr) {
            case 'sunny':
            case 'clear':
            case '맑음': return 0;
            case 'partly cloudy':
            case '구름조금': return 1;
            case 'mostly cloudy':
            case '구름많음': return 2;
            case 'cloudy':
            case 'overcast':
            case '흐림': return 3;
            case 'mist':
            case '박무': return 4;
            case 'haze':
            case '연무': return 5;
            case 'fog':
            case '안개변화무': return 6;
            case 'thin fog':
            case '안개엷어짐': return 7;
            case 'dense fog':
            case 'foggy':
            case '안개강해짐': return 8;
            case 'fog clear':
            case '안개끝': return 9;
            case '시계내안개': return 10;
            case 'partly fog':
            case '부분안개': return 11;
            case 'yellow dust':
            case '황사': return 12;
            case '시계내강수': return 13;
            case 'light drizzle':
            case '약한이슬비': return 14;
            case 'drizzle':
            case '보통이슬비': return 15;
            case 'heavy drizzle':
            case '강한이슬비': return 16;
            case 'drizzle clear':
            case '이슬비끝': return 17;
            case 'light rain at times':
            case '약한비단속': return 18;
            case 'possible light rain':
            case 'light rain':
            case '약한언비':
            case '약한비계속': return 19;
            case 'rain at times':
            case '보통비단속': return 20;
            case 'rain':
            case '보통비계속': return 21;
            case 'heavy rain at times':
            case '강한비단속': return 22;
            case 'heavy rain':
            case '강한비계속': return 23;
            case 'light showers':
            case '약한소나기': return 24;
            case 'showers':
            case '보통소나기': return 25;
            case 'heavy showers':
            case '강한소나기': return 26;
            case 'showers clear':
            case '소나기끝': return 27;
            case 'rain clear':
            case '비끝남': return 28;
            case 'light sleet':
            case "약진눈깨비":
            case '진눈깨비약': return 29;
            case 'heavy sleet':
            case '강진눈깨비': return 30;
            case 'sleet clear':
            case '진눈깨비끝': return 31;
            case 'light snow at times':
            case '약한눈단속': return 32;
            case 'possible light snow':
            case 'light snow':
            case '약한눈계속': return 33;
            case 'snow at times':
            case '보통눈단속': return 34;
            case 'snow':
            case '보통눈계속': return 35;
            case 'heavy snow at times':
            case '강한눈단속': return 36;
            case 'heavy snow':
            case '강한눈계속': return 37;
            case 'light snow showers':
            case '소낙눈/약': return 38;
            case 'heavy snow showers':
            case '소낙눈/강': return 39;
            case 'snow showers clear':
            case '소낙눈끝': return 40;
            case 'snow clear':
            case '눈끝남': return 41;
            case 'light snow pellets':
            case '싸락눈/약': return 42;
            case 'heavy snow pellets':
            case '싸락눈/강': return 43;
            case 'light snowstorm':
            case '약한눈보라': return 44;
            case 'snowstorm':
            case '보통눈보라': return 45;
            case 'heavy snowstorm':
            case '강한눈보라': return 46;
            case 'flurries':
            case '가루눈': return 47;
            case 'waterspout':
            case '용오름': return 48;
            case 'hail':
            case '우박': return 49;
            case 'thundershowers':
            case '뇌우': return 50;
            case 'thundershowers hail':
            case '뇌우,우박': return 51;
            case 'thundershowers snow/rain':
            case 'thundershowers rain/snow':
            case '뇌우,눈/비':
            case '뇌우,비/눈': return 52;
            case 'thundershowers clear, rain':
            case '뇌우끝,비': return 53;
            case 'thundershowers clear, snow':
            case '뇌우끝,눈': return 54;
            case 'lightning':
            case '번개': return 55;
            case 'dry lightning':
            case '마른뇌전': return 56;
            case 'thunderstorm clear':
            case '뇌전끝': return 57;
            case 'ice pellets':
            case '얼음싸라기': return 58;
            case 'breezy': return 59;
            case 'humid': return 60;
            case 'windy': return 61;
            case 'dry': return 62;
            case 'dangerously windy': return 63; //LOC_VERY_STRONG_WIND
            case 'sleet':
            case '진눈깨비': return 64;
            case '비': return 65; //for KMA AWS
            case '눈': return 66; //for KMA AWS
            default :
                log.error("Fail weatherStr="+weatherStr);
        }
        return -1;
    }

    /**
     *
     * @param current
     * @param ts
     * @returns {string}
     */
    static getWeatherStr(weatherType, ts) {
        if (weatherType == undefined) {
            return "";
        }

        /**
         * 순서가 server의 _description2weatherType, _makeWeatherType와 동일해야 함.
         * @type {string[]}
         */
        var weatherTypeStr = ['LOC_CLEAR', 'LOC_PARTLY_CLOUDY', 'LOC_MOSTLY_CLOUDY', 'LOC_CLOUDY', 'LOC_MIST',
            'LOC_HAZE', 'LOC_FOG', 'LOC_THIN_FOG', 'LOC_DENSE_FOG', 'LOC_FOG_STOPPED',

            'LOC_FOG', 'LOC_PARTLY_FOG', 'LOC_YELLOW_DUST', 'LOC_RAIN', 'LOC_LIGHT_DRIZZLE',
            'LOC_DRIZZLE', 'LOC_HEAVY_DRIZZLE', 'LOC_DRIZZLE_STOPPED', 'LOC_LIGHT_RAIN_AT_TIMES', 'LOC_LIGHT_RAIN',

            'LOC_RAIN_AT_TIMES', 'LOC_RAIN', 'LOC_HEAVY_RAIN_AT_TIMES', 'LOC_HEAVY_RAIN', 'LOC_LIGHT_SHOWERS',
            'LOC_SHOWERS', 'LOC_HEAVY_SHOWERS', 'LOC_SHOWERS_STOPPED', 'LOC_RAIN_STOPPED', 'LOC_LIGHT_SLEET',

            'LOC_HEAVY_SLEET', 'LOC_SLEET_STOPPED', 'LOC_LIGHT_SNOW_AT_TIMES', 'LOC_LIGHT_SNOW', 'LOC_SNOW_AT_TIMES',
            'LOC_SNOW', 'LOC_HEAVY_SNOW_AT_TIMES', 'LOC_HEAVY_SNOW', 'LOC_LIGHT_SNOW_SHOWERS', 'LOC_HEAVY_SNOW_SHOWERS',

            'LOC_SNOW_SHOWERS_STOPPED', 'LOC_SNOW_STOPPED', 'LOC_LIGHT_SNOW_PELLETS', 'LOC_HEAVY_SNOW_PELLETS', 'LOC_LIGHT_SNOW_STORM',
            'LOC_SNOW_STORM', 'LOC_HEAVY_SNOW_STORM', 'LOC_POWDER_SNOW', 'LOC_WATER_SPOUT', 'LOC_HAIL',

            'LOC_THUNDERSHOWERS', 'LOC_THUNDERSHOWERS_HAIL', 'LOC_THUNDERSHOWERS_RAIN_SNOW', 'LOC_THUNDERSHOWERS_STOPPED_RAIN', 'LOC_THUNDERSHOWERS_STOPPED_SNOW',
            'LOC_LIGHTNING', 'LOC_BOLT_FROM_THE_BLUE', 'LOC_BOLT_STOPPED', 'LOC_ICE_PELLETS', 'LOC_BREEZY',
            'LOC_HUMID', 'LOC_WINDY', 'LOC_DRY', 'LOC_VERY_STRONG_WIND', 'LOC_SLEET', 'LOC_RAIN', 'LOC_SNOW'];
        return ts.__(weatherTypeStr[weatherType]);
    }
}

module.exports = WeatherDescription;
