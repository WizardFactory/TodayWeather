'use strict';

// Districts used to resolve the combined province against legacy regional datasets.
var gwangju = ['동구', '서구', '남구', '북구', '광산구'];
var jeonnam = ['목포시', '여수시', '순천시', '나주시', '광양시', '담양군', '곡성군', '구례군',
    '고흥군', '보성군', '화순군', '장흥군', '강진군', '해남군', '영암군', '무안군',
    '함평군', '영광군', '장성군', '완도군', '진도군', '신안군'];

module.exports = function provinceForDistrict(district) {
    if (gwangju.indexOf(district) !== -1) return '광주광역시';
    if (jeonnam.indexOf(district) !== -1) return '전라남도';
    return null;
};
