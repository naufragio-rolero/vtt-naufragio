// Synthetic loopback client for the unchanged ARMv7 backend under its supervisor.
// Credentials/authority stay in a private staging directory and are never logged.
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes,randomUUID,createHash,createPrivateKey,createPublicKey } from 'node:crypto';

const root=resolve(process.argv[2]), mode=process.argv[3];
if(root!=='/mnt/ssd/naufragio-phase10-1f19390')throw new Error('PRIVATE_STAGE_REQUIRED');
const moduleAt=path=>import(pathToFileURL(resolve(root,'source/backend',path)));
const {loadConfig}=await moduleAt('src/config.js');
const {openStorage}=await moduleAt('src/storage.js');
const {createAuthService}=await moduleAt('src/auth/service.js');
const {rawSocket,connect,prove,localAuthority,send,assign,moveInput,accept,waitFor}=await moduleAt('tests/token-helpers.js');
const {createAssetClient}=await moduleAt('client/asset-client.js');
const data=resolve(root,'data'),fixturePath=resolve(data,'synthetic-fixture.json');
const url='http://127.0.0.1:3400', checks=[], cleanups=[];
const t={after:fn=>cleanups.push(fn)};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function api(path,{method='GET',token,body}={}) {
  const response=await fetch(url+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
  const value=response.status===204?null:await response.json();
  assert.ok(response.ok,`${path}: ${response.status} ${value?.error?.code||''}`);return value;
}
if(mode==='seed') {
  await mkdir(data,{recursive:true,mode:0o700});
  const store=openStorage(resolve(data,'synthetic.sqlite'));
  try {
    const auth=createAuthService(store,loadConfig({NODE_ENV:'test',DATABASE_PATH:resolve(data,'synthetic.sqlite')}));
    const secret=()=> 'synthetic-'+randomBytes(24).toString('base64url');
    const adminPassword=secret(),directorPassword=secret();
    await auth.bootstrap({username:'phase10-synthetic-admin',password:adminPassword});
    const admin=await auth.login({username:'phase10-synthetic-admin',password:adminPassword});
    await auth.createUser(admin.token,{username:'phase10-synthetic-director',password:directorPassword,role:'director'});auth.logout(admin.token);
    await writeFile(fixturePath,JSON.stringify({directorPassword}),{flag:'wx',mode:0o600});
    console.log(JSON.stringify({seeded:true,realCredentialsUsed:false}));
  } finally {store.close();}
} else {
  const fixture=JSON.parse(await readFile(fixturePath,'utf8'));
  const session=await api('/auth/login',{method:'POST',body:{username:'phase10-synthetic-director',password:fixture.directorPassword}});
  try {
    if(mode==='exercise') {
      const created=await api('/rooms',{method:'POST',token:session.token,body:{name:'ARMv7 phase10 synthetic table'}}),roomId=created.room.id;
      const qr=(await api(`/rooms/${roomId}/admission`,{method:'POST',token:session.token,body:{}})).admission;
      const requestA=await api('/guest-requests',{method:'POST',body:{admissionToken:qr.token,displayName:'Synthetic Ana'}});
      const requestB=await api('/guest-requests',{method:'POST',body:{admissionToken:qr.token,displayName:'Synthetic Bruno'}});
      let requests=(await api(`/rooms/${roomId}/admission`,{token:session.token})).requests;
      assert.equal(requests.filter(q=>q.state==='pending').length,2);
      for(const entry of requests)await api(`/rooms/${roomId}/admission/${entry.id}`,{method:'POST',token:session.token,body:{approve:entry.displayName==='Synthetic Ana'}});
      assert.equal((await api('/guest-requests/status',{method:'POST',body:{requestToken:requestB.requestToken}})).state,'rejected');
      const ana=await api('/guest-requests/claim',{method:'POST',body:{requestToken:requestA.requestToken}});
      const requestC=await api('/guest-requests',{method:'POST',body:{admissionToken:qr.token,displayName:'Synthetic Carla'}});
      requests=(await api(`/rooms/${roomId}/admission`,{token:session.token})).requests;
      await api(`/rooms/${roomId}/admission/${requests.find(q=>q.displayName==='Synthetic Carla').id}`,{method:'POST',token:session.token,body:{approve:true}});
      const carla=await api('/guest-requests/claim',{method:'POST',body:{requestToken:requestC.requestToken}});
      await api(`/rooms/${roomId}/members/${ana.user.id}`,{method:'PATCH',token:session.token,body:{permissions:{moveAssignedTokens:true,diceAllowed:true}}});
      checks.push('two pending requests, approve/reject, memberships and permissions');
      const f={url,created};
      const director=rawSocket(t,f,session), errors=[], manifests=new Map(), completed=new Map();
      const bytes=await readFile(resolve(root,'map-12MiB.png')), image=new Blob([bytes],{type:'image/png'}),sha256=hash(bytes);
      const publisher=createAssetClient(director,{roomId,director:true,getSource:async()=>image,onError:e=>errors.push(e)});t.after(()=>publisher.close());
      await connect(director);
      const record=localAuthority([{id:randomUUID(),tokenVersion:0,x:0,y:0},{id:randomUUID(),tokenVersion:0,x:1,y:1}]);
      const owner=await prove(director,record);assert.equal(owner.result.ok,true);
      const peers=[];
      for(const account of [ana,carla]) {
        const socket=rawSocket(t,f,account),client=createAssetClient(socket,{roomId,onUpdate:value=>{
          if(value.manifest)manifests.set(account.user.id,value.manifest);
          if(value.blobs.has('map'))completed.set(account.user.id,value.blobs.get('map'));
        },onError:e=>errors.push(e)});
        t.after(()=>client.close());await connect(socket);peers.push(socket);
      }
      const presence=(await peers[0].timeout(5000).emitWithAck('room:presence:get',{version:1})).presence;
      assert.equal(presence.participants.length,3);assert.ok(presence.participants.some(p=>p.role==='director'));
      const token=record.current.tokens[0];await assign(director,owner,token.id,[ana.user.id]);
      assert.ok((await send(peers[0],'tokens:permissions:get')).permissions.assignedTokenIds.includes(token.id));
      assert.equal(manifests.size,0,'staged source must not publish without confirmation');
      const source={map:{name:'ARMv7 real PNG 12MiB',widthPx:bytes.readUInt32BE(16),heightPx:bytes.readUInt32BE(20),widthCells:20,heightCells:20,xCells:-10,yCells:-10,imageId:'map'},
        tokens:record.current.tokens.map((t,i)=>({id:t.id,name:i?'Public companion':'Edited synthetic token',color:'#85dcd2',size:i?1:1.5,imageId:null})),files:{map:image}};
      const began=performance.now();await publisher.publish(source);
      await waitFor(()=>completed.size===2,'two ARM loopback map recipients',150000);
      for(const blob of completed.values())assert.equal(hash(Buffer.from(await blob.arrayBuffer())),sha256);
      for(const m of manifests.values())assert.equal(m.tokens.find(t=>t.id===token.id).name,'Edited synthetic token');
      checks.push('public contextual appearance manifest, explicit map publication, SHA-256 to two peers');
      const transferMs=Math.round(performance.now()-began);
      const scene=(await send(director,'scene:get')).scene;
      assert.deepEqual(scene.bounds,{x:-10,y:-10,width:20,height:20});
      assert.equal((await send(peers[0],'token:move:request',{...moveInput(owner,token),position:{x:999,y:999}})).error.code,'OUTSIDE_BOARD');
      const bounds={x:-.25,y:-.25,width:4.5,height:4.5};
      assert.equal((await send(director,'scene:set',{epoch:owner.epoch,revision:scene.revision,mode:'custom',bounds})).ok,true);
      const input={...moveInput(owner,token),position:{x:1.5,y:.5}};
      assert.equal((await send(peers[0],'token:move:request',input)).status,'pending');
      assert.equal((await accept(director,owner,input)).status,'committed');
      checks.push('offset map bounds, fractional custom bounds, forged movement rejection and official commit');
      const seen=[[],[],[]];[director,...peers].forEach((peer,i)=>peer.on('dice:result',v=>seen[i].push(v.roll)));
      const rollInput={eventId:randomUUID(),issuedAt:Date.now(),notation:'2d6+3'};
      const rolled=await send(peers[0],'dice:roll',rollInput);assert.equal(rolled.ok,true);
      await waitFor(()=>seen.every(a=>a.length===1));assert.deepEqual(seen[0],seen[1]);assert.deepEqual(seen[1],seen[2]);
      assert.equal(rolled.roll.total,rolled.roll.results.reduce((a,b)=>a+b,3));
      assert.equal((await send(peers[0],'dice:roll',rollInput)).error.code,'ROLL_REPLAYED');
      assert.equal((await send(peers[0],'dice:roll',{...rollInput,eventId:randomUUID(),results:[6,6]})).error.code,'INVALID_MESSAGE');
      assert.equal((await send(peers[1],'dice:roll',{...rollInput,eventId:randomUUID()})).error.code,'FORBIDDEN');
      completed.delete(ana.user.id);peers[0].disconnect();await connect(peers[0]);
      assert.deepEqual((await send(peers[0],'dice:history:get')).rolls,[rolled.roll]);
      await waitFor(()=>completed.has(ana.user.id),'map recovered after reconnect',150000);
      assert.equal(hash(Buffer.from(await completed.get(ana.user.id).arrayBuffer())),sha256);
      checks.push('identical verified dice, replay/forgery/permission denial, history and map after reconnect');
      // Carla's explicit permission denial closes that connection by policy.
      assert.ok(errors.every(e=>['TRANSFER_INTERRUPTED'].includes(e)),JSON.stringify(errors));
      const saved={roomId,roll:rolled.roll,bounds,current:owner.record.current,publicKey:record.keys.publicKey.export({format:'jwk'}),privateKey:record.keys.privateKey.export({format:'jwk'})};
      await writeFile(resolve(data,'synthetic-authority.json'),JSON.stringify(saved),{flag:'wx',mode:0o600});
      const report={result:'pass',arch:process.arch,node:process.version,checks,mapBytes:bytes.length,mapSha256:sha256,twoRecipientTransferMs:transferMs,clientDriverMaxRssKiB:process.resourceUsage().maxRSS,publicBrowserConnection:false};
      await writeFile(resolve(root,'evidence/functional-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
    } else if(mode==='after-restart') {
      const saved=JSON.parse(await readFile(resolve(data,'synthetic-authority.json'),'utf8'));
      const created={room:{id:saved.roomId}},f={url,created};const director=await connect(rawSocket(t,f,session));
      assert.deepEqual((await send(director,'dice:history:get')).rolls,[saved.roll]);
      assert.deepEqual((await send(director,'scene:get')).scene.bounds,saved.bounds);
      const record={current:saved.current,keys:{publicKey:createPublicKey({key:saved.publicKey,format:'jwk'}),privateKey:createPrivateKey({key:saved.privateKey,format:'jwk'})}};
      assert.equal((await prove(director,record)).result.ok,true);
      const report={result:'pass',arch:process.arch,historyPersisted:true,boundsPersisted:true,authorityRestored:true,syntheticIdentitySurvived:true};
      await writeFile(resolve(root,'evidence/restart-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
    } else throw new Error('INVALID_MODE');
  } finally {for(const cleanup of cleanups.reverse())await cleanup();}
}
