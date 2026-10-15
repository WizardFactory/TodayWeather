/** Characterized NIER 09km, 48-hour AirKorea animation layout (2026-10-15). */
'use strict';
var colours = [[105,0,0],[130,0,0],[155,0,0],[180,0,0],[205,0,0],[230,0,0],[255,0,0],
    [255,60,60],[255,90,90],[255,120,120],[255,150,150],[100,100,0],[115,115,0],[131,131,0],
    [146,146,0],[162,162,0],[177,177,0],[193,193,0],[208,208,0],[224,224,0],[240,240,0],
    [0,118,0],[0,138,0],[0,157,0],[0,177,0],[0,195,0],[0,216,0],[0,234,0],[0,254,0],
    [100,254,100],[149,254,149],[53,150,249],[76,162,244],[100,175,240],[135,192,232],[152,201,228]];
// Lower threshold of each colour band; the unbounded top band is capped here.
var thresholds = {
    PM10: [320,280,260,240,220,200,190,180,170,160,151,143,136,129,122,115,108,101,94,87,81,75,70,65,60,55,50,45,40,35,31,24,18,12,6,0],
    PM25: [200,170,160,150,140,120,110,100,90,80,76,70,65,60,55,50,46,42,39,37,36,33,31,29,27,25,23,21,19,17,16,12,9,6,3,0]
};
function invalid() {return new Error('INVALID_IMAGE');}
function number(value) {return value === '' || value == null ? NaN : Number(value);}
function geometry(config) {
    var pos = config.pixel_pos, geo = config.coordi;
    var p = {}, g = {};
    ['left','right','top','bottom'].forEach(function(k) {p[k] = number(pos[k]);});
    ['top_lat','bottom_lat','left_lon','right_lon'].forEach(function(k) {g[k] = number(geo[k]);});
    if (!Object.keys(p).every(function(k) {return Number.isInteger(p[k]);}) ||
        p.left < 0 || p.top < 0 || p.right > 820 || p.bottom > 820 || p.left >= p.right || p.top >= p.bottom ||
        !Object.keys(g).every(function(k) {return Number.isFinite(g[k]);}) ||
        g.top_lat > 90 || g.bottom_lat < -90 || g.left_lon < -180 || g.right_lon > 180 ||
        g.top_lat <= g.bottom_lat || g.left_lon >= g.right_lon) throw invalid();
    return {pos:p,geo:g};
}
function validate(pixels,config) {
    var s = pixels && pixels.shape;
    if (!s || s.length !== 4 || s[0] !== 48 || s[1] !== 820 || s[2] !== 820 || s[3] !== 4 ||
        s[1] !== number(config.size.width) || s[2] !== number(config.size.height)) throw invalid();
    geometry(config);
    var legends = [];
    for (var f=0; f<48; f++) {
        var table = [];
        for (var i=0; i<36; i++) {
            var y = Math.floor(74 + (i+0.5)*701/36);
            var rgb = [0,1,2].map(function(c) {return pixels.get(f,680,y,c);});
            if (pixels.get(f,680,y,3) !== 255 || !rgb.every(function(v,c) {
                return Number.isInteger(v) && v >= 0 && v <= 255 && Math.abs(v-colours[i][c]) <= 4;
            })) throw invalid();
            table.push(rgb);
        }
        legends.push(table);
    }
    return legends;
}
function frameStart(path,type) {
    // Only the observed 23-cycle has frame-label evidence. Unknown cycles fail closed.
    var m = typeof path === 'string' && /^https?:\/\/www\.airkorea\.or\.kr\/dustImage\/(\d{4})\/(\d{2})\/(\d{2})\/23\/09km\/AQF\.(\d{8})\.NIER_09_01\.(PM10|PM2P5)\.2days\.ani\.gif$/.exec(path);
    if (!m || m[4] !== m[1]+m[2]+m[3] || (type === 'PM10' ? m[5] !== 'PM10' : type !== 'PM25' || m[5] !== 'PM2P5')) throw invalid();
    var date = new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])));
    if (date.toISOString().slice(0,10) !== m[1]+'-'+m[2]+'-'+m[3]) throw invalid();
    date.setUTCDate(date.getUTCDate()+1);
    return date.getTime(); // Calendar arithmetic below uses UTC fields as KST wall-clock fields.
}
function station(map,coordinate,lat,lon,type) {
    if (!thresholds[type]) throw invalid();
    var start = frameStart(map.sourcePath,type);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
        lat > coordinate.top_left.lat || lat <= coordinate.bottom_left.lat ||
        lon < coordinate.top_left.lon || lon >= coordinate.top_right.lon) throw new Error('INVALID_STATION_COORDINATE');
    var x = Math.floor((lon-coordinate.top_left.lon)/map.map_pixel_distance_width)+map.map_area.left;
    var y = Math.floor((coordinate.top_left.lat-lat)/map.map_pixel_distance_height)+map.map_area.top;
    var offsets = [[0,0]];
    for (var r=1; r<=3; r++) for (var dx=-r; dx<=r; dx++) for (var dy=-r; dy<=r; dy++) {
        if (Math.max(Math.abs(dx),Math.abs(dy)) === r) offsets.push([dx,dy]);
    }
    var hourly = [];
    for (var f=0; f<48; f++) {
        var row = {date:new Date(start+f*3600000).toISOString().slice(0,16).replace('T',' ')};
        for (var j=0; j<offsets.length; j++) {
            var px=x+offsets[j][0], py=y+offsets[j][1];
            if (px < map.map_area.left || px >= map.map_area.right || py < map.map_area.top || py >= map.map_area.bottom ||
                map.pixels.get(f,px,py,3) !== 255) continue;
            var match = map.legends[f].findIndex(function(rgb) {
                return rgb.every(function(v,c) {return v === map.pixels.get(f,px,py,c);});
            });
            // GIF palettes can quantize the same source shade differently (observed delta <= 4).
            if (match === -1) match = map.legends[f].findIndex(function(rgb) {
                return rgb.every(function(v,c) {return Math.abs(v-map.pixels.get(f,px,py,c)) <= 4;});
            });
            if (match !== -1) {row.val = thresholds[type][match]; break;}
        }
        hourly.push(row);
    }
    return hourly;
}
module.exports = {validate:validate, frameStart:frameStart, station:station};
