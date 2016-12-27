/**
 * Created by Peter on 2016. 9. 12..
 */
"use strict";

var defaultData = {
    location:{
        region: '',
        city: '',
        town: ',',
        stnId: -1000,
        regId: '',
        lat: -1000,
        lon: -1000,
        timeOffset: -1000
    },
    pubDate:{
        wuCurrent: -1000,
        wuForecast: -1000,
        DSF: -1000,
        short: -1000,
        shortRss: -1000,
        shortest: -1000,
        rss: -1000,
        land: -1000,
        temp: -1000
    },
    thisTime:[{
        date:-1000,
        desc: '',
        temp_c: -1000,
        temp_f: -1000,
        ftemp_c: -1000,
        ftemp_f: -1000,
        cloud: -1000,
        windSpd_mh: -1000,
        windSpd_ms: -1000,
        windDir: -1000,
        humid: -1000,
        precType: -1000,
        precProb: -1000,
        precip: -1000,
        vis: -1000,
        press: -1000,
        oz: -1000,
    }],
    hourly:[{
        date: -1000,
        desc: '',
        temp_c: -1000,
        temp_f: -1000,
        ftemp_c: -1000,
        ftemp_f: -1000,
        cloud: -1000,
        windSpd_mh: -1000,
        windSpd_ms: -1000,
        windDir: -1000,
        humid: -1000,
        precType: -1000,   // 0: 없음 1:비 2:눈 3:비+눈 4:우박
        precProb: -1000,
        precip: -1000,
        vis: -1000,
        press: -1000,
        oz: -1000,
    }],
    daily:[{
        date: -1000,
        desc: '',
        sunrise: -1000,
        sunset: -1000,
        moonrise: -1000,
        moonset: -1000,
        moonPhase: -1000,
        tempMax_c: -1000,
        tempMax_f: -1000,
        tempMin_c: -1000,
        tempMin_f: -1000,
        ftempMax_c: -1000,
        ftempMax_f: -1000,
        ftempMin_c: -1000,
        ftempMin_f: -1000,
        cloud: -1000,
        windSpd_mh: -1000,
        windSpd_ms: -1000,
        windDir: -1000,
        humid: -1000,
        precType: -1000,    // 0: 없음 1:비 2:눈 3:비+눈 4:우박
        precProb: -1000,
        precip: -1000,
        vis: -1000,
        press: -1000,
        oz: -1000,
    }]
};

function DataTemplate(){
}

DataTemplate.prototype.getDefault = function(){
    return defaultData;
};

module.exports = DataTemplate;
