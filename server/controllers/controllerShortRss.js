/**
 * Created by Peter on 2015. 10. 23..
 *
 * 동네예보 RSS 요청 주 소: http://www.kma.go.kr/wid/queryDFS.jsp?
 * 요청 방식
 *      1. mx, my를 이용하는 방법 : 뒤에 gridx=mx, gridy=my 를 넣어서 request.
 *          ex)http://www.kma.go.kr/wid/queryDFS.jsp?gridx=59&gridy=125
 *      2. AreaNo를 이용하는 방법 : 뒤에 zone=AreaNo 를 넣어서 request
 *          ex)http://www.kma.go.kr/wid/queryDFSRSS.jsp?zone=1159068000
 * 주의 : 두가지 요청방식에 따라 response 형식이 다르니 주의 해야한다
 */
"use strict";
var events = require('events');
var req = require('request');
var config = require('../config/config');
var fs = require('fs');
var convert = require('../utils/coordinate2xy');
var xml2json  = require('xml2js').parseString;
var shortRssDb = require('../models/modelShortRss');
var town = require('../models/town');

/*
*   @constructor
*/
function TownRss(){
    var self = this;

    self.addrGrid = 'http://www.kma.go.kr/wid/queryDFS.jsp';
    self.addrZond = 'http://www.kma.go.kr/wid/queryDFSRSS.jsp';

    self.TIME_PERIOD_TOWN_RSS = (1000*60*60*3);
    self.SUCCESS = 0;
    self.ERROR = -1;
    self.RETRY = -2;

    events.EventEmitter.call(this);

    self.on('recvFail', function(index, item){
        setTimeout(function(){
            self.getData(index, item);
        }, 60 * 1000);
    });

    self.on('recvSuccess', function(index){
        self.receivedCount++;

        if(self.receivedCount == self.coordDb.length){
            log.info('receive complete! : count=', self.receivedCount);
        }
    });

    return self;
}

/*
 *
 */
TownRss.prototype.loadList = function(){
    var self = this;
    self.coordDb = [];

    if(config.db.mode === 'ram'){
        var template = {
            mCoord :{
                    mx : Number,
                    my : Number
                },
            shortData : [
                /*
                {
                ftm: -1,
                date : '',
                temp: -1,
                tmx: -1,
                tmn: -50,
                sky: -1,
                pty: -1,
                wfKor: -1,
                wfEn: -1,
                pop: -1,
                r12: -1,
                s12: -1,
                ws: -1,
                wd: -1,
                wdKor: -1,
                wdEn: -1,
                reh: -1,
                r06: -1,
                s06: -1
                }*/
            ]
        };

        self.townRssDb = [];

        //self.townCoordList = fs.readFileSync('./utils/data/base.csv').toString().split('\n');
        self.townCoordList = fs.readFileSync('./utils/data/part.csv').toString().split('\n');
        self.townCoordList.shift(); // header remove

        self.townCoordList.forEach(function(line, lineNumber){
            var townCoord = {lat: 0, lon: 0};
            line.split(',').forEach(function(item, index){
                if(index === 0){
                }
                else if(index === 1){
                }
                else if(index === 2){
                }
                else if(index === 3){
                    townCoord.lat = item;
                }
                else if(index === 4){
                    townCoord.lon = item;
                }
                if(townCoord.lat != 0 && townCoord.lon != 0) {
                    var isPush = true;
                    var conv = new convert(townCoord, {}).toLocation();
                    template.mCoord.mx = conv.getLocation().x;
                    template.mCoord.my = conv.getLocation().y;

                    //log.info('mx:', template.mCoord.mx, 'my:',template.mCoord.my);

                    for(var i=0 ; i < self.townRssDb.length ; i++){
                        if((self.townRssDb[i].mCoord.mx === template.mCoord.mx) &&(self.townRssDb[i].mCoord.my === template.mCoord.my)){
                            isPush = false;
                            break;
                        }
                    }
                    if(isPush) {
                        self.townRssDb.push(JSON.parse(JSON.stringify(template)));
                    }

                    townCoord.lat = 0;
                    townCoord.lon = 0;
                }
            });
        });
        self.coordDb = self.townRssDb;

        log.info('coord count : ', self.coordDb.length);
        log.info('town count : ', self.townRssDb.length);

    } else{
         town.getCoord(function(err, coordList){
             self.coordDb = coordList;
         });

        log.info('coord count : ', self.coordDb.length);
    }

    return self;
};

