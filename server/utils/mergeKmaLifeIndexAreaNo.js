/**
 * Created by aleckim on 2016. 3. 30..
 * areaNoKma를 KMA_INDEX_AREA_NO.csv에 합침, 추후 업데이트 되면 최신 버전에 KMA_INDEX_AREA_NO를 넣음.
 */

var fs = require('fs');
var targetName = './utils/data/KMA_INDEX_AREA_NO.csv';
var srcList = fs.readFileSync('./utils/data/areaNoKma.csv').toString().split('\n');
var targetList = fs.readFileSync(targetName).toString().split('\n');

srcList.shift();
srcList.shift();
srcList = srcList.slice(0, srcList.length-1);

targetList.shift();
targetList.shift();
targetList = targetList.slice(0, targetList.length-1);

function mergeKmaLifeIndexAreaNo() {
    srcList.forEach(function (src) {
        var srcInfo = src.split(",") ;
        for (var i=0; i<targetList.length; i++) {
            var targetInfo = targetList[i].split(",");
            if (parseInt(srcInfo[5]) === parseInt(targetInfo[3])) {
                break;
            }
        }
        if (i >= targetList.length) {
            console.log("add areaNo ="+src);
            targetList.push(srcInfo[0]+","+srcInfo[1]+","+srcInfo[2]+","+parseInt(srcInfo[5]).toString());
        }
    });

    targetList.forEach(function (target) {
        console.log(target);
    });
}

mergeKmaLifeIndexAreaNo();
