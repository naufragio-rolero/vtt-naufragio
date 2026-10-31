// Local synthetic diagnostic, never a deployment entry point. Requires dev dependencies.
// The worker owns the backend; PNGs, browser-equivalent clients and hashing stay in the parent.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createAssetClient } from '../client/asset-client.js';
import { roomFixture } from '../tests/room-helpers.js';
import { rawSocket,connect,prove,localAuthority,waitFor } from '../tests/token-helpers.js';
import { largePng } from './large-png.js';

if(process.argv[2]==='--worker'){
  const cleanups=[];let fixture,timer,peak=process.memoryUsage().rss,start=performance.now();
  const metrics=()=>({node:process.version,peakRssMiB:Math.round(Math.max(peak,process.resourceUsage().maxRSS*1024)/1048576),rssMiB:Math.round(process.memoryUsage().rss/1048576),cpuMs:Math.round((process.cpuUsage().user+process.cpuUsage().system)/1000),elapsedMs:Math.round(performance.now()-start)});
  process.on('message',async message=>{
    try{
      let data;
      if(message.op==='setup'){
        fixture=await roomFixture({after:fn=>cleanups.push(fn)});
        const second=await fixture.account('resource-second','user');fixture.admit(fixture.member);fixture.admit(second);
        timer=setInterval(()=>{peak=Math.max(peak,process.memoryUsage().rss);},50);
        data={url:fixture.url,created:{room:{id:fixture.created.room.id}},accounts:[fixture.director,fixture.member,second].map(s=>({token:s.token,user:{id:s.user.id}})),metrics:metrics()};
      }else if(message.op==='metrics')data=metrics();
      else if(message.op==='close'){
        clearInterval(timer);for(const close of cleanups.reverse())await close();
        assert.equal(fixture.app.server.listening,false);assert.equal(fixture.app.io.engine.clientsCount,0);data=metrics();
      }else throw new Error('UNKNOWN_COMMAND');
      process.send({id:message.id,data},()=>{if(message.op==='close')process.disconnect();});
    }catch{process.send({id:message.id,error:'PROBE_WORKER_FAILED'});}
  });
  process.on('disconnect',()=>{clearInterval(timer);void fixture?.app.close();});
}else{
  const worker=fork(new URL(import.meta.url),['--worker'],{execArgv:[],stdio:['ignore','ignore','ignore','ipc']}),exited=once(worker,'exit'),pending=new Map(),cleanups=[],assets=[],failures=[];
  let sequence=0,healthTimer,healthPending=Promise.resolve(),report;
  worker.on('message',message=>{const task=pending.get(message.id);if(!task)return;pending.delete(message.id);clearTimeout(task.timer);message.error?task.reject(new Error(message.error)):task.resolve(message.data);});
  function command(op){return new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('PROBE_WORKER_TIMEOUT'));},30000);pending.set(id,{resolve,reject,timer});worker.send({id,op});});}
  try{
    const f=await command('setup'),[owner,...members]=f.accounts,roomId=f.created.room.id;
    const director=rawSocket({after:fn=>cleanups.push(fn)},f,owner),png=largePng(),image=new Blob([png],{type:'image/png'}),sha256=createHash('sha256').update(png).digest('hex');
    const publisher=createAssetClient(director,{roomId,director:true,getSource:async id=>id==='map'?image:null,onError:e=>failures.push(e)});assets.push(publisher);
    await connect(director);const authority=await prove(director,localAuthority());await waitFor(()=>publisher.epoch===authority.epoch);
    const completed=new Map();
    for(const member of members){const socket=rawSocket({after:fn=>cleanups.push(fn)},f,member);const client=createAssetClient(socket,{roomId,onUpdate:({blobs})=>{if(blobs.has('map'))completed.set(member.user.id,blobs.get('map'));},onError:e=>failures.push(e)});assets.push(client);await connect(socket);}
    const latencies=[];let probing=false;
    healthTimer=setInterval(()=>{if(probing)return;probing=true;healthPending=(async()=>{const start=performance.now();const response=await fetch(f.url+'/health',{signal:AbortSignal.timeout(3000)});assert.equal(response.status,200);await response.arrayBuffer();latencies.push(performance.now()-start);})().catch(()=>failures.push('HEALTH_FAILED')).finally(()=>{probing=false;});},500);
    const start=performance.now();
    await publisher.publish({map:{name:'resource-12MiB.png',widthPx:1740,heightPx:1740,widthCells:20,heightCells:20,xCells:-10,yCells:-10,imageId:'map'},tokens:[{id:authority.record.current.tokens[0].id,name:'Synthetic token',color:'#85dcd2',size:1,imageId:null}],files:{map:image}});
    await waitFor(()=>completed.size===2,'two complete PNG copies',120000);clearInterval(healthTimer);await healthPending;
    for(const blob of completed.values())assert.ok(blob.size===png.length&&createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex')===sha256);
    assert.deepEqual(failures,[]);assert.ok(director.connected);assert.ok(latencies.length>0);
    const metrics=await command('metrics');latencies.sort((a,b)=>a-b);
    report={result:'pass',clients:3,bytes:png.length,sha256,transferMs:Math.round(performance.now()-start),backendOnly:metrics,healthSamples:latencies.length,healthMedianMs:Number(latencies[Math.floor(latencies.length/2)].toFixed(2)),healthP95Ms:Number(latencies[Math.floor(latencies.length*.95)].toFixed(2)),errors:0};
  }catch(error){console.error(error.message);process.exitCode=1;}
  finally{
    clearInterval(healthTimer);await healthPending;for(const client of assets)client.close();for(const close of cleanups.reverse())await close();
    try{await command('close');let deadline;try{const status=await Promise.race([exited,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('WORKER_EXIT_TIMEOUT')),5000);})]);assert.equal(status[0],0);}finally{clearTimeout(deadline);}}
    catch{worker.kill();await exited;process.exitCode=1;}
    for(const task of pending.values())clearTimeout(task.timer);pending.clear();
  }
  if(report&&!process.exitCode){report.workerClosed=true;if(process.env.PROBE_REPORT)await writeFile(process.env.PROBE_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
}
