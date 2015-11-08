/**
 * Created by User on 2015-10-26.
 */

var mongoose = require('mongoose');
var config = require('../config/config');
var targetName = './utils/data/region.csv';

mongoose.connect(config.db.path, config.db.options);

var fs = require('fs');


var midLandSchema = new mongoose.Schema({
    town: {
        first: String,
    },
    regId : String
});

var midTempSchema = new mongoose.Schema({
    town: {
        first: String,
        second: String,
    },
    regId : String
});

var midLandList = [
    {name: '경기도', code: '11B00000'},
    {name: '서울특별시', code: '11B00000'},
    {name: '인천광역시', code: '11B00000'},
    {name: '강원도 영서', code: '11D10000'},
    {name: '강원도 영동', code: '11D20000'},
    {name: '대전광역시', code: '11C20000'},
    {name: '세종특별자치시', code: '11C20000'},
    {name: '충청남도', code: '11C20000'},
    {name: '충청북도', code: '11C10000'},
    {name: '광주광역시', code: '11F20000'},
    {name: '전라남도', code: '11F20000'},
    {name: '전라북도', code: '11F10000'},
    {name: '대구광역시', code: '11H10000'},
    {name: '경상북도', code: '11H10000'},
    {name: '부산광역시', code: '11H20000'},
    {name: '울산광역시', code: '11H20000'},
    {name: '경상남도', code: '11H20000'},
    {name: '제주도', code: '11G00000'}
];

var midTempList = fs.readFileSync(targetName).toString().split('\r\n');

//var midNameList = ['midLand', 'midTemp', 'midSea'];
var midLandDoc = mongoose.model('midLand', midLandSchema);
var midTempDoc = mongoose.model('midTemp', midTempSchema);

function createMidLandDoc(){
    midLandList.forEach(function(line, idx){
        var doc = new midLandDoc();
        doc.town.first = line.name;
        doc.regId = line.code;

        doc.save(function(err){
            if(err) process.exit(1);
            if(idx + 1 == midLandList.length) process.exit(0);
        });
    });
}

function createMidTempDoc(){
    midTempList.forEach(function(line, idx){
        var doc = new midTempDoc();
        line.split(',').forEach(function(entry, i){
            if(i === 0) {doc.town.first = entry; }
            else if(i === 1) {doc.town.second = entry;}
            else if(i === 4) {doc.regId = entry;}
        })

        doc.save(function(err){
            if(err) process.exit(1);
            if(idx + 1 == midTempList.length) process.exit(0);
        });
    });
}

function run(){
    createMidLandDoc();
    createMidTempDoc();
}

run();