/*
 *   @param index
 *   @param url
 *   @param callback
 */
TownRss.prototype.getShortRss = function(index, url, callback){
    var self = this;
    var meta = {};

    meta.method = 'getShortRss';
    meta.url = url;

    log.info('get rss URL : ', url);
    req.get(url, {json:true}, function(err, response, body){
        var statusCode = response.statusCode;
        if(err){
            log.error('failed to req (%d)', index);
            if(callback){
                callback(self.RETRY);
            }
            return;
        }
        if(statusCode === 404 || statusCode === 403){
            log.error('ERROR!!! StatusCode : ', statusCode);
            if(callback){
                callback(self.RETRY);
            }
            return;
        }

        //log.info(body);
        xml2json(body, function(err, result){
            if(err){
                log.error('>>ERROR : failed to converto to json');
                if(callback){
                    callback(self.ERROR);
                }
            }
            try{
                //log.info(result)
                if(callback){
                    callback(self.SUCCESS, result);
                }
            }
            catch(e) {
                log.error('>>ERROR : get exception error in xml2json');
                if(callback){
                    callback(self.ERROR);
                }
            }
        });
    });

    return self;
};
TownRss.prototype.__proto__ = events.EventEmitter.prototype;

TownRss.prototype.leadingZeros = function(n, digits) {
    var zero = '';
    n = n.toString();

    if(n.length < digits) {
        for(var i = 0; i < digits - n.length; i++){
            zero += '0';
        }
    }
    return zero + n;
};

/*
 *   @param cur
 *   @param offset
 *   @return time string
 */
TownRss.prototype.calculateTime = function(cur, offset){
    var self = this;
    var now = new Date(cur.slice(0, 4), cur.slice(4, 6), cur.slice(6, 8), cur.slice(8, 10), cur.slice(10, 12));
    now.setTime(now.getTime() + (offset * 3600000));

    var result =
        self.leadingZeros(now.getFullYear(), 4) +
        self.leadingZeros(now.getMonth() , 2) +
        self.leadingZeros(now.getDate(), 2) +
        self.leadingZeros(now.getHours(), 2) +
        self.leadingZeros(now.getMinutes(), 2);

    return result;
};

/*
 *   @param string
 *   @return Number
 */
TownRss.prototype.convertWeaterString = function(string){
    /* 날씨 요약 : 1.맑음 2.구름조금 3. 구름많음 4.흐림 5.비 6.눈비 7.눈 */
    /* 날씨 요약eng : 1.clear 2.Partly Cloudy 3.Mostly Cloudy 4.Cloudy 5.Rain 6.Snow/Rain 7.Snow */
    /* ① 동(E) ② 북(N) ③ 북동(NE) ④ 북서(NW) ⑤ 남(S) ⑥ 남동(SE) ⑦ 남서(SW) ⑧ 서(W) */
    /* ① E(동) ② N(북) ③ NE(북동) ④ NW(북서) ⑤ S(남) ⑥ SE(남동) ⑦ SW(남서) ⑧ W(서) */
    switch(string){
        case '맑음':
        case 'Clear':
        case '동':
        case 'E':
            return 1;
        case '구름 조금':
        case 'Partly Cloudy':
        case '북':
        case 'N':
            return 2;
        case '구름 많음':
        case 'Mostly Cloudy':
        case '북동':
        case 'NE':
            return 3;
        case '흐림':
        case 'Cloudy':
        case '북서':
        case 'NW':
            return 4;
        case '비':
        case 'Rain':
        case '남':
        case 'S':
            return 5;
        case '눈/비':
        case 'Snow/Rain':
        case '남동':
        case 'SE':
            return 6;
        case '눈':
        case 'Snow':
        case '남서':
        case 'SW':
            return 7;
        case '서':
        case 'W':
            return 8;
        default:
            log.info('convert : ', string);
            return -1;
    }
};

