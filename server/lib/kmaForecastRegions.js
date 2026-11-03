/** data.go.kr 15058629 guide241128, station workbook category 개황, rows2–11. */
'use strict';
var offices = [
    {stationId:108, region:'전국', provinces:[]},
    {stationId:109, region:'서울·인천·경기도', provinces:['서울특별시','서울','인천광역시','인천','경기도','경기']},
    {stationId:159, region:'부산·울산·경상남도', provinces:['부산광역시','부산','울산광역시','울산','경상남도','경남']},
    {stationId:143, region:'대구·경상북도', provinces:['대구광역시','대구','경상북도','경북']},
    {stationId:156, region:'광주·전라남도', provinces:['광주광역시','광주','전라남도','전남','전남광주통합특별시']},
    {stationId:146, region:'전북특별자치도', provinces:['전라북도','전북특별자치도','전북자치도','전북']},
    {stationId:133, region:'대전·세종·충청남도', provinces:['대전광역시','대전','세종특별자치시','세종','충청남도','충남']},
    {stationId:131, region:'충청북도', provinces:['충청북도','충북']},
    {stationId:105, region:'강원특별자치도', provinces:['강원도','강원특별자치도','강원']},
    {stationId:184, region:'제주특별자치도', provinces:['제주특별자치도','제주도','제주']}
];
function byStation(id) {
    return offices.find(function (office) { return office.stationId === Number(id); }) || null;
}
function forProvince(name) {
    if (typeof name !== 'string') { return null; }
    return offices.find(function (office) { return office.provinces.indexOf(name.trim()) >= 0; }) || null;
}
module.exports = {offices:offices, byStation:byStation, forProvince:forProvince};
