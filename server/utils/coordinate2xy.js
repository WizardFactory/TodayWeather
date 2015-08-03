/**
 * Created by Peter on 2015. 8. 2..
 */
"use strict";
/*
 *   Change value : location(x, y) <-> Coordinate(lon, lat)
 *   Usage :
 *       var coordi = {
 *           lon: 127.1201305,
 *           lat: 37.37258333
 *       };
 *       var loc = {
 *           x: 62,
 *           y: 123
 *       };
 *
 *       var conv = new conventer(coordi, loc).toLocation();
 *       console.log(conv.getLocation());
 *       console.log(conv.toCoordinate(loc).getCoordinate());
 * */
var MAX_X = 149;
var MAX_Y = 253;

var mapInfo = {
    Re: 6371.00877,
    grid: 5.0,
    slat1: 30.0,
    slat2: 60.0,
    olon: 126.0,
    olat: 38.0,
    xo: 42.0,//210/5,
    yo: 135.0,//675/5,
    first: 0
};

function Converter(coordinate, location){
    if(coordinate !== undefined){
        //console.log(coordinate);
        this.coordinate = coordinate;
    }
    if(location !== undefined){
        //console.log(location);
        this.location = location;
    }
    this.map = mapInfo;
    return this;
}

Converter.prototype.lamcproj = function(lon, lat, x, y, code, map){
    var PI, DEGRAD, RADDEG;
    var re, olon, olat, sn, sf, ro;
    var slat1, slat2, alon, alat, xn, yn, ra, theta;
    var result = {};

    //console.log('lamcproj : lon(' + lon + ') lat(' + lat + ') x(%d) y(%d) code(%d)',x, y, code);
    if(map.first === 0){
        PI = Math.asin(1.0)*2.0;
        DEGRAD = PI/180.0;
        RADDEG = 180.0/PI;

        re = map.Re/map.grid;
        slat1 = map.slat1 * DEGRAD;
        slat2 = map.slat2 * DEGRAD;
        olon = map.olon * DEGRAD;
        olat = map.olat * DEGRAD;

        sn = Math.tan(PI*0.25 + slat2 * 0.5)/Math.tan(PI * 0.25 + slat1 * 0.5);
        sn = Math.log(Math.cos(slat1)/Math.cos(slat2))/Math.log(sn);
        sf = Math.tan(PI * 0.25 + slat1 * 0.5);
        sf = Math.pow(sf, sn) * Math.cos(slat1)/sn;
        ro = Math.tan(PI * 0.25 + olat * 0.5);
        ro = re * sf / Math.pow(ro, sn);
        //map.first = 1;

        //console.log('some value', PI, DEGRAD, RADDEG, re, slat1, slat2, olon, olat, sn, sf, ro);
    }

    if(code === 0) {
        ra = Math.tan(PI * 0.25 + lat * DEGRAD * 0.5);
        ra = re * sf / Math.pow(ra, sn);
        theta = lon * DEGRAD - olon;
        if(theta > PI) {
            theta -= 2.0 * PI;
        }
        if(theta < -(PI)) {
            theta += 2.0 * PI;
        }
        theta *= sn;

        x = (ra * Math.sin(theta)) + map.xo;
        y = (ro - ra * Math.cos(theta)) + map.yo;

        result.x = parseInt(x+1.5);
        result.y = parseInt(y+1.5);
        //console.log('changed to location : x(%d) y(%d)', x, y);
    } else {
        xn = x - map.xo;
        yn = ro - y + map.yo;
        ra = Math.sqrt(xn * xn + yn * yn);
        if(sn < 0.0) {
            ra = -ra;
        }

        alat = Math.pow((re * sf / ra), (1.0/sn));
        alat = 2.0 * Math.atan(alat) - PI * 0.5;

        if(Math.abs(xn) <= 0.0){
            theta = 0.0;
        } else {
            if(Math.abs(yn) <= 0.0) {
                theta = PI * 0.5;
                if (xn < 0.0) {
                    theta = -theta;
                }
            } else {
                theta = Math.atan2(xn, yn);
            }
        }

        alon = theta/sn + olon;

        lon = alon * RADDEG;
        lat = alat * RADDEG;

        result.lon = lon;
        result.lat = lat;

        //console.log('changed to coordinate : lon('+ lon +') lat('+ lat +')');
    }

    return result;
};

Converter.prototype.toLocation = function(inputCoordinate, callback){
    var self = this;
    var coordi = {};
    var err = 0;

    if(inputCoordinate !== undefined) {
        coordi = inputCoordinate;
    } else {
        coordi = this.coordinate;
    }

    this.location = self.lamcproj(coordi.lon, coordi.lat, 0, 0, 0, this.map);

    //console.log(this.location);

    if(callback !== undefined){
        callback(err, this.location);
    }

    return this;
};

Converter.prototype.toCoordinate = function(inputLocation, callback) {
    var self = this;
    var loc = {};
    var err = 0;
    if (inputLocation !== undefined) {
        loc = inputLocation;
    } else {
        loc = this.location;
    }

    if (loc.x < 1 || loc.x > MAX_X || loc.y < 1 || loc.y < MAX_Y){
        console.err('location is exceeded over the range');
        err = -1;
    } else {
        this.coordinate = self.lamcproj(0, 0, loc.x, loc.y, 1, this.map);
    }

    //console.log(this.coordinate);

    if(callback !== undefined){
        callback(err, this.coordinate);
    }

    return this;
};

Converter.prototype.getLocation = function(){
    return this.location;
};

Converter.prototype.getCoordinate = function(){
    return this.coordinate;
};

module.exports = Converter; 
