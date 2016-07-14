/**
 * Created by aleckim on 2016. 3. 29..
 * invalidAreaNo list에 있는 라인 제외하고 출력.
 */

var invalidAreaNoList = [1114063000,
    2623053000,
    2711052000,
    2723064000,
    2729051000,
    2820068000,
    3611010600,
    4113352000,
    2626053000,
    1114064000,
    2629065000,
    2729054000,
    3111056000,
    1114062000,
    4119754000,
    4518056000,
    4315053500,
    4313038000,
    2711051500,
    2729053000,
    2644057000,
    2629064000,
    1114061000,
    4148025900,
    2818581000,
    2623073000,
    2729052000,
    2723065000,
    2623062000,
    2623069000,
    4691043000,
    4817053000,
    4817054500,
    3020054800,
    5019000000,
    4822063000,
    4825031000,
    4113554500,
    4822069500,
    4161025600,
    4817064500,
    4521056500,
    4413357000,
    4793039000,
    2617064500,
    4313033000,
    2824573000,
    4817057500,
    4822065000,
    4783025300,
    4817061500,
    4817060000,
    4159051000,
    4315057500,
    4315051500,
    4817051000,
    4119753000,
    2626054000,
    4684031000,
    4817052000,
    4315052500,
    4822066000,
    4817059000,
    4315054500,
    4415035000,
    1114066000,
    4793040000,
    1171064700,
    4873037000,
    1135060500,
    2820067000,
    2629052000,
    1111066000,
    4157032000];


var fs = require('fs');

var indexList = fs.readFileSync('./utils/data/areaNoKma.csv').toString().split('\n');
//var indexList = fs.readFileSync('./utils/data/KMA_INDEX_AREA_NO.csv').toString().split('\n');

indexList.shift();
indexList.shift();
indexList = indexList.slice(0, indexList.length - 1);

function checkInvalidLifeIndex() {
   indexList.forEach(function (areaInfo) {
       var area = areaInfo.split(",");
       var areaNo;
       if (area.length <=4) {
           areaNo = parseInt(area[3]);
       }
       else {
           areaNo = parseInt(area[5]);
       }

       for (var i=0; i<invalidAreaNoList.length; i++) {
          if (areaNo === invalidAreaNoList[i]) {
              return;
          }
       }

       console.log(areaInfo);
   }) ;
}

checkInvalidLifeIndex();
