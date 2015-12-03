/**
 * Created by aleckim on 2015. 12. 3..
 * It makes town.json for client
 */

var fs = require('fs');
var srcName = './utils/data/base.csv';
var dstName = './utils/data/town.json';

var lineList = fs.readFileSync(srcName).toString().split('\n');
var dstList = [];
//remove header
lineList.shift();
//remove last blank line
lineList = lineList.slice(0, lineList.length-1);

function convertJsonObject(list) {
    list.every(function(src){
        var srcArray = src.split(',');
        var jsonObject = {"first":srcArray[0],"second":srcArray[1],"third":srcArray[2],
            "lat":parseInt(srcArray[3]),"long":parseInt(srcArray[4]),"areaNo":parseInt(srcArray[5])};
        //console.log(jsonObject);
        dstList.push(jsonObject);
        return true;
    });

    fs.writeFile(dstName, JSON.stringify(dstList), function (err) {
        if(err) {
            throw err;
        }
        console.log('File write completed');
    });
}

convertJsonObject(lineList);

