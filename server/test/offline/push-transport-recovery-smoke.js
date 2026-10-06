'use strict';
// Real HTTP v1 transport and Unix IPC; the local peer alone controls FCM latency.
var assert = require('assert'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
var Dispatcher = require('../../lib/pushCoordinator/dispatcher').Dispatcher, ipc = require('../../lib/pushCoordinator/ipc');
function wait(ms) { return new Promise(function(r){setTimeout(r,ms);}); }
function health(socket) {
    return new Promise(function(resolve,reject){
        var req=http.get({socketPath:socket,path:'/health'},function(res){
            var data='';res.on('data',function(c){data+=c;});res.on('end',function(){resolve({status:res.statusCode,body:JSON.parse(data)});});
        });req.on('error',reject);
    });
}
async function main(){
    var dir=fs.mkdtempSync(path.join(os.tmpdir(),'push-recovery-')), socket=path.join(dir,'ipc.sock'), calls=0, aborted=0, peers=new Set(), hangAt=1, weatherCalls=0, sendOrder=[];
    var provider=http.createServer(function(req,res){
        var body=''; req.on('data',function(c){body+=c;}); req.on('end',function(){
            if(req.url === '/weather') {
                weatherCalls++; res.setHeader('content-type','application/json');
                if(weatherCalls===1) { res.statusCode=503; return res.end('{}'); }
                return res.end('{"weather":"local"}');
            }
            calls++; sendOrder.push(JSON.parse(body).message.data.eventId);
            if(calls===hangAt){res.on('close',function(){aborted++;});return;}
            res.setHeader('content-type','application/json');res.end('{"name":"local-only"}');
        });
    });
    provider.on('connection',function(s){peers.add(s);s.on('close',function(){peers.delete(s);});});
    await new Promise(function(r){provider.listen(0,'127.0.0.1',r);});
    var transport=require('../../lib/pushCoordinator/transport').create({endpoint:'http://127.0.0.1:'+provider.address().port,timeoutMs:50});
    var dispatcher=new Dispatcher({send:transport.send,timeoutMs:150,recoveryMs:40,rate:10000});
    var registry={ready:true}, server=await ipc.listen(socket,registry,dispatcher);
    function job(id){return {priority:'warning',deadline:Date.now()+2000,prepare:async function(){return {
        eventId:id,record:{fcmToken:'LOCAL-TOKEN',cityIndex:0},notification:{title:'Local',text:'Local'},authorization:{projectId:'LOCAL-PROJECT',token:'LOCAL-AUTH'}
    };}};}
    try{
        var initial=await health(socket);assert.equal(initial.status,200);assert(initial.body.ready);assert(initial.body.transport.ready);
        var original=await dispatcher.enqueue(job('original'));assert.equal(original.error,'transport-timeout-ambiguous');assert.equal(original.attempts,1);
        await wait(10);assert.equal(aborted,1);assert.equal(dispatcher.inflight,0);
        var paused=await health(socket);assert(paused.body.ready);assert(!paused.body.transport.ready);assert.equal(paused.body.transport.paused,1);
        assert(!JSON.stringify(paused.body).includes('LOCAL-'));
        var fresh=await dispatcher.enqueue(job('fresh'));assert.equal(fresh.status,'accepted');assert.equal(calls,2);
        var restored=await health(socket);assert(restored.body.transport.ready);assert.equal(dispatcher.metrics.recoveries,1);
        // Combine preparation retry, token-generation repair, transport recovery and warning priority.
        var base=require('./push-s3.test'), Engine=require('../../lib/pushCoordinator/engine').Engine;
        var storage=base.memory(), registrations=await base.registry(storage), slot=Math.floor(Date.now()/60000)*60000;
        var time=new Date(slot), pushTime=(time.getUTCHours()*60+time.getUTCMinutes())*60;
        await registrations.upsert([base.record({category:'alarm',pushTime:pushTime})]);await registrations.settled();
        var record=Array.from(registrations.records.values())[0];
        var weather=require('../../lib/pushCoordinator/weatherSource').create({concurrency:2});
        var runtime={alarm:async function(r,context){
            await weather.get('http://127.0.0.1:'+provider.address().port+'/weather','ko',context.deadline);
            return {title:'Local integrated',text:'Local'};
        },authorize:async function(){return {projectId:'LOCAL-PROJECT',token:'LOCAL-AUTH'};}};
        var engine=new Engine({registry:registrations,storage:storage,dispatcher:dispatcher,runtime:runtime});
        dispatcher.prepareRetry=5;hangAt=3;
        var campaign=await engine.create('combined-original','alarm',[record.ref],null,slot);
        await engine.admit(campaign);await dispatcher.idle();await engine.flush();
        assert.equal(campaign.jobs[0].reason,'transport-timeout-ambiguous');assert.equal(campaign.jobs[0].attempts,1);
        assert.equal(campaign.jobs[0].preparationAttempts,2);assert.equal(weatherCalls,2);
        engine.setState(record.ref,{disabled:true,generation:record.generation});
        await registrations.upsert([base.record({category:'alarm',pushTime:pushTime})]);await registrations.settled();
        assert(!engine.eligible(campaign,registrations.get(record.ref)));
        await registrations.rotate('token1','rotated-local-token');await registrations.settled();
        assert(engine.eligible(campaign,registrations.get(record.ref)));
        var newCampaign=await engine.create('combined-fresh','alarm',[record.ref],null,slot);
        var urgent=dispatcher.enqueue(job('combined-warning'));await engine.admit(newCampaign);
        await dispatcher.idle();assert.equal((await urgent).status,'accepted');await engine.flush();
        assert.equal(newCampaign.jobs[0].status,'accepted');assert.equal(calls,5);
        assert.deepEqual(sendOrder.slice(2),['combined-original','combined-warning','combined-fresh']);
        assert(dispatcher.health().ready);assert.equal(weatherCalls,2,'successful shared weather is reused');
        registry.ready=false;assert.equal((await health(socket)).status,503);
        console.log(JSON.stringify({passed:true,transportAttempts:calls,combinedPreparationAttempts:campaign.jobs[0].preparationAttempts,
            combinedTokenRepair:true,warningBeforeFreshAlarm:true,originalAttempts:original.attempts,abortedRequests:aborted,
            originalReason:original.error,registrationReadyDuringPause:paused.body.ready,transportReadyDuringPause:paused.body.transport.ready,
            transportReadyAfterRecovery:restored.body.transport.ready}));
    }finally{
        dispatcher.close();transport.close();peers.forEach(function(s){s.destroy();});
        await Promise.all([new Promise(function(r){server.close(r);}),new Promise(function(r){provider.close(r);})]);
        if(fs.existsSync(socket))fs.unlinkSync(socket);fs.rmdirSync(dir);
    }
}
main().catch(function(e){console.error(e.stack);process.exitCode=1;});
