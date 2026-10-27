// Explicit browser acceptance test, separate from npm test. Never use real accounts.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { buildFrontend } from './build-frontend.js';
import { createDistServer } from './serve-dist.js';
import { createBackend } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { createFrontendServer } from './dev-frontend.js';

if (!process.env.BROWSER_TOOLS_DIR) throw new Error('BROWSER_TOOLS_DIR_REQUIRED');
const { chromium, firefox } = await import(pathToFileURL(resolve(process.env.BROWSER_TOOLS_DIR, 'node_modules/playwright/index.mjs')));
const chromiumBrowser = await chromium.launch({ channel: 'msedge', headless: true });
let firefoxBrowser;
const report = [];
let artifactRoot;
if (process.env.BROWSER_USE_DIST === '1') {
  artifactRoot = await mkdtemp(resolve(tmpdir(), 'naufragio-browser-dist-'));
  await buildFrontend({ outputRoot: artifactRoot });
}
const frontendServer = options => artifactRoot
  ? createDistServer({ ...options, directory: resolve(artifactRoot, 'dist') }) : createFrontendServer(options);
let stage = 'launch';
const secret = () => `synthetic-${randomBytes(24).toString('base64url')}`;
async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return `http://127.0.0.1:${server.address().port}`; }
async function closeServer(server) { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
async function openPanel(page) { if (!await page.locator('#multiplayerDialog').evaluate(dialog => dialog.open)) await page.click('#openMultiplayer'); }
async function closePanel(page) { if (await page.locator('#multiplayerDialog').evaluate(dialog => dialog.open)) await page.click('#closeMultiplayer'); }
async function configure(page, api, realtime) {
  await openPanel(page); await page.click('#openSettings');
  const frame = page.frameLocator('#settingsFrame');
  await frame.locator('#siteName').fill('Mesa sintética');
  await frame.locator('#apiBaseUrl').fill(api); await frame.locator('#realtimeBaseUrl').fill(realtime);
  await frame.locator('#socketPath').fill('/socket.io'); await frame.locator('#development').check();
  await frame.locator('#confirm').check(); await frame.locator('#applyLocal').click();
  await page.waitForFunction(() => !document.getElementById('settingsDialog').open);
}
async function login(page, username, password) {
  await openPanel(page); await page.check('#trustDestination');
  await page.fill('#loginUser', username); await page.fill('#loginPassword', password);
  await page.locator('#loginForm button').click();
  await page.waitForFunction(() => !document.getElementById('signedIn').hidden);
  assert.equal(await page.inputValue('#loginPassword'), '');
}
const tokens = page => page.evaluate(() => window.NaufragioBoard.tokens());
async function same(pages, expected) {
  for (const page of pages) await page.waitForFunction(value => JSON.stringify(window.NaufragioBoard.tokens()) === JSON.stringify(value), expected);
}
async function moveCanvas(page, tokenId, dx, dy) {
  await closePanel(page);
  const item = (await tokens(page)).find(token => token.id === tokenId);
  const rect = await page.locator('#boardCanvas').boundingBox();
  const x = rect.x + rect.width / 2 + (item.x + .5) * 64;
  const y = rect.y + rect.height / 2 + (item.y + .5) * 64;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx * 64, y + dy * 64, { steps: 12 }); await page.mouse.up();
}
async function localOnly(engine) {
  stage = `${engine.browserType().name()} local without backend`;
  const server = await frontendServer();
  const url = await listen(server);
  const context = await engine.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(url); await page.waitForFunction(() => window.NaufragioBoard);
    await moveCanvas(page, 'starter-1', 1, 0);
    assert.equal((await tokens(page)).find(token => token.id === 'starter-1').x, -1);
    await page.selectOption('#themeSelect', 'dark');
    await page.click('#gridToggle');
    const zoom = await page.locator('#zoomValue').innerText(); await page.click('#zoomIn');
    assert.notEqual(await page.locator('#zoomValue').innerText(), zoom);
    await page.click('#addToken'); assert.equal((await tokens(page)).length, 5);
    page.on('dialog', dialog => dialog.accept()); await page.click('#deleteToken'); assert.equal((await tokens(page)).length, 4);
    await page.setInputFiles('#mapUpload', { name: 'mapa-local-sintetico.png', mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK6kAAAAASUVORK5CYII=', 'base64') });
    await page.waitForFunction(() => document.getElementById('mapFilename').textContent === 'mapa-local-sintetico.png');
    await page.reload(); await page.waitForFunction(() => window.NaufragioBoard && document.documentElement.dataset.theme === 'dark');
    assert.equal((await tokens(page)).length, 4);
    assert.equal((await tokens(page)).find(token => token.id === 'starter-1').x, -1);
    assert.equal(await page.getAttribute('#gridToggle', 'aria-pressed'), 'false');
    assert.equal(await page.locator('#mapFilename').innerText(), 'mapa-local-sintetico.png');
    assert.deepEqual(errors, []);
    report.push({ scenario: 'local-only', browser: engine.browserType().name(), result: 'pass', mapAndTokensAfterReload: 'preserved', themeGridZoom: 'pass' });
  } finally { await context.close(); await closeServer(server); }
}
async function scenario(directorBrowser, playerBrowser, basePath, prefix) {
  const deploymentConfig = {};
  const frontend = await frontendServer({ basePath, publicConfig: basePath === '/' ? undefined : deploymentConfig });
  const site = await listen(frontend);
  const url = site + basePath;
  const app = createBackend(loadConfig({ NODE_ENV: 'test', ALLOWED_ORIGINS: site, AUTH_RATE_LIMIT: '100', HTTP_RATE_LIMIT: '10000',
    HANDSHAKE_RATE_LIMIT: '100', EVENT_RATE_LIMIT: '1000', SOCKET_PATH: prefix + '/socket.io' }));
  const address = await app.listen(0);
  const api = `http://127.0.0.1:${address.port}`;
  Object.assign(deploymentConfig, { schemaVersion: 1, siteName: 'Mesa sintética', apiBaseUrl: api, realtimeBaseUrl: api + prefix,
    socketPath: '/socket.io', roleLabels: { admin: 'Administración', director: 'Dirección de mesa', user: 'Participante' } });
  const passwords = [secret(), secret(), secret(), secret()];
  const contexts = [];
  const pages = [];
  const pageErrors = [];
  try {
    stage = `${basePath} seed`;
    await app.auth.bootstrap({ username: 'browser-admin', password: passwords[0] });
    const admin = await app.auth.login({ username: 'browser-admin', password: passwords[0] });
    const accounts = [];
    for (const [i, role] of ['director', 'user', 'user'].entries()) {
      accounts.push(await app.auth.createUser(admin.token, { username: `browser-person-${i}`, password: passwords[i + 1], role }));
    }
    app.auth.setRoleLabels(admin.token, { admin: 'Administración', director: 'Dirección de mesa', user: 'Participante' });
    for (const engine of [directorBrowser, playerBrowser, chromiumBrowser]) {
      const context = await engine.newContext({ viewport: { width: 1440, height: 1000 } }); contexts.push(context);
      const page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => pageErrors.push(error.message));
      pages.push(page); await page.goto(url);
      await page.waitForFunction(() => window.NaufragioBoard);
    }
    const [director, one, two] = pages;
    if (basePath !== '/') await director.waitForFunction(api => document.getElementById('apiDestination').textContent.includes(api), api);
    stage = `${basePath} legacy local`;
    const legacy = { playerName: 'Persona local', tokens: [
      { id: 'legacy-one', code: 'L1', name: 'Nombre anterior', color: '#85dcd2', x: -2, y: -1 },
      { id: 'legacy-two', code: 'L2', name: 'Otro anterior', color: '#e7c47e', x: 0, y: 1 }],
      theme: 'light', cellSize: 64, zoom: 1, cameraX: 0, cameraY: 0, map: { name: 'Mapa legado sintético', widthPx: 1, heightPx: 1,
        widthCells: 20, heightCells: 20, xCells: -10, yCells: -10 } };
    await director.evaluate(async legacy => {
      localStorage.setItem('naufragio-vtt-mvp-v1', JSON.stringify(legacy));
      const blob = await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK6kAAAAASUVORK5CYII=')).blob();
      await new Promise((resolve, reject) => {
        const opening = indexedDB.open('naufragio-vtt-local-assets', 1);
        opening.onupgradeneeded = () => opening.result.createObjectStore('media');
        opening.onsuccess = () => { const db = opening.result, tx = db.transaction('media', 'readwrite');
          tx.objectStore('media').put(blob, 'active-map-image'); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = reject; };
      });
    }, legacy);
    await director.reload(); await director.waitForFunction(() => window.NaufragioBoard?.tokens()[0]?.id === 'legacy-one');
    await director.locator('.token-item').first().click(); await director.locator('#boardCanvas').focus(); await director.keyboard.press('ArrowRight');
    assert.equal((await tokens(director))[0].x, -1);
    const preserved = await director.evaluate(() => localStorage.getItem('naufragio-vtt-mvp-v1'));
    stage = `${basePath} login and configuration`;
    for (let i = 0; i < pages.length; i++) { await configure(pages[i], api, api + prefix); await login(pages[i], accounts[i].username, passwords[i + 1]); }
    assert.equal(await one.locator('#directorAccess').isVisible(), false);
    stage = `${basePath} signup invitation UI`;
    await director.getByText('Invitar a crear una cuenta ordinaria', { exact: true }).click();
    await director.click('#createSignup'); await director.waitForFunction(() => document.getElementById('signupOutput').value.startsWith('signup_'));
    const signup = await director.inputValue('#signupOutput');
    const signupContext = await playerBrowser.newContext(); contexts.push(signupContext);
    const signupPage = await signupContext.newPage(); signupPage.setDefaultTimeout(20000); await signupPage.goto(url);
    await configure(signupPage, api, api + prefix); await signupPage.check('#trustDestination');
    await signupPage.getByText('Crear una cuenta con invitación de alta', { exact: true }).click();
    await signupPage.fill('#signupInvitation', signup); await signupPage.locator('#validateSignupForm button').click();
    await signupPage.waitForFunction(() => !document.getElementById('signupFields').disabled);
    await signupPage.fill('#signupUser', 'browser-signup-test'); await signupPage.fill('#signupPassword', secret());
    await signupPage.locator('#signupForm button').click();
    await signupPage.waitForFunction(() => document.getElementById('multiplayerStatus').textContent.startsWith('Cuenta ordinaria creada'));
    assert.equal(await signupPage.inputValue('#signupPassword'), '');
    await signupPage.fill('#signupInvitation', signup); await signupPage.locator('#validateSignupForm button').click();
    await signupPage.waitForFunction(() => document.getElementById('multiplayerStatus').textContent.includes('usada'));
    assert.equal(await signupPage.locator('#signupFields').evaluate(fieldset => fieldset.disabled), true);
    assert.equal(await signupPage.locator('#signupUser').isDisabled(), true); await signupPage.close();
    stage = `${basePath} admin provisioning UI`;
    const adminContext = await directorBrowser.newContext(); contexts.push(adminContext);
    const adminPage = await adminContext.newPage(); adminPage.setDefaultTimeout(20000); await adminPage.goto(url);
    await configure(adminPage, api, api + prefix); await login(adminPage, 'browser-admin', passwords[0]);
    await adminPage.fill('#newDirectorUser', 'browser-provisioned'); await adminPage.fill('#newDirectorPassword', secret());
    await adminPage.locator('#createDirectorForm button').click();
    await adminPage.waitForFunction(() => document.getElementById('multiplayerStatus').textContent.startsWith('Perfil de dirección creado'));
    assert.equal(await adminPage.inputValue('#newDirectorPassword'), '');
    assert.equal(app.auth.listUsers(admin.token).find(user => user.username === 'browser-provisioned').role, 'director');
    await adminPage.close();
    stage = `${basePath} create room`;
    await director.fill('#roomName', 'Partida de aceptación'); await director.locator('#createRoomForm button').click();
    await director.waitForFunction(() => document.getElementById('roomState').textContent.startsWith('Partida conectada'));
    await openPanel(director);
    const code = await director.inputValue('#admissionCode'); assert.match(code, /^room_/);
    const roomId = await director.locator('#currentRoom').getAttribute('data-room-id');
    stage = `${basePath} invite two players`;
    for (let i = 1; i < 3; i++) {
      await director.fill('#inviteUserId', await pages[i].inputValue('#accountId'));
      await director.check('#inviteMovement'); await director.locator('#inviteRoomForm button').click();
      await director.waitForFunction(() => document.getElementById('multiplayerStatus').textContent.startsWith('Invitación a partida'));
      await pages[i].fill('#roomCode', code); await pages[i].locator('#joinRoomForm button').click();
      await pages[i].waitForFunction(() => window.NaufragioBoard.tokens().length === 2 && document.getElementById('roomState').textContent.startsWith('Partida conectada'));
    }
    await director.click('#refreshMembers'); await director.waitForFunction(() => document.querySelectorAll('.member-row').length === 2);
    const starting = await tokens(director);
    for (let i = 0; i < 2; i++) {
      await director.selectOption('#assignedToken', starting[i].id); await director.selectOption('#assignedUsers', accounts[i + 1].id);
      await director.locator('#assignForm button').click();
      await director.waitForFunction(() => document.getElementById('multiplayerStatus').textContent.startsWith('Asignación guardada'));
    }
    await closePanel(director);
    stage = `${basePath} canvas movement and convergence`;
    await moveCanvas(one, starting[0].id, 1, 0);
    await director.waitForFunction(id => window.NaufragioBoard.tokens().find(token => token.id === id).tokenVersion === 1, starting[0].id);
    let confirmed = await tokens(director); await same(pages, confirmed);
    stage = `${basePath} forbidden movement`;
    await two.locator(`[data-token-id="${starting[0].id}"]`).click(); await two.locator('#boardCanvas').focus(); await two.keyboard.press('ArrowRight');
    assert.match(await two.locator('#toast').innerText(), /Sin permiso/); await same(pages, confirmed);
    // Also bypass the UI with a real browser Socket.IO client. The backend must reject it.
    const rejection = await two.evaluate(async ({ api, prefix, roomId, account, password, item }) => {
      const response = await fetch(api + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: account.username, password }), credentials: 'omit' });
      const auth = await response.json(); const { io } = await import('./frontend/vendor/socket.io-4.8.4.esm.min.js');
      const peer = io(api, { path: prefix + '/socket.io', forceNew: true, auth: { token: auth.token, roomId } });
      try {
        const authority = await new Promise((resolve, reject) => { peer.once('room:authority', resolve); peer.once('connect_error', reject); });
        return await peer.timeout(5000).emitWithAck('token:move:request', { version: 1, roomId, epoch: authority.epoch, eventId: crypto.randomUUID(),
          baseRevision: 1, tokenId: item.id, tokenVersion: item.tokenVersion, position: { x: 99, y: 99 } });
      } finally { peer.disconnect(); }
    }, { api, prefix, roomId, account: accounts[2], password: passwords[3], item: confirmed[0] });
    assert.equal(rejection.error.code, 'FORBIDDEN'); await same(pages, confirmed);
    stage = `${basePath} director movement`;
    await moveCanvas(director, starting[1].id, 0, 1);
    await director.waitForFunction(id => window.NaufragioBoard.tokens().find(token => token.id === id).tokenVersion === 1, starting[1].id);
    confirmed = await tokens(director); await same(pages, confirmed);
    stage = `${basePath} disconnect and same browser resume`;
    await openPanel(director); await director.click('#logout');
    for (const page of [one, two]) await page.waitForFunction(() => document.getElementById('roomState').textContent.includes('En espera'));
    assert.equal(await director.evaluate(() => localStorage.getItem('naufragio-vtt-mvp-v1')), preserved);
    await login(director, accounts[0].username, passwords[1]); await director.getByRole('button', { name: 'Abrir Partida de aceptación', exact: true }).click();
    await director.waitForFunction(() => document.getElementById('roomState').textContent.startsWith('Partida conectada'));
    await same(pages, confirmed);
    stage = `${basePath} actual reload and IndexedDB recovery`;
    await director.reload(); await director.waitForFunction(() => window.NaufragioBoard);
    await login(director, accounts[0].username, passwords[1]); await director.getByRole('button', { name: 'Abrir Partida de aceptación', exact: true }).click();
    await director.waitForFunction(() => document.getElementById('roomState').textContent.startsWith('Partida conectada'));
    await same(pages, confirmed);
    stage = `${basePath} second tab Web Lock`;
    const duplicate = await contexts[0].newPage(); duplicate.setDefaultTimeout(20000); await duplicate.goto(url);
    await login(duplicate, accounts[0].username, passwords[1]); await duplicate.getByRole('button', { name: 'Abrir Partida de aceptación', exact: true }).click();
    await duplicate.waitForFunction(() => document.getElementById('multiplayerStatus').textContent.includes('otra pestaña'));
    await duplicate.close();
    assert.match(await director.locator('#roomState').innerText(), /Partida conectada/);
    stage = `${basePath} missing local state`;
    const missingContext = await directorBrowser.newContext(); contexts.push(missingContext);
    const missing = await missingContext.newPage(); missing.setDefaultTimeout(20000); await missing.goto(url);
    await configure(missing, api, api + prefix); await login(missing, accounts[0].username, passwords[1]);
    await missing.getByRole('button', { name: 'Abrir Partida de aceptación', exact: true }).click();
    await missing.waitForFunction(() => document.getElementById('multiplayerStatus').textContent.includes('Falta el estado oficial'));
    assert.match(await director.locator('#roomState').innerText(), /Partida conectada/); await missing.close();
    stage = `${basePath} local data and secret hygiene`;
    for (const page of pages) {
      const values = await page.evaluate(() => JSON.stringify({ ...localStorage }));
      assert.equal(/sess_[A-Za-z0-9_-]{43}|signup_[A-Za-z0-9_-]{43}|room_[A-Za-z0-9_-]{22}|privateKey/.test(values), false);
      for (const password of passwords) assert.equal(values.includes(password), false);
    }
    assert.equal(await director.evaluate(() => localStorage.getItem('naufragio-vtt-mvp-v1')), preserved);
    if (process.env.BROWSER_EVIDENCE_DIR) {
      await mkdir(process.env.BROWSER_EVIDENCE_DIR, { recursive: true });
      await closePanel(director); await director.screenshot({ path: resolve(process.env.BROWSER_EVIDENCE_DIR, `fase5-${basePath === '/' ? 'root' : 'subdirectory'}.png`) });
    }
    await openPanel(director); await director.click('#leaveRoom');
    assert.equal(await director.evaluate(() => localStorage.getItem('naufragio-vtt-mvp-v1')), preserved);
    assert.equal((await tokens(director))[0].id, 'legacy-one');
    const blobSize = await director.evaluate(() => new Promise(resolve => {
      const opening = indexedDB.open('naufragio-vtt-local-assets', 1); opening.onsuccess = () => {
        const db = opening.result, tx = db.transaction('media'), request = tx.objectStore('media').get('active-map-image');
        tx.oncomplete = () => { db.close(); resolve(request.result?.size || 0); };
      };
    }));
    assert.ok(blobSize > 0); assert.deepEqual(pageErrors, []);
    report.push({ basePath, socketPrefix: prefix || '/', director: directorBrowser.browserType().name(), players: [playerBrowser.browserType().name(), 'chromium'],
      result: 'pass', finalTokenVersions: confirmed.map(token => token.tokenVersion), legacyData: 'preserved', realIndexedDB: 'pass', webLocks: 'pass',
      signupAndReuse: 'pass', adminProvisioning: 'pass', missingState: 'rejected' });
  } finally {
    for (const context of contexts) await context.close();
    await app.close(); await closeServer(frontend);
  }
}
try {
  firefoxBrowser = await firefox.launch({ headless: true });
  await localOnly(chromiumBrowser);
  await localOnly(firefoxBrowser);
  await scenario(chromiumBrowser, firefoxBrowser, '/', '');
  await scenario(firefoxBrowser, chromiumBrowser, '/vtt/', '/transport');
  console.log(JSON.stringify({ result: 'pass', artifact: artifactRoot ? 'dist' : 'source', chromium: chromiumBrowser.version(), firefox: firefoxBrowser.version(), scenarios: report }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ result: 'fail', stage, code: error.code || error.name, message: error.message?.slice(0, 180) })); process.exitCode = 1;
} finally { await firefoxBrowser?.close(); await chromiumBrowser.close(); if (artifactRoot) await rm(artifactRoot, { recursive: true, force: true }); }
