/**
 * Created by Peter on 2016. 8. 13..
 */

var fs = require('fs');
var srcName = './utils/data/citylist.txt';

var lineList = fs.readFileSync(srcName).toString().split('\n');


lineList = lineList.slice(0, lineList.length-1);

function makeAddrList(){
    var addrList = '';

    lineList.forEach(function(item, line){
        var index = line % 6;
        if(line == 0)
            return;
        if(index == 0){
            addrList += '\n';
        }else if(index == 1){
            addrList += item + ',';
        }else if(index == 2){
            addrList += item;
        }else if(index == 3 || index == 4 || index == 5){
            return;
        }
    });

    fs.writeFileSync('./utils/data/cityList.csv', addrList,'utf8');
}

makeAddrList();

