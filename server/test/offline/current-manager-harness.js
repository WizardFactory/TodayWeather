'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'../..');
function load(overrides) {
    const filename=path.join(root,'controllers/controllerManager.js');
    const source=fs.readFileSync(filename,'utf8'),deps={};
    for (const match of source.matchAll(/require\('([^']+)'\)/g)) {
        deps[match[1]]=function Unexpected(){throw new Error('Unstubbed '+match[1])};
        if (/^\.\/kma\/kma\.town\.|midRssKmaRequester|kecoRequester|lifeIndexKmaRequester/.test(match[1])) {
            deps[match[1]]=function Inert(){this.remove=()=>{}};
        }
    }
    const log={};for(const name of ['info','error','warn','debug','verbose','silly']){log[name]=()=>{}}
    const config={db:{version:'2.0'},keyString:{dongnae_forecast_keys:'["SYNTHETIC_CURRENT_KEY_A","SYNTHETIC_CURRENT_KEY_B"]'},history:{enabled:false}};
    Object.assign(deps,{'../config/config':config,'../config/gather':require('../../config/gather').load({GATHER_TOWN_RETRY:'1'}),
        async:require('async'),'../lib/dataGoKrKeys':require('../../lib/dataGoKrKeys')},overrides);
    for(const name of ['../lib/currentGridCollection','../lib/forecastTraffic']) {
        const file=path.resolve(root,'controllers',name);
        if(fs.existsSync(file+'.js')&&!Object.prototype.hasOwnProperty.call(overrides,name)){deps[name]=require(file)}
    }
    const module={exports:{}},records=[];
    vm.runInNewContext(source,{module,exports:module.exports,require:name=>{
        if(!Object.prototype.hasOwnProperty.call(deps,name)){throw new Error('Unstubbed '+name)}return deps[name];
    },Date,JSON,Math,Promise,Error,Number,Set,Map,setTimeout,clearTimeout,log,console:{log:s=>records.push(s)}},{filename});
    const m=Object.create(module.exports.prototype);
    return {m,config,records};
}
module.exports={load};