/*
 *   @param index
 *   @param data
 *   @param callback
 *   @return {}
 */
TownRss.prototype.parseShortRss = function(index, data, callback){
    var self = this;
    var dataList = [];
    var coord = {
        mx:0,
        my:0
    };

    //log.info('data:', data);
    //log.info('head:', data.wid.header[0]);
    //log.info('ftm:', data.wid.header[0].tm[0]);
    //log.info('mx:', data.wid.header[0].x[0]);
    //log.info('my:', data.wid.header[0].y[0]);
    //log.info('body:', data.wid.body[0]);
    //log.info('body:', data.wid.body[0].data[0]);

    try{
        coord.mx = parseInt(data.wid.header[0].x[0]);
        coord.my = parseInt(data.wid.header[0].y[0]);
        data.wid.body[0].data.forEach(function(item, index){
            var template = {
                ftm: -1,
                date : '',
                temp: -1,
                tmx: -1,
                tmn: -50,
                sky: -1,
                pty: -1,
                wfKor: -1,
                wfEn: -1,
                pop: -1,
                r12: -1,
                s12: -1,
                ws: -1,
                wd: -1,
                wdKor: -1,
                wdEn: -1,
                reh: -1,
                r06: -1,
                s06: -1
            };
            var hours = parseInt(item.hour[0]);
            var days = parseInt(item.day[0]);

            template.ftm = data.wid.header[0].tm[0];
            template.date = self.calculateTime(template.ftm.slice(0, 8)+ '0000', hours + (days * 24));
            template.temp = parseFloat(item.temp[0]);
            template.tmx = parseFloat(item.tmx[0]);
            template.tmn = parseFloat(item.tmn[0]);
            template.sky = parseFloat(item.sky[0]);
            template.pty = parseFloat(item.pty[0]);
            template.wfKor = self.convertWeaterString(item.wfKor[0]);
            template.wfEn = self.convertWeaterString(item.wfEn[0]);
            template.pop = parseFloat(item.pop[0]);
            template.r12 = parseFloat(item.r12[0]);
            template.s12 = parseFloat(item.s12[0]);
            template.ws = parseFloat(item.ws[0]);
            template.wd = parseFloat(item.wd[0]);
            template.wdKor = self.convertWeaterString(item.wdKor[0]);
            template.wfEn = self.convertWeaterString(item.wfEn[0]);
            template.reh = parseFloat(item.reh[0]);
            template.r06 = parseFloat(item.r06[0]);
            template.s06 = parseFloat(item.s06[0]);

            dataList.push(template);
        });

        dataList.sort(function(a, b){
            if(a.date > b.date){
                return 1;
            }

            if(a.date < b.date){
                return -1;
            }
            return 0;
        });

        //log.info(dataList);
        if(callback){
            callback(self.SUCCESS, {mCoord: coord, shortData: dataList});
        }
    }
    catch(e){
        log.error('parse error! (%d)', index);
        if(callback){
            callback(self.ERROR);
        }
    }
};

/*
 *   @param index
 *   @param data
 */
