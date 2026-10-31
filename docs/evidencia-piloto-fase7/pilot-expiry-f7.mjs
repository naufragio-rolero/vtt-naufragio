import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createDistServer} from './source/backend/scripts/serve-dist.js';
const api=process.env.PILOT_API,origin='http://127.0.0.1:8080';
const {accounts}=JSON.parse(await readFile(process.env.PILOT_FIXTURE,'utf8'));
const {chromium}=await import(pathToFileURL(resolve(process.env.BROWSER_TOOLS_DIR,'node_modules/playwright/index.mjs')));
let browser,front,stage='start';const report={result:'pending',clock:'real wall clock, no clock injection'};
async function call(path,body,token,expected=200){const r=await fetch(api+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});assert.equal(r.status,expected,path);return r.status===204?null:r.json();}
try{
 const owner=await call('/auth/login',{username:accounts[0].username,password:accounts[0].password});
 const created=await call('/rooms',{name:'Real expiry ARMv7'},owner.token,201),roomId=created.room.id;
 const qr=await call(`/rooms/${roomId}/admission`,{expiresInSeconds:60},owner.token);
 const pending=await call('/guest-requests',{admissionToken:qr.admission.token,displayName:'Pending expiry'},undefined,201);
 const r=await call('/guest-requests',{admissionToken:qr.admission.token,displayName:'Session expiry'},undefined,201);
 const requests=await call(`/rooms/${roomId}/admission`,undefined,owner.token);
 await call(`/rooms/${roomId}/admission/${requests.requests.find(x=>x.displayName==='Session expiry').id}`,{approve:true},owner.token);
 const guest=await call('/guest-requests/claim',{requestToken:r.requestToken});
 await call('/invitations',{},guest.token,403);await call('/resources',{},guest.token,403);await call(`/rooms/${roomId}/admission`,{},guest.token,403);
 report.guestCannotInviteUploadOrOpenAdmission=true;
 report.sessionTtlMs=guest.expiresAt-Date.now();assert.ok(report.sessionTtlMs>55000&&report.sessionTtlMs<=60000);
 front=await createDistServer({directory:process.env.PILOT_DIST_DIR,publicConfig:{schemaVersion:1,siteName:'Expiry pilot',apiBaseUrl:api,realtimeBaseUrl:api,socketPath:'/socket.io',roleLabels:{admin:'Admin',director:'Director',user:'Guest'}}});
 await new Promise(r=>front.listen(8080,'127.0.0.1',r));
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage();await page.goto(origin);
 await page.evaluate(async({api,token,roomId})=>{
  const{io}=await import('./frontend/vendor/socket.io-4.8.4.esm.min.js');
  window.expiryPeer=io(api,{forceNew:true,reconnection:false,auth:{token,roomId}});
  window.expiryEvents=[];window.expiryPeer.on('disconnect',reason=>window.expiryEvents.push({event:'disconnect',reason,time:Date.now()}));
  await new Promise((resolve,reject)=>{window.expiryPeer.once('connect',resolve);window.expiryPeer.once('connect_error',reject);});
 },{api,token:guest.token,roomId});
 stage='real 30 second request expiration';
 await new Promise(r=>setTimeout(r,Math.max(0,pending.expiresAt-Date.now()+1200)));
 await call('/guest-requests/status',{requestToken:pending.requestToken},undefined,410);
 report.pendingRequestExpiry=true;
 stage='real 60 second session and QR expiration';
 await page.waitForFunction(()=>window.expiryEvents.length>0,null,{timeout:40000});
 await new Promise(r=>setTimeout(r,Math.max(0,qr.admission.expiresAt-Date.now()+1200)));
 await call('/auth/me',undefined,guest.token,401);
 await call('/guest-requests',{admissionToken:qr.admission.token,displayName:'QR expired'},undefined,410);
 await call('/guest-requests/claim',{requestToken:r.requestToken},undefined,410);
 // Opening another admission invokes the actual cleanup operation, without direct DB edits.
 await call(`/rooms/${roomId}/admission`,{},owner.token);
 report.disconnect=await page.evaluate(()=>window.expiryEvents);report.sessionExpired=true;report.qrExpired=true;report.cleanupTriggered=true;
 await page.evaluate(()=>window.expiryPeer.disconnect());report.result='pass';
}catch(error){report.result='fail';report.stage=stage;report.error=error.name;process.exitCode=1;}
finally{await browser?.close();if(front)await new Promise(r=>{front.close(r);front.closeAllConnections();});await writeFile(process.env.PILOT_EXPIRY_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
