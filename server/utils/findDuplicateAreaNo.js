/**
 * Created by aleckim on 2016. 3. 28..
 * 파일내에서 areaNo가 중복되는 것을 찾음.
 */

var fs = require('fs');
var indexList = fs.readFileSync('./utils/data/base.csv').toString().split('\n');
var areaNoKmaList = fs.readFileSync('./utils/data/areaNoKma.csv').toString().split('\n');

function findDuplicateAreaNo() {

    //remove head
    indexList.shift();
    areaNoKmaList.shift();

    indexList.forEach(function(indexArea, index) {
        var area = indexArea.split(',');
        //console.log('areaNo='+area[5]);
        if (area[5] == undefined) {
            console.log(area.toString());
            return;
        }

        for (var i=0; i<indexList.length; i++) {
            if (i == index) {
                continue;
            }
            var target = indexList[i].split(',');
            if (area[5] == target[5]) {
                var isArea = false;
                for (var j=0; j<areaNoKmaList.length; j++) {
                   var ori = areaNoKmaList[j].split(',');
                    if (area[0] === ori[0] &&
                        area[1] === ori[1] &&
                        area[2] === ori[2]) {
                        //console.log('target index='+i+' remove='+target.toString());
                        break;
                    }
                    if (ori[0] === target[0] &&
                        ori[1] === target[1] &&
                        ori[2] === target[2]) {
                        //console.log('area index='+index+'remove='+area.toString());
                        isArea = true;
                        break;
                    }
                }
                if (isArea) {
                   area = area.slice(0,5);
                }
            }
        }
        console.log(area.toString());
    });
}

findDuplicateAreaNo();
