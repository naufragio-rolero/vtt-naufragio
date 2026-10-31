// Installed-production acceptance, executed locally on Raspberry over loopback.
// All identities are synthetic; no credentials/capabilities are printed.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {io} from 'socket.io-client';
import {createTokenClient} from '/opt/naufragio-vtt/current/backend/client/token-client.js';
import {createAssetClient} from '/opt/naufragio-vtt/current/backend/client/asset-client.js';
import {largePng} from '/opt/naufragio-vtt/current/backend/scripts/large-png.js';
const root='/mnt/ssd/naufragio-vtt/validation',api='http://127.0.0.1:3400',origin='https://naufragio-rolero.github.io';
const sockets=[],tokens=[],assets=[],failures=[],unhandled=[];let stage='login',phase='normal',disconnects=0;
process.on('unhandledRejection',e=>unhandled.push(e?.name||'Error'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=30000){const stop=Date.now()+timeout;while(!fn()){assert.ok(Date.now()<stop,'WAIT_TIMEOUT');await wait(50);}}
async function call(path,body,token,method=body===undefined?'GET':'POST',expected=200){const response=await fetch(api+path,{method,headers:{Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});assert.equal(response.status,expected,'HTTP_STATUS_'+response.status);return response.status===204?null:response.json();}
const report={result:'pending',scope:'installed production backend on SSD; local ARMv7 protocol clients',clients:4,players:3};
let timer,healthPending=Promise.resolve();const healthMs=[];
try{
 const fixture=JSON.parse(await readFile(root+'/fixture.json','utf8'));
 const owner=await call('/auth/login',fixture.director);await call('/auth/me',undefined,owner.token);
 const created=await call('/rooms',{name:'Phase 8 isolated installation'},owner.token,'POST',201),roomId=created.room.id;
 const qr=await call(`/rooms/${roomId}/admission`,{},owner.token);
 const guests=[];
 for(let i=0;i<3;i++){
  const request=await call('/guest-requests',{admissionToken:qr.admission.token,displayName:'Phase8 guest '+i},undefined,'POST',201);
  await call('/guest-requests/claim',{requestToken:request.requestToken},undefined,'POST',403);
  const pending=await call(`/rooms/${roomId}/admission`,undefined,owner.token);
  await call(`/rooms/${roomId}/admission/${pending.requests.find(x=>x.displayName==='Phase8 guest '+i).id}`,{approve:true},owner.token);
  const guest=await call('/guest-requests/claim',{requestToken:request.requestToken});guests.push(guest);
  assert.equal(guest.selected.permissions.moveAssignedTokens,false);
  await call('/rooms',{name:'Forbidden'},guest.token,'POST',403);
 }
 report.authenticationAndQrApproval=true;
 const initial=[{id:randomUUID(),tokenVersion:0,x:0,y:0}];let durable=null;
 const store={async load(){return durable;},async save(value){durable=structuredClone(value);await writeFile(root+'/authority.json',JSON.stringify(value),{mode:0o600});}};
 const snapshots=[];const completed=new Map();let sourceBlob;
 for(const [index,account] of [owner,...guests].entries()){
  const socket=io(api,{autoConnect:false,forceNew:true,reconnection:true,reconnectionDelay:500,transports:index===2?['polling']:['websocket'],extraHeaders:{Origin:origin},auth:{token:account.token,roomId}});sockets.push(socket);socket.on('disconnect',()=>disconnects++);
  tokens.push(createTokenClient(socket,{roomId,director:index===0,store:index===0?store:undefined,initialTokens:index===0?initial:undefined,onChange:state=>snapshots[index]=state}));
  assets.push(createAssetClient(socket,{roomId,director:index===0,getSource:async()=>sourceBlob,onUpdate:({blobs})=>{if(index>0&&blobs.has('map'))completed.set(index,blobs.get('map'));},onError:e=>failures.push(e)}));
  socket.connect();
 }
 await until(()=>tokens.every(c=>c.state.ready&&c.state.snapshot));
 assert.deepEqual(sockets.map(s=>s.io.engine.transport.name),['websocket','websocket','polling','websocket']);report.transports=['websocket','websocket','polling','websocket'];
 stage='installed permissions and movement';
 stage='assign guest';await tokens[0].assign(initial[0].id,[guests[0].user.id]);
 stage='default movement denial';await assert.rejects(tokens[1].move(initial[0].id,{x:1,y:1}),/FORBIDDEN/);
 await call(`/rooms/${roomId}/members/${guests[0].user.id}`,{permissions:{moveAssignedTokens:true}},owner.token,'PATCH');
 await until(()=>!sockets[1].connected);await tokens[1].settled();sockets[1].connect();await until(()=>tokens[1].state.ready);stage='granted movement';await tokens[1].move(initial[0].id,{x:1,y:1});await until(()=>tokens.every(c=>c.state.snapshot?.revision===1));
 await call(`/rooms/${roomId}/members/${guests[0].user.id}`,{permissions:{moveAssignedTokens:false}},owner.token,'PATCH');
 stage='revoked movement denial';await assert.rejects(tokens[1].move(initial[0].id,{x:2,y:2}),/FORBIDDEN/);await until(()=>!sockets[1].connected);await tokens[1].settled();sockets[1].connect();await until(()=>tokens[1].state.ready);report.permissionsAndConvergence=true;
 timer=setInterval(()=>{if(phase!=='normal')return;healthPending=healthPending.then(async()=>{const start=performance.now();await call('/health');healthMs.push(performance.now()-start);}).catch(()=>failures.push('HEALTH_FAILED'));},2000);
 await until(()=>tokens.every(c=>c.state.ready),10000);stage='12 MiB to three players';console.log(JSON.stringify({stage}));
 const png=largePng(),hash=createHash('sha256').update(png).digest('hex');sourceBlob=new Blob([png],{type:'image/png'});
 const source={map:{name:'phase8-12MiB.png',widthPx:1740,heightPx:1740,widthCells:20,heightCells:20,xCells:-10,yCells:-10,imageId:'map'},tokens:[{id:initial[0].id,name:'Synthetic SSD token',color:'#2458a6',size:1,imageId:null}],files:{map:sourceBlob}};
 const start=performance.now();await assets[0].publish(source);await until(()=>completed.size===3,150000);
 for(const blob of completed.values()){assert.equal(blob.size,12582912);assert.equal(createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex'),hash);}
 report.transferMs=performance.now()-start;report.bytes=png.length;report.sha256=hash;
 stage='player reconnection';completed.delete(1);sockets[1].disconnect();await wait(300);sockets[1].connect();await until(()=>completed.has(1),60000);assert.equal(createHash('sha256').update(Buffer.from(await completed.get(1).arrayBuffer())).digest('hex'),hash);report.playerReconnect=true;
 stage='installed unit restart';phase='restarting';const previousDisconnects=disconnects;console.log(JSON.stringify({state:'restart_requested'}));
 await until(()=>disconnects>=previousDisconnects+4,30000);
 await until(()=>tokens.every(c=>c.state.ready&&c.state.snapshot?.revision===1),60000);
 phase='normal';report.unitRestartPersistentAuthority=true;
 completed.clear();await assets[0].publish(source);await until(()=>completed.size===3,150000);
 for(const blob of completed.values())assert.equal(createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex'),hash);
 report.mediaAfterUnitRestart=true;
 stage='QR revocation and session removal';
 await call(`/rooms/${roomId}/admission`,{open:false,revoke:true},owner.token,'PATCH');
 await call('/guest-requests',{admissionToken:qr.admission.token,displayName:'Revoked'},undefined,'POST',410);
 await call('/auth/me',undefined,guests[0].token);
 for(const guest of guests)await call(`/rooms/${roomId}/members/${guest.user.id}/revoke`,{},owner.token,'POST',204);
 await until(()=>sockets.slice(1).every(s=>!s.connected));await call('/auth/me',undefined,guests[0].token,'GET',401);
 report.revocation=true;report.clientPeakRssMiB=process.resourceUsage().maxRSS/1024;
 report.errors=[...new Set(failures)];assert.ok(!failures.some(e=>!['TRANSFER_INTERRUPTED','TRANSFER_NOT_FOUND','DIRECTOR_NOT_READY'].includes(e)));assert.deepEqual(unhandled,[]);
 healthMs.sort((a,b)=>a-b);report.health={samples:healthMs.length,medianMs:healthMs[Math.floor(healthMs.length/2)],maxMs:Math.max(...healthMs)};
 report.result='pass';
}catch(error){report.result='fail';report.stage=stage;report.error=error.name;report.message=String(error.message).replace(/(?:sess|qr|request)_[A-Za-z0-9_-]{43}/g,'[REDACTED]');report.tokenStates=tokens.map(c=>({ready:c.state.ready,error:c.state.error,revision:c.state.snapshot?.revision}));process.exitCode=1;}
finally{
 clearInterval(timer);await healthPending;for(const client of assets)client.close();for(const client of tokens)client.close();for(const socket of sockets)socket.disconnect();
 await writeFile(root+'/acceptance.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report));
}
