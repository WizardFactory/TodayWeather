/**
 * Created by Peter on 2016. 8. 18..
 */

var mongoose = require("mongoose");

var dsForecastSchema = new mongoose.Schema({
    geocode: {lat: Number, lon: Number},
    address: {country:String, city:String, zipcode:Number, postcode:Number},
    date:    {type: Number, default: 0},   // GMT time YYYYMMDDHHMM
    dateObj: {type: Object, default: Date},// UTC time
    timeOffset: {type: Number, default: 0},
    data: [{
        current:{
            dateObj:    {type: Object, default: Date},  // UTC time
            date:       {type: Number, default: 0}, // GMT time
            summary:    {type: String, default: ''},
            pre_int:    {type: Number, default:0},  // 강수 강도 (0, 0.002, 0.017, 0.1, 0.4)
            pre_pro:    {type: Number, default:0},  // 강수 유/무 (0 or 1)
            pre_type:   {type: String, default:''}, // rain, snow, sleet
            temp:       {type: Number, default:0},
            ftemp:      {type: Number, default:0},  // 체감온도
            humid:      {type: Number, default:0},  // 습도 percentage (0 ~ 1)
            windspd:    {type: Number, default:0},  // miles per hour
            winddir:    {type: Number, default:0},  // degrees
            vis:        {type: Number, default:0},  // in miles
            cloud:      {type: Number, default:0},  // percentage (0 ~ 1)
            pres:       {type: Number, default:0},  // millibar
            oz:         {type: Number, default:0}   // dobson unit
        },
        hourly:{
            summary:        {type:String, default:''},
            data:[{
                dateObj:    {type: Object, default: Date}, // UTC time
                date:       {type: Number, default:0},  // GMT time
                summary:    {type: String, default: ''},
                pre_int:    {type: Number, default:0},  // 강수 강도 (0, 0.002, 0.017, 0.1, 0.4)
                pre_pro:    {type: Number, default:0},  // 강수 유/무 (0 or 1)
                pre_type:   {type: String, default:''}, // rain, snow, sleet
                temp:       {type: Number, default:0},
                ftemp:      {type: Number, default:0},  // 체감온도
                humid:      {type: Number, default:0},  // 습도 percentage (0 ~ 1)
                windspd:    {type: Number, default:0},  // miles per hour
                winddir:    {type: Number, default:0},  // degrees
                vis:        {type: Number, default:0},  // in miles
                cloud:      {type: Number, default:0},  // percentage (0 ~ 1)
                pres:       {type: Number, default:0},  // millibar
                oz:         {type: Number, default:0}   // dobson unit
            }]

        },
        daily:{
            summary: {type:String, default:''},
            data:[{
                dateObj:        {type: Object, default: Date},  // UTC time
                date:           {type: Number, default:0},  // GMT time
                summary:        {type: String, default: ''},
                sunrise:        {type: Number, default:0},  // time
                sunset:         {type: Number, default:0},  // time
                moonphase:      {type: Number, default:0},  // fractional part(0:new moon, 0.25:first quarter moon, 0.5:full moon, 0.75:last quarter moon)
                pre_int:        {type: Number, default:0},  // 강수 강도inches per hour (0, 0.002, 0.017, 0.1, 0.4)
                pre_intmax:     {type: Number, default:0},  // 시간당 최대 강수량 inches
                pre_intmaxt:    {type: Number, default:0},  // 최대 강수 시간
                pre_pro:        {type: Number, default:0},  // 강수 유/무 (0 or 1)
                pre_type:       {type: String, default:''}, // rain, snow, sleet
                temp_min:       {type: Number, default:0},
                temp_mint:      {type: Number, default:0},
                temp_max:       {type: Number, default:0},
                temp_maxt:      {type: Number, default:0},
                ftemp_min:      {type: Number, default:0},  // 체감온도,
                ftemp_mint:     {type: Number, default:0},
                ftemp_max:      {type: Number, default:0},
                ftemp_maxt:     {type: Number, default:0},
                humid:          {type: Number, default:0},  // 습도 percentage (0 ~ 1)
                windspd:        {type: Number, default:0},  // miles per hour
                winddir:        {type: Number, default:0},  // degrees
                vis:            {type: Number, default:0},  // in miles
                cloud:          {type: Number, default:0},  // percentage (0 ~ 1)
                pres:           {type: Number, default:0},  // millibar
                oz:             {type: Number, default:0}   // dobson unit
            }]
        }
    }]
});

dsForecastSchema.index({"geocode.lat" : 1, "geocode.lon" : 1});

module.exports = mongoose.model('dsForecast', dsForecastSchema);