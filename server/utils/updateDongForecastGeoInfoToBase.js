/**
 * Created by aleckim on 2016. 3. 28..
 * base.csv에 정보를 갱신함.
 */

var fs = require('fs');
var targetName = './utils/data/base.csv';
var indexList = fs.readFileSync('./utils/data/DONG_FORECAST_GEO_INFO.csv').toString().split('\n');
var baseList = fs.readFileSync(targetName).toString().split('\n');

function addAreaCodeToBase() {
  //remove head
  indexList.shift();
  indexList.shift();

  baseList.shift();

  //remove last blank line
  baseList = baseList.slice(0, baseList.length-1);

  indexList.forEach(function(indexArea) {
    var area = indexArea.split(',');

    for(var i=0; i<baseList.length; i++) {
      var base = baseList[i].split(',');
      if (base[0] === area[0] &&
          base[1] === area[1] &&
          base[2] === area[2]) {

        base[3] = parseFloat(area[6]).toFixed(7).toString();
        base[4] = parseFloat(area[5]).toFixed(7).toString();
        baseList[i] = base.toString();
        //console.log(base.toString());
        return;
      }
    }
    if (i >= baseList.length) {
      //if use base.csv, have to push new data
      var baseStr = area[0]+","+area[1]+","+area[2]+","+parseFloat(area[6]).toFixed(7).toString()+","+parseFloat(area[5]).toFixed(7).toString();
      console.log("new="+baseStr);
      baseList.push(baseStr);
    }
  });
}

function saveBaseWithAreaCode() {
  baseList.sort();
  baseList.unshift('대분류,중분류,소분류,위도,경도,지점코드');
  fs.writeFile(targetName, baseList.join('\n'), function (err) {
    if(err) {
      throw err;
    }
    console.log('File write completed');
  });
}

addAreaCodeToBase();
saveBaseWithAreaCode();