TownRss.prototype.saveShortRss = function(index, newData){
    var self = this;
    if(config.db.mode === 'ram'){
        var isNewCoord = 1;
        var i = 0;
        //log.info('db count', self.townRssDb.length);
        //log.info(newData);
        for( i=0 ; i < self.townRssDb.length ; i++){
            if(self.townRssDb[i].mCoord.mx === newData.mCoord.mx &&
                self.townRssDb[i].mCoord.my === newData.mCoord.my){
                newData.shortData.forEach(function(newItem) {
                    var isNewItem = 1;
                    for (var j in self.townRssDb[i].shortData) {
                        if (self.townRssDb[i].shortData[j].date === newItem.date){
                            if (self.townRssDb[i].shortData[j].ftm < newItem.ftm) {
                                self.townRssDb[i].shortData[j] = newItem;
                            }
                            isNewItem = 0;
                            break;
                        }
                    }
                    if(isNewItem){
                        self.townRssDb[i].shortData.push(newItem);
                    }
                });
                isNewCoord = 0;

                self.townRssDb[i].shortData.sort(function(a, b){
                    if(a.date > b.date){
                        return 1;
                    }

                    if(a.date < b.date){
                        return -1;
                    }
                    return 0;
                });

                if(self.townRssDb[i].shortData.length > 60){

                }
                log.info('R> ', self.townRssDb[i].shortData);
            }
        }

        if(isNewCoord){
            self.townRssDb.push(newData);
        }

    }
    else{
        shortRssDb.find({mCoord: newData.mCoord}, function(err, list){
            if(err){
                log.error('fail to db item:', err);
                return;
            }

            if(list.length === 0){
                var item = new shortRssDb({mCoord: newData.mCoord, shortData: newData.shortData});
                item.save(function(err){
                    if(err){
                        log.error('fail to save');
                    }
                });
                log.info('> add new item:', newData);
                return;
            }

            list.forEach(function(dbShortList, index){
                log.info(index + ' :XY> ' + dbShortList.mCoord);
                //log.info(index + ' :D> ' + dbShortList.shortData);
                newData.shortData.forEach(function(newItem){
                    var isNew = 1;
                    for(var i in dbShortList.shortData){
                        if(dbShortList.shortData[i].date === newItem.date){
                            if(dbShortList.shortData[i].ftm < newItem.ftm){
                                dbShortList.shortData[i] = newItem;
                            }
                            isNew = 0;
                            break;
                        }
                    }

                    if(isNew){
                        dbShortList.shortData.push(newItem);
                    }
                });

                dbShortList.shortData.sort(function(a, b){
                    if(a.date > b.date){
                        return 1;
                    }

                    if(a.date < b.date){
                        return -1;
                    }
                    return 0;
                });

                dbShortList.save(function(err){
                    if(err){
                        log.error('fail to save');
                    }
                });
            });
        });
    }
};

/*
 *   @param mx
 *   @param my
 *   @return {*} townData
 */
TownRss.prototype.getTownRssDb = function(mx, my){
    var self = this;

    //log.info('search : ', mx, my);
    for(var i in self.townRssDb){
        if(self.townRssDb[i].mCoord.mx === mx && self.townRssDb[i].mCoord.my === my){
            return self.townRssDb[i];
        }
    }
    return {};
};

/*
 *   @param mx
 *   @param my
 *   @return url string
 */
TownRss.prototype.makeUrl = function(mx, my){
    var self = this;

    return self.addrGrid + '?gridx=' + mx + '&gridy=' +my;
};

/*
 * @param item
 * @param index
 */
TownRss.prototype.getData = function(index, item){
    var self = this;
    var url = self.makeUrl(item.mCoord.mx, item.mCoord.my);
    self.getShortRss(index, url, function(err, RssData){
        if(err){
            log.err('failed to get rss (%d)', index);
            if(err == self.RETRY){
                self.emit('recvFail', index, item);
            }
            return;
        }

        self.parseShortRss(index, RssData, function(err, result){
            if(err){
                log.error('failed to parse short rss(%d)', index);
                return;
            }
            self.saveShortRss(index, result, function(err){
                if(err){
                    log.error('failed to save the data to DB');
                    return;
                }
            });
        });
    });
};

/*
 *
 */
TownRss.prototype.mainTask = function(){
    var self = this;
    var gridList = [];


    gridList = self.coordDb;

    self.receivedCount = 0;
    gridList.forEach(function(item, index){
        self.getData(index, item);
    });
};

TownRss.prototype.StartShortRss = function(){
    var self = this;

    self.loadList();
    self.mainTask();

    self.loopTownRssID = setInterval(function() {
        "use strict";

        self.mainTask();

    }, self.TIME_PERIOD_TOWN_RSS);
};

module.exports = TownRss;