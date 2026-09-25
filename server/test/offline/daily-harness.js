'use strict';
const fs = require('node:fs');
const path = require('node:path');
const h = require('./harness');
const root = path.resolve(__dirname,'../..');
const instant = '2026-09-24T07:27:00.000Z';
exports.environment = function(version='2.0', now=instant) {
    class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));} static now(){return new Date(now).getTime();}}
    const logs=[], log=h.logger(logs), config={db:{version},keyString:{dongnae_forecast_keys:'[]'}};
    const policy=h.load('lib/midForecastPolicy.js',{}, {Date:Clock});
    const time=h.load('lib/kmaTimeLib.js',{}, {Date,log});
    const globals={Date:Clock,log,commonString:['date','time'],forecastString:['wfsv','cnt'],seaString:[],
        manager:{getRegIdByTown:(r,c,cb)=>cb(null,{pointNumber:'109',cityCode:'11B10101'})}};
    const models={};
    function model(name) {
        if(models[name]) return models[name];
        // Real Mongoose schema/casting, with only persistence/query boundaries stubbed.
        const file=name.startsWith('model')?'models/'+name+'.js':'models/kma/'+name+'.js';
        const mongoose=require('mongoose');
        const ctor=h.load(file,{mongoose:{Schema:mongoose.Schema,model:(n,s)=>mongoose.models[n]||mongoose.model(n,s)}});
        const docs=[];
        ctor.prototype.save=function(cb){docs.splice(0,docs.length,this);cb(null);};
        ctor.update=function(query,doc,opts,cb){docs.splice(0,docs.length,new ctor(doc));cb(null);};
        ctor.remove=function(){return {exec(){}};};
        ctor.find=function(query,projection,cb){
            const q={limit(){return q;},lean(){return q;},sort(){return q;},exec(callback){callback(null,docs.map(d=>d.toObject()));}};
            if(typeof projection==='function')projection(null,docs);
            if(cb)cb(null,docs);
            return q;
        };
        ctor.docs=docs; models[name]=ctor;return ctor;
    }
    function load(relative, extra={}) {
        const deps={};
        const code=fs.readFileSync(path.join(root,relative),'utf8');
        for(const m of code.matchAll(/require\('([^']+)'\)/g)) deps[m[1]]=function Unexpected(){throw new Error('Unexpected collaborator '+m[1]);};
        for(const key of Object.keys(deps)) {
            if(key.includes('/models/modelMid') || /\/models\/kma\/kma.town.mid.(forecast|land|sea|temp).model/.test(key)) deps[key]=model(path.basename(key,'.js'));
            if(key.endsWith('/config/config'))deps[key]=config;
            if(key.endsWith('/kmaTimeLib'))deps[key]=time;
            if(key.endsWith('/midForecastPolicy'))deps[key]=policy;
            if(key==='async')deps[key]=require('async');
            if(key==='sprintf')deps[key]=require('sprintf');
            if(key==='dnscache')deps[key]=()=>{};
            if(key==='xml2js')deps[key]=require('xml2js');
            if(key==='events')deps[key]=require('events');
            if(/kma.town.(current|short|shortest|mid|short.rss).controller.js$/.test(key) || /midRssKmaRequester|kecoRequester|lifeIndexKmaRequester/.test(key))deps[key]=function(){};
        }
        return h.load(relative,Object.assign(deps,extra),globals);
    }
    const Mid=load('controllers/kma/kma.town.mid.controller.js');
    const mid=new Mid();
    const Town=load('controllers/controllerTown.js',{'./kma/kma.town.mid.controller.js':Mid});
    const town=new Town();
    const Manager=load('controllers/controllerManager.js');
    // Constructor initializes regional reference data; only real persistence methods are needed.
    const manager=Object.create(Manager.prototype); manager.kmaTownMid=mid;manager.saveOnlyLastOne=true;
    const Rss=load('controllers/kma/kma.town.mid.rss.controller.js');
    return {load,model,models,manager,mid,town,policy,time,logs,Rss,Clock};
};
exports.temperature = function(date='20260924',time='0600',start=4) {
    const record={regId:'11B10101',date,time,pubDate:date+time};
    for(let d=start;d<=10;d++){record['taMin'+d]=10+d;record['taMax'+d]=20+d;}
    return record;
};
