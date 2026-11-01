// Synthetic local acceptance only. Never connects to the beta.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBackend } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createFrontendServer } from './dev-frontend.js';

const { chromium } = await import(pathToFileURL(resolve(process.env.BROWSER_TOOLS_DIR, 'node_modules/playwright/index.mjs')));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const config = {}, contexts = [], errors = [];
const front = createFrontendServer({ publicConfig: config });
let app;
try {
  await new Promise(r => front.listen(0, '127.0.0.1', r));
  const site = `http://127.0.0.1:${front.address().port}`;
  app = createBackend(loadConfig({ NODE_ENV:'test', ALLOWED_ORIGINS:site, HTTP_RATE_LIMIT:'10000', AUTH_RATE_LIMIT:'100', EVENT_RATE_LIMIT:'1000' }));
  await app.listen(0);
  const api = `http://127.0.0.1:${app.server.address().port}`;
  Object.assign(config, {schemaVersion:1, siteName:'Phase 10 local', apiBaseUrl:api, realtimeBaseUrl:api, socketPath:'/socket.io', roleLabels:{admin:'Administrador',director:'Director',user:'Jugador'}});
  const password = randomBytes(32).toString('base64url');
  await app.auth.bootstrap({username:'test-admin',password});
  const admin = await app.auth.login({username:'test-admin',password});
  await app.auth.createUser(admin.token,{username:'test-director',password,role:'director'});
  const owner = await app.auth.login({username:'test-director',password});
  for (const viewport of [{width:1440,height:1000},{width:390,height:844},{width:393,height:852}]) {
    const context = await browser.newContext({viewport,hasTouch:viewport.width<400}); contexts.push(context);
    context.on('page', p => { p.setDefaultTimeout(20000); p.on('pageerror',e=>errors.push(e.message)); });
  }
  const [director, one, two] = await Promise.all(contexts.map(c=>c.newPage()));
  await director.goto(site); await director.waitForFunction(()=>window.NaufragioBoard);
  await director.click('#openMultiplayer'); await director.check('#trustDestination');
  await director.fill('#loginUser','test-director'); await director.fill('#loginPassword',password); await director.locator('#loginForm button').click();
  await director.waitForFunction(()=>!document.getElementById('signedIn').hidden);
  await director.fill('#roomName','Mesa de aceptación'); await director.locator('#createRoomForm button').click();
  await director.waitForFunction(()=>document.getElementById('roomState').textContent.includes('Partida conectada'));
  const roomId = await director.getAttribute('#currentRoom','data-room-id');
  await director.click('#tableInvite');
  assert.equal(await director.inputValue('#qrLink'),'','opening invitation must not generate a code');
  await director.click('#qrNew'); await director.waitForFunction(()=>document.getElementById('qrLink').value.includes('#join='));
  const link = await director.inputValue('#qrLink'); await director.click('#qrClose');
  for (const [page,name] of [[one,'Ana'],[two,'Bruno']]) {
    await page.goto(link); await page.waitForFunction(()=>!document.getElementById('guestName').disabled);
    await page.fill('#guestName',name); await page.click('#requestJoin');
    await page.waitForFunction(()=>document.getElementById('joinStatus').textContent.includes('Esperando'));
  }
  await director.waitForFunction(()=>document.getElementById('pendingCount').textContent==='2');
  assert.equal(await director.locator('#qrDialog').evaluate(d=>d.open),false);
  await director.reload(); await director.click('#openMultiplayer'); await director.check('#trustDestination');
  await director.fill('#loginUser','test-director'); await director.fill('#loginPassword',password); await director.locator('#loginForm button').click();
  await director.locator('#roomList button').click();
  await director.waitForFunction(()=>document.getElementById('pendingCount').textContent==='2');
  await director.waitForFunction(()=>document.getElementById('roomState').textContent.includes('Partida conectada'));
  await director.click('#openPlayers');
  await director.locator('.qr-request').filter({hasText:'Ana'}).getByRole('button',{name:'Aprobar',exact:true}).click();
  await director.locator('.qr-request').filter({hasText:'Bruno'}).getByRole('button',{name:'Rechazar',exact:true}).click();
  await one.waitForURL('**/index.html');
  await one.waitForFunction(()=>document.getElementById('roomState').textContent.includes('Partida conectada'));
  await two.waitForFunction(()=>document.getElementById('joinStatus').textContent.includes('rechazado'));
  await director.waitForFunction(()=>document.getElementById('pendingCount').textContent==='0');
  assert.equal(app.rooms.members(owner.token,roomId).length,2);
  assert.match(await director.locator('#connectedPlayers').innerText(),/Ana/);
  await mkdir(resolve('../docs/evidencia-fase10'),{recursive:true});
  await director.screenshot({path:resolve('../docs/evidencia-fase10/jugadores-escritorio.png')});
  await one.click('#openPlayers'); await one.screenshot({path:resolve('../docs/evidencia-fase10/jugadores-movil.png')});
  assert.equal(await one.locator('#playersAdministration').isVisible(),false);
  await one.reload(); await one.waitForFunction(()=>document.getElementById('roomState').textContent.includes('Partida conectada'));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'pass',qrClosedRequests:2,approved:1,rejected:1,guestReload:true,privateAdministration:true,pageErrors:errors.length}));
} finally {
  for (const context of contexts) await context.close();
  await browser.close(); await app?.close();
  await new Promise(r=>{front.close(r);front.closeAllConnections();});
}
