/**
 * Created by User on 2015-11-01.
 */

var fs = require('fs');

var MidTownToCode = function() {
    var self = this;
    self.genMidTownList = [];
    self.codeTownList = [
        {first: '서울특별시', second: '종로구', third: '가회동', code: '11B10101'}, // 서울
        {first: '인천광역시', second: '부평구', third: '갈산1동', code: '11B20201'}, // 경기 서부
        {first: '경기도', second: '수원시권선구', third: '곡선동', code: '11B20601'}, // 경기 남부
        {first: '경기도', second: '파주시', third: '법원읍', code: '11B20305'}, // 경기 북부

        {first: '강원도', second: '춘천시', third: '강남동', code: '11D10301'}, // 강원 서부
        {first: '강원도', second: '원주시', third: '개운동', code: '11D10401'}, // 강원 남서
        {first: '강원도', second: '강릉시', third: '강남동', code: '11D20501'}, // 강원 동부

        {first: '대전광역시', second: '동구', third: '가양1동', code: '11C20401'}, // 충남
        {first: '충청남도', second: '서산시', third: '대산읍', code: '11C20101'}, // 충남 서부

        {first: '충청북도', second: '청주시상당구', third: '금천동', code: '11C10301'}, // 충북
        {first: '세종특별자치시', second: '세종특별자치시', third: '금남면', code: '11C20404'}, // 충북 서부

        {first: '광주광역시', second: '광산구', third: '도산동', code: '11F20501'}, // 전남 북부
        {first: '전라남도', second: '여수시', third: '광림동', code: '11F20401'}, // 전남 남부
        {first: '전라남도', second: '목포시', third: '대성동', code: '21F20801'}, // 전남 서부

        {first: '전라북도', second: '군산시', third: '개정동', code: '21F10501'}, // 전북 서부
        {first: '전라북도', second: '전주시덕진구', third: '금암1동', code: '11F10201'}, // 전북

        {first: '부산광역시', second: '강서구', third: '가덕도동', code: '11H20201'}, // 경남
        {first: '울산광역시', second: '남구', third: '달동', code: '11H20101'}, // 경남 동부
        {first: '경상남도', second: '창원시 마산합포구', third: '가포동', code: '11H20301'}, // 경남 서부

        {first: '대구광역시', second: '남구', third: '이천동', code: '11H10701'}, // 경북
        {first: '경상북도', second: '안동시', third: '강남동', code: '11H10501'}, // 경북 북부
        {first: '경상북도', second: '포항시남구', third: '구룡포읍', code: '11H10201'}, // 경북 동부

        {first: '제주특별자치도', second: '제주시', third: '건입동', code: '11G00201'}, // 제주 북부
        {first: '제주특별자치도', second: '서귀포시', third: '남원읍', code: '11G00401'} // 제주 남부
    ];

    self.initList = function(){
        var midTownList = fs.readFileSync('../utils/data/region.csv').toString().split('\r\n');
        var midTown = {
            first : '',
            second : '',
            code : ''
        };
        midTownList.forEach(function(elem, i){
            elem.split(',').forEach(function (value, idx) {
                if(idx === 0) midTown.first = value;
                else if(idx === 1) midTown.second = value;
                else if(idx === 4) midTown.code = value;
            });
            self.genMidTownList.push(JSON.parse(JSON.stringify(midTown)));
        });
    }

};

MidTownToCode.prototype.getTown = function (first, second) {
    var self = this;
    if(self.genMidTownList == [] || self.genMidTownList.length == 0){
        self.initList();
    }

    for(var i = 0 ; i < self.genMidTownList.length ; i++){
        if(self.genMidTownList[i].first == first && self.genMidTownList[i].second == second){
            for(var j = 0 ; j < self.codeTownList.length ; j ++){
                if(self.codeTownList[j].code == self.genMidTownList[i].code){
                    return self.codeTownList[j];
                }
            }
        }
    }
}
MidTownToCode.prototype.getCode  =  function(first, second){
    var self = this;
    if(self.genMidTownList == [] || self.genMidTownList.length == 0){
        self.initList();
    }

    for(var i = 0 ; i < self.genMidTownList.length ; i++){
        if(self.genMidTownList[i].first == first && self.genMidTownList[i].second == second){
            return self.genMidTownList[i].code;
        }
    }
}

MidTownToCode.prototype.getCodeWithRegId = function(regId){
    var self = this;
    for(var i = 0 ; i < self.codeTownList.length ; i ++) {
        var elem = self.codeTownList[i];
        if (regId == elem.code) return elem;
    }
}

module.exports = MidTownToCode;
