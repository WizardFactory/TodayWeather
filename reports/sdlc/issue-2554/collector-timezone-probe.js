'use strict';
const fs=require('fs'),vm=require('vm'),crypto=require('crypto');
const file='server/controllers/kma/kma.town.short.rss.controller.js';
const source={baseline:fs.readFileSync('/tmp/issue-2554-response-smoke/baseline-rss.js','utf8'),candidate:fs.readFileSync(file,'utf8')};
const results=[];
for(const [revision,text] of Object.entries(source))for(const timezone of ['UTC','Europe/Berlin','America/Los_Angeles']){
  process.env.TZ=timezone;
  const self={};
  for(const name of ['leadingZeros','calculateTime']){
    const fn=text.match(new RegExp('TownRss\\.prototype\\.'+name+' = (function[\\s\\S]*?\\n});'))[1];
    self[name]=vm.runInNewContext('('+fn+')',{Date});
  }
  results.push({revision,timezone,input:'202609240000',hourOffset:15,actual:self.calculateTime('202609240000',15),functionSha256:crypto.createHash('sha256').update(self.calculateTime.toString()).digest('hex')});
}
console.log(JSON.stringify(results,null,2));
