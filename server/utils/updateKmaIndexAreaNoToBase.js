/**
 * Created by aleckim on 2016. 3. 28..
 * base.csv파일에 areaNo를 갱신함.
 */

var fs = require('fs');
var targetName = './utils/data/base.csv';
var indexList = fs.readFileSync('./utils/data/KMA_INDEX_AREA_NO.csv').toString().split('\n');
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

                //console.log('['+parseInt(area[3])+']['+parseInt(base[5])+']');
                if (base[5] == undefined) {
                    base[3] = parseFloat(base[3]).toString();
                    base[4] = parseFloat(base[4]).toString();
                    base[5] = parseInt(area[3]).toString();
                    baseList[i] = base.toString();
                    console.log('insert areaNo base='+base.toString());
                }
                else if (parseInt(base[5]) != parseInt(area[3])) {
                    base[3] = parseFloat(base[3]).toString();
                    base[4] = parseFloat(base[4]).toString();
                    base[5] = parseInt(area[3]).toString();
                    baseList[i] = base.toString();
                    console.log('update areaNo base='+base.toString());
                }
                //console.log(base.toString());
                return;
            }
        }
        if (i >= baseList.length) {
            //if use base.csv, have to push new data
            var baseStr = area[0]+","+area[1]+","+area[2]+","+"0,0,"+parseInt(area[3]).toString();
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

