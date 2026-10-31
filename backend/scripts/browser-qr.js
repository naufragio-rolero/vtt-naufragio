// Explicit local acceptance. Accounts, passwords, requests and sessions are synthetic and never logged.
import assert from 'node:assert/strict';
import { randomBytes,createHash } from 'node:crypto';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import jsQR from 'jsqr';
import { createBackend } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { buildFrontend } from './build-frontend.js';
import { createDistServer } from './serve-dist.js';
import { largePng } from './large-png.js';

if(!process.env.BROWSER_TOOLS_DIR)throw new Error('BROWSER_TOOLS_DIR_REQUIRED');
const {chromium,firefox}=await import(pathToFileURL(resolve(process.env.BROWSER_TOOLS_DIR,'node_modules/playwright/index.mjs')));
const edge=await chromium.launch({channel:'msedge',headless:true});let fox;const results=[];let stage='launch';
const secret=()=>randomBytes(32).toString('base64url');
async function closeServer(s){await new Promise(r=>{s.close(r);s.closeAllConnections();});}
async function panel(p){if(!await p.locator('#multiplayerDialog').evaluate(d=>d.open))await p.click('#openMultiplayer');}
async function shutPanel(p){if(await p.locator('#multiplayerDialog').evaluate(d=>d.open))await p.click('#closeMultiplayer');}
async function selectToken(p,id){if(await p.locator('#menuToggle').isVisible()&&await p.getAttribute('#menuToggle','aria-expanded')!=='true')await p.click('#menuToggle');await p.locator(`[data-token-id="${id}"]`).click();await p.locator('#boardCanvas').focus();}
async function scenario(basePath,transport){
 const root=await mkdtemp(resolve(tmpdir(),'naufragio-qr-browser-')),cfg={},contexts=[],errors=[],leaks=[];
 let app,front;let now=Date.now(),peakRss=process.memoryUsage().rss;const started=performance.now(),cpuStart=process.cpuUsage();
 const sample=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},100);
 try{
  stage=basePath+' build';await buildFrontend({outputRoot:root});front=await createDistServer({directory:resolve(root,'dist'),basePath,publicConfig:cfg});
  await new Promise(r=>front.listen(0,'127.0.0.1',r));const site='http://127.0.0.1:'+front.address().port;
  app=createBackend(loadConfig({NODE_ENV:'test',ALLOWED_ORIGINS:site,AUTH_RATE_LIMIT:'100',HTTP_RATE_LIMIT:'10000',HANDSHAKE_RATE_LIMIT:'100',EVENT_RATE_LIMIT:'1000',GUEST_QR_TTL_SECONDS:'60'}),{clock:()=>now});
  await app.listen(0);const api='http://127.0.0.1:'+app.server.address().port;
  Object.assign(cfg,{schemaVersion:1,siteName:'QR local acceptance',apiBaseUrl:api,realtimeBaseUrl:api,socketPath:'/socket.io',roleLabels:{admin:'Administrador',director:'Máster',user:'Jugador'}});
  const password=secret();await app.auth.bootstrap({username:'qr-admin',password});const admin=await app.auth.login({username:'qr-admin',password});
  await app.auth.createUser(admin.token,{username:'qr-director',password,role:'director'});
  const owner=await app.auth.login({username:'qr-director',password});
  const desktop=await edge.newContext({viewport:{width:1400,height:1000}}),mobileA=await fox.newContext({viewport:{width:390,height:844},hasTouch:true}),mobileB=await edge.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true});contexts.push(desktop,mobileA,mobileB);
  // Exercise both browser transports without changing the application default negotiation.
  for(const c of contexts){await c.addInitScript(()=>{
    window.__hashes=[];window.__rejections=[];window.__longTimers=new Set();
    addEventListener('unhandledrejection',e=>window.__rejections.push(String(e.reason)));
    const schedule=window.setTimeout.bind(window),cancel=window.clearTimeout.bind(window);
    window.setTimeout=(fn,delay,...args)=>{let id;id=schedule(()=>{window.__longTimers.delete(id);fn(...args);},delay);if(delay===600000)window.__longTimers.add(id);return id;};
    window.clearTimeout=id=>{window.__longTimers.delete(id);cancel(id);};
    if(crypto.subtle){const digest=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=async function(algorithm,bytes){const value=await digest(algorithm,bytes);if(bytes.byteLength===12582912)window.__hashes.push([...new Uint8Array(value)].map(b=>b.toString(16).padStart(2,'0')).join(''));return value;};}});
   c.on('page',p=>{p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(/(?:qr_|request_|sess_)[A-Za-z0-9_-]{20}/.test(r.url()+' '+(r.headers().referer||'')))leaks.push('secret in URL/referrer');});});}
  if(transport==='polling')for(const c of contexts)await c.addInitScript(()=>{window.WebSocket=class{constructor(){throw new Error('WebSocket unavailable in polling acceptance');}};});
  stage=basePath+' Edge director page';const director=await desktop.newPage();
  stage=basePath+' Firefox touch page';const one=await mobileA.newPage();
  stage=basePath+' Edge mobile page';const two=await mobileB.newPage();
  for(const p of [director,one,two])p.setDefaultTimeout(20000);
  stage=basePath+' director login';
  await director.goto(site+basePath);await director.waitForFunction(()=>window.NaufragioBoard);
  await panel(director);await director.check('#trustDestination');await director.fill('#loginUser','qr-director');await director.fill('#loginPassword',password);await director.locator('#loginForm button').click();
  await director.waitForFunction(()=>!document.getElementById('signedIn').hidden);await director.fill('#roomName','Mesa QR');await director.locator('#createRoomForm button').click();
  await director.waitForFunction(()=>document.getElementById('roomState').textContent.includes('Partida conectada'));
  const roomId=await director.getAttribute('#currentRoom','data-room-id');
  await panel(director);await director.click('#inviteQr');await director.waitForFunction(()=>document.getElementById('qrLink').value.includes('#join='));
  const link=await director.inputValue('#qrLink');const pixels=await director.locator('#qrCanvas').evaluate(c=>({data:[...c.getContext('2d').getImageData(0,0,c.width,c.height).data],width:c.width,height:c.height}));
  assert.ok(jsQR(new Uint8ClampedArray(pixels.data),pixels.width,pixels.height)?.data===link,'generated QR decodes to the exact link');
  stage=basePath+' requests';
  for(const [p,name]of [[one,'Ana móvil'],[two,'Bruno móvil']]){stage=basePath+' request '+name;await p.goto(link);await p.waitForFunction(()=>!document.getElementById('guestName').disabled);assert.equal(new URL(p.url()).hash,'');await p.fill('#guestName',name);await p.click('#requestJoin');await p.waitForFunction(()=>document.getElementById('joinStatus').textContent.includes('Esperando'));}
  stage=basePath+' pending request reload';
  await one.reload();await one.waitForFunction(()=>document.getElementById('joinStatus').textContent.includes('Esperando'));
  await director.locator('.qr-request').filter({hasText:'Ana móvil'}).getByRole('button',{name:'Aprobar',exact:true}).click();
  await director.locator('.qr-request').filter({hasText:'Bruno móvil'}).getByRole('button',{name:'Rechazar',exact:true}).click();
  stage=basePath+' approved guest enters';await one.waitForURL('**/index.html');await one.waitForFunction(()=>document.getElementById('roomState').textContent.includes('Partida conectada'));
  await two.waitForFunction(()=>document.getElementById('joinStatus').textContent.includes('rechazado'));
  assert.equal(app.rooms.members(owner.token,roomId).length,2);
  // A rejected capability cannot create a session. Re-scanning starts a distinct request.
  const rejected=await two.evaluate(()=>JSON.parse(sessionStorage.getItem('naufragio-guest-pending-v1')).requestToken);
  const post=async(path,body,token)=>{const r=await fetch(api+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  assert.equal((await post('/guest-requests/claim',{requestToken:rejected})).status,403);
  stage=basePath+' rejected guest rescans';await two.goto(link);await two.waitForFunction(()=>!document.getElementById('guestName').disabled);
  await two.fill('#guestName','Bruno admitted');await two.click('#requestJoin');
  await director.locator('.qr-request').filter({hasText:'Bruno admitted'}).getByRole('button',{name:'Aprobar',exact:true}).click();
  await two.waitForURL('**/index.html');await two.waitForFunction(()=>document.getElementById('roomState').textContent.includes('Partida conectada'));
  const pages=[director,one,two],members=app.rooms.members(owner.token,roomId),ana=members.find(m=>m.username.startsWith('Ana')),bruno=members.find(m=>m.username==='Bruno admitted');
  assert.equal(members.length,3);assert.deepEqual(ana.permissions,{diceAllowed:false,moveAssignedTokens:false});
  const guest=await one.evaluate(()=>JSON.parse(sessionStorage.getItem('naufragio-guest-session-v1')));
  assert.equal((await post('/rooms',{name:'Forbidden guest room'},guest.token)).status,403);
  const other=app.rooms.create(owner.token,{name:'Isolated'});
  assert.equal((await fetch(api+'/rooms/'+other.room.id,{headers:{Authorization:'Bearer '+guest.token}})).status,404);
  await director.click('#qrClose');await director.click('#refreshMembers');
  const starting=await director.evaluate(()=>window.NaufragioBoard.tokens());assert.ok(starting.length>=2);
  for(const [i,member]of [[0,ana],[1,bruno]]){
    await director.locator(`.member-row[data-user-id="${member.userId}"] input`).check();
    await director.locator(`.member-row[data-user-id="${member.userId}"]`).getByRole('button',{name:'Actualizar permiso'}).click();
    await director.selectOption('#assignedToken',starting[i].id);await director.selectOption('#assignedUsers',member.userId);await director.locator('#assignForm button').click();
    await director.waitForFunction(()=>document.getElementById('multiplayerStatus').textContent.startsWith('Asignaci'));
  }
  await shutPanel(director);
  stage=basePath+' movement';
  await selectToken(one,starting[0].id);await one.keyboard.press('ArrowRight');
  for(const p of pages)await p.waitForFunction(id=>window.NaufragioBoard.tokens().find(t=>t.id===id)?.tokenVersion===1,starting[0].id);
  const confirmed=await director.evaluate(()=>window.NaufragioBoard.tokens());
  await selectToken(two,starting[0].id);await two.keyboard.press('ArrowRight');
  assert.match(await two.locator('#toast').innerText(),/Sin permiso/);
  for(const p of pages)assert.deepEqual(await p.evaluate(()=>window.NaufragioBoard.tokens()),confirmed);
  // Test the backend independently of the disabled UI.
  const denial=await two.evaluate(async({api,roomId,item})=>{
    const {io}=await import('./frontend/vendor/socket.io-4.8.4.esm.min.js'),saved=JSON.parse(sessionStorage.getItem('naufragio-guest-session-v1'));
    const peer=io(api,{forceNew:true,auth:{token:saved.token,roomId}});
    try{const authority=await new Promise((resolve,reject)=>{peer.once('room:authority',resolve);peer.once('connect_error',reject);});
      return await peer.timeout(5000).emitWithAck('token:move:request',{version:1,roomId,epoch:authority.epoch,eventId:crypto.randomUUID(),baseRevision:1,tokenId:item.id,tokenVersion:item.tokenVersion,position:{x:99,y:99}});
    }finally{peer.disconnect();}
  },{api,roomId,item:confirmed[0]});assert.equal(denial.error.code,'FORBIDDEN');
  stage=basePath+' real PNG 12 MiB to two guests';
  const png=largePng(),sha256=createHash('sha256').update(png).digest('hex'),transferStart=performance.now();
  await panel(director);await director.setInputFiles('#sharedMapUpload',{name:'map-12MiB.png',mimeType:'image/png',buffer:png});
  for(const p of pages){await p.waitForFunction(hash=>window.__hashes.includes(hash)&&window.NaufragioBoard.sharedView()?.map?.name==='map-12MiB.png',sha256,{timeout:150000});await p.waitForFunction(()=>window.__longTimers.size===0);}
  const transferMs=Math.round(performance.now()-transferStart);
  const engines=Object.values(app.io.engine.clients).map(c=>c.transport.name);
  assert.equal(engines.length,3);assert.ok(engines.every(name=>name===transport));
  const portrait=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPQXRT9HwAEVAIq3G2ZNgAAAABJRU5ErkJggg==','base64');
  await director.selectOption('#assignedToken',starting[0].id);await director.setInputFiles('#sharedTokenUpload',{name:'portrait.png',mimeType:'image/png',buffer:portrait});
  for(const p of pages)await p.waitForFunction(id=>window.NaufragioBoard.sharedView()?.portraits.includes(id),starting[0].id,{timeout:150000});
  stage=basePath+' interrupted transfer';
  const interruptedPng=largePng(),interruptedHash=createHash('sha256').update(interruptedPng).digest('hex');
  let interrupted=false,offline;
  const receiver=[...app.io.of('/').sockets.values()].find(s=>s.data.access.actor.id===ana.userId);
  receiver.onAnyOutgoing(event=>{if(event==='assets:chunk'&&!interrupted){interrupted=true;offline=mobileA.setOffline(true);queueMicrotask(()=>receiver.conn.close(true));}});
  await director.setInputFiles('#sharedMapUpload',{name:'interrupted-12MiB.png',mimeType:'image/png',buffer:interruptedPng});
  await two.waitForFunction(hash=>window.__hashes.includes(hash)&&window.NaufragioBoard.sharedView()?.map?.name==='interrupted-12MiB.png',interruptedHash,{timeout:150000});
  assert.equal(interrupted,true);await offline;assert.match(await director.locator('#roomState').innerText(),/Partida conectada/);
  assert.equal(receiver.connected,false);assert.equal(await one.evaluate(hash=>window.__hashes.includes(hash),interruptedHash),false);
  // A network loss is detected by Engine.IO heartbeat; offline polling may not
  // report it until pingInterval + pingTimeout. Inspect cleanup AFTER that event.
  await one.waitForFunction(()=>document.getElementById('roomState').textContent.includes('En espera'),null,{timeout:60000});
  for(const p of pages)await p.waitForFunction(()=>window.__longTimers.size===0,null,{timeout:60000});
  await mobileA.setOffline(false);
  await one.waitForFunction(hash=>window.__hashes.includes(hash)&&window.NaufragioBoard.sharedView()?.map?.name==='interrupted-12MiB.png',interruptedHash,{timeout:150000});
  await one.reload();await one.waitForFunction(hash=>window.__hashes.includes(hash)&&window.NaufragioBoard.sharedView()?.map?.name==='interrupted-12MiB.png',interruptedHash,{timeout:150000});
  stage=basePath+' revocation expiry expulsion and cleanup';
  await director.click('#inviteQr');await director.click('#qrRevoke');
  assert.equal((await post('/guest-requests',{admissionToken:new URL(link).hash.slice(6),displayName:'Revoked'})).status,410);
  const fresh=app.guests.open(owner.token,roomId,{}).admission;now+=61000;
  assert.equal((await post('/guest-requests',{admissionToken:fresh.token,displayName:'Expired'})).status,410);
  await director.click('#qrClose');await director.click('#refreshMembers');
  await director.locator(`.member-row[data-user-id="${ana.userId}"]`).getByRole('button',{name:'Retirar acceso'}).click();
  await one.waitForFunction(()=>!sessionStorage.getItem('naufragio-guest-session-v1'));
  assert.equal((await fetch(api+'/auth/me',{headers:{Authorization:'Bearer '+guest.token}})).status,401);
  for(const p of [director,two]){await panel(p);await p.click('#leaveRoom');}
  for(const p of pages){await p.waitForFunction(()=>window.__longTimers.size===0);assert.deepEqual(await p.evaluate(()=>window.__rejections),[]);}
  assert.deepEqual(errors,[]);assert.deepEqual(leaks,[]);
  const cpu=process.cpuUsage(cpuStart);
  results.push({basePath,transport,clients:3,mobileEmulation:['Firefox touch 390x844','Edge mobile 393x852'],qrDecode:true,approvalAndRejection:true,roomIsolation:true,expulsion:true,sha256,bytes:png.length,transferMs,interruptedTransfer:true,reconnectAndReload:true,residual600sTimers:0,pageErrors:0,unhandledRejections:0,urlOrReferrerLeaks:0,peakBackendAndDriverRssMiB:Math.round(peakRss/1048576),cpuMs:Math.round((cpu.user+cpu.system)/1000),durationMs:Math.round(performance.now()-started)});
 }catch(error){
  const states=[];for(const c of contexts)for(const p of c.pages())states.push(await p.evaluate(()=>({page:location.pathname,join:document.getElementById('joinStatus')?.textContent,room:document.getElementById('roomState')?.textContent,status:document.getElementById('multiplayerStatus')?.textContent})).catch(()=>({page:'closed'})));
  console.error(JSON.stringify({stage,states,pageErrors:errors,error:error.message.replace(/(?:qr_|request_|sess_)[A-Za-z0-9_-]{43}/g,'[REDACTED]')}));throw error;
 }finally{
  clearInterval(sample);
  for(const c of contexts)await c.close();await app?.close();if(front)await closeServer(front);await rm(root,{recursive:true,force:true});
  if(app){assert.equal(app.server.listening,false);assert.equal(Object.keys(app.io.engine.clients).length,0,'backend engines still registered after close');assert.equal(app.io.engine.clientsCount,0);}
 }
}
try{fox=await firefox.launch({headless:true});if(process.env.BROWSER_QR_CASE!=='polling')await scenario('/','websocket');await scenario('/vtt/','polling');const report={result:'pass',edge:edge.version(),firefox:fox.version(),scenarios:results};if(process.env.BROWSER_QR_REPORT)await writeFile(process.env.BROWSER_QR_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
catch(error){console.error(JSON.stringify({result:'fail',stage,error:error.message.replace(/(?:qr_|request_|sess_)[A-Za-z0-9_-]{43}/g,'[REDACTED]')}));process.exitCode=1;}
finally{await fox?.close();await edge.close();}
