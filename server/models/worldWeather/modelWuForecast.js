/**
 * Created by Peter on 2016. 5. 20..
 */
var mongoose = require("mongoose");

var wuForecastSchema = new mongoose.Schema({
    geocode: {lat: Number, lon: Number},
    address: {country:String, city:String, zipcode:Number, postcode:Number},
    date:    {type: Number, default: 0},                    // YYYYMMDDHHMM
    dateObj: {type: Object, default: Date},                 // UTC time
    days:[{
        summary :{
            dateObj:    {type: Object, default: Date},      // UTC time
            date:       {type : Number, default:0},         // GMT YYYYMMDD
            sunrise:    {type : Number, default:-100},      // HHMM or HMM
            sunset:     {type : Number, default:-100},      // HHMM or HMM
            moonrise:   {type : Number, default:-100},      // HHMM or HMM
            moonset:    {type : Number, default:-100},      // HHMM or HMM
            tmax:       {type : Number, default:-100},
            tmin:       {type : Number, default:-100},
            precip:     {type : Number, default:-100},      // millimeters, total 강수량 (rain + snow + etc)
            rain:       {type : Number, default:-100},      // millimeters
            snow:       {type : Number, default:-100},      // millimeters
            prob:       {type : Number, default:-100},      // percent, 강수 확율
            humax:      {type : Number, default:-100},      // percent, 최대 습도
            humin:      {type : Number, default:-100},      // percent, 최저 습도
            windspdmax: {type : Number, default:-100},      // metres per second, 최대 풍속
            windgstmax: {type : Number, default:-100},      // metres per second, 최대 돌풍 풍속
            slpmax:     {type : Number, default:-100},      // millibars, max sea level pressure
            slpmin:     {type : Number, default:-100}       // millibars, min sea level presure
        },
        forecast : [{
            dateObj:    {type: Object, default: Date},      // UTC time
            date:       {type : Number, default:0},         // GMT YYYYMMDD,
            time:       {type : Number, default:0},         // GMT HHMM or HMM
            utcDate:    {type : Number, default:0},         // YYYYMMDD,,
            utcTime:    {type : Number, default:0},         // HHMM
            desc:       {type : String, default:''},        //
            code:       {type : Number, default:-100},      //
            tmp:        {type : Number, default:-100},      //
            ftmp:       {type : Number, default:-100},      // 체감 온도
            winddir:    {type : Number, default:-100},      // degree(0~360), 풍향
            windspd:    {type : Number, default:-100},      // metres per second
            windgst:    {type : Number, default:-100},      // metres per second
            cloudlow:   {type : Number, default:-100},      // percent, low level cloud
            cloudmid:   {type : Number, default:-100},      // percent, mid level cloud
            cloudhigh:  {type : Number, default:-100},      // percent, high level cloud
            cloudtot:   {type : Number, default:-100},      // percent  total cloud
            precip:     {type : Number, default:-100},      // millimeters, total 강수량
            rain:       {type : Number, default:-100},      // millimeters
            snow:       {type : Number, default:-100},      // millimeters
            fsnow:      {type : Number, default:-100},      // centimetres, fresh snowfall - if accumulated
            prob:       {type : Number, default:-100},      // percent, 강수 확율
            humid:      {type : Number, default:-100},      // percent, 습도
            dewpoint:   {type : Number, default:-100},      // celcius, 이슬점
            vis:        {type : Number, default:-100},      // kilometers, 가시거리
            splmax:     {type : Number, default:-100}       // millibars, sea level pressure
        }]
    }]
});

wuForecastSchema.index({"geocode.lat" : 1, "geocode.lon" : 1});

module.exports = mongoose.model('wuForecast', wuForecastSchema);
