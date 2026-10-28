// Real browsers against a remote pilot over an explicitly allowed SSH tunnel.
// Fixture passwords are synthetic, read from a private TEMP file and never logged.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';
import { createDistServer } from './serve-dist.js';

const execute = promisify(execFile);
const required = name => { if (!process.env[name]) throw new Error(name + '_REQUIRED'); return process.env[name]; };
const api = required('PILOT_API');
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(api)) throw new Error('TUNNEL_LOOPBACK_REQUIRED');
const remote = required('PILOT_REMOTE_ROOT');
if (!/^\/var\/tmp\/naufragio-pilot\.[A-Za-z0-9]+$/.test(remote)) throw new Error('INVALID_REMOTE_ROOT');
const fixturePath = required('PILOT_FIXTURE');
const { accounts } = JSON.parse(await readFile(fixturePath, 'utf8'));
if (!Array.isArray(accounts) || accounts.length !== 3 || accounts.some((account, index) => account.username !== `pilot-person-${index}` ||
    typeof account.password !== 'string' || !account.password.startsWith('synthetic-'))) throw new Error('SYNTHETIC_FIXTURE_REQUIRED');
const sshTarget = required('PILOT_SSH_TARGET');
if (sshTarget.startsWith('-') || !/^(?:[a-zA-Z0-9_.-]+@)?[a-zA-Z0-9_.:-]+$/.test(sshTarget)) throw new Error('INVALID_SSH_TARGET');
const sshKey = resolve(required('PILOT_SSH_KEY'));
const { chromium, firefox } = await import(pathToFileURL(resolve(required('BROWSER_TOOLS_DIR'), 'node_modules/playwright/index.mjs')));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const loginSamples = [], healthSamples = [], movementSamples = [];
const report = { result: 'pending', backend: 'SSH tunnel to ARMv7', frontend: 'Windows dist', checks: [], steadyMoves: 0 };
const contexts = [], browsers = [], pageErrors = [], pending = new Map();
let frontend, stage = 'launch';
function measureFrames(page) {
  page.on('websocket', socket => {
    socket.on('framesent', frame => frameEvent(frame, true));
    socket.on('framereceived', frame => frameEvent(frame, false));
  });
  page.on('requestfinished', request => {
    if (request.url() === api + '/auth/login') {
      const value = request.timing().responseEnd;
      if (value >= 0) loginSamples.push(value);
    }
  });
}
function frameEvent(frame, sent) {
  try {
    const value = String(frame.payload);
    if (!/^42\d*\[/.test(value)) return;
    const [event, body] = JSON.parse(value.slice(value.indexOf('[')));
    if (sent && event === 'token:move:request') pending.set(body.eventId, performance.now());
    if (!sent && event === 'token:move:committed' && pending.has(body.eventId)) {
      movementSamples.push(performance.now() - pending.get(body.eventId)); pending.delete(body.eventId);
    }
  } catch { /* Ignore other engine/control frames; never record payloads. */ }
}
async function call(path, body, token, method = body === undefined ? 'GET' : 'POST', expected = 200) {
  const begin = performance.now();
  const response = await fetch(api + path, { method, headers: { Origin: 'http://127.0.0.1:8080',
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const data = response.status === 204 ? null : await response.json();
  assert.equal(response.status, expected, `HTTP ${path}: expected ${expected}, got ${response.status}`);
  if (path === '/health') healthSamples.push(performance.now() - begin);
  if (path === '/auth/login') loginSamples.push(performance.now() - begin);
  return data;
}
async function open(page) { if (!await page.locator('#multiplayerDialog').evaluate(value => value.open)) await page.click('#openMultiplayer'); }
async function close(page) { if (await page.locator('#multiplayerDialog').evaluate(value => value.open)) await page.click('#closeMultiplayer'); }
async function login(page, account) {
  await open(page); await page.check('#trustDestination');
  await page.fill('#loginUser', account.username); await page.fill('#loginPassword', account.password); await page.locator('#loginForm button').click();
  await page.waitForFunction(() => !document.getElementById('signedIn').hidden);
  assert.equal(await page.inputValue('#loginPassword'), '');
}
const tokens = page => page.evaluate(() => window.NaufragioBoard.tokens());
async function same(pages, expected) {
  for (const page of pages) await page.waitForFunction(expected => JSON.stringify(window.NaufragioBoard.tokens()) === JSON.stringify(expected), expected);
}
async function arrow(page, id, direction) {
  await close(page); const before = (await tokens(page)).find(item => item.id === id).tokenVersion;
  await page.locator(`[data-token-id="${id}"]`).click(); await page.locator('#boardCanvas').focus(); await page.keyboard.press(direction);
  await page.waitForFunction(({ id, before }) => window.NaufragioBoard.tokens().find(item => item.id === id).tokenVersion === before + 1, { id, before });
}
async function marker(name) {
  if (!['restart', 'stop'].includes(name)) throw new Error('INVALID_MARKER');
  await execute('ssh', ['-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=10', '-i', sshKey,
    sshTarget, 'touch ' + remote + '/' + name], { timeout: 15000 });
}
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = fraction => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return { samples: sorted.length, minMs: pick(0), medianMs: pick(.5), p95Ms: pick(.95), maxMs: pick(1) };
}
try {
  const config = { schemaVersion: 1, siteName: 'Piloto privado', apiBaseUrl: api, realtimeBaseUrl: api, socketPath: '/socket.io',
    roleLabels: { admin: 'Administración', director: 'Dirección', user: 'Participante' } };
  frontend = await createDistServer({ directory: process.env.PILOT_DIST_DIR, publicConfig: config });
  await new Promise((resolve, reject) => { frontend.once('error', reject); frontend.listen(8080, '127.0.0.1', resolve); });
  const edge = await chromium.launch({ channel: 'msedge', headless: true }); browsers.push(edge);
  const fox = await firefox.launch({ headless: true }); browsers.push(fox);
  report.browsers = { edge: edge.version(), firefox: fox.version() };
  const pages = [];
  for (const engine of [edge, fox, edge]) {
    const context = await engine.newContext({ viewport: { width: 1440, height: 1000 } }); contexts.push(context);
    const page = await context.newPage(); page.setDefaultTimeout(30000); measureFrames(page);
    page.on('pageerror', () => pageErrors.push('PAGE_ERROR'));
    await page.goto('http://127.0.0.1:8080/'); await page.waitForFunction(() => window.NaufragioBoard);
    pages.push(page);
  }
  const [director, one, two] = pages;
  stage = 'authentication';
  for (let index = 0; index < 3; index++) await login(pages[index], accounts[index]);
  const ownerAuth = await call('/auth/login', { username: accounts[0].username, password: accounts[0].password });
  const playerAuth = await call('/auth/login', { username: accounts[2].username, password: accounts[2].password });
  await call('/rooms', { name: 'Forbidden' }, playerAuth.token, 'POST', 403);
  await call('/resources', {}, playerAuth.token, 'POST', 403);
  report.checks.push('login', 'user_cannot_create_room_or_upload');
  stage = 'single use account invitation';
  const invitation = await call('/invitations', {}, ownerAuth.token, 'POST', 201);
  await call('/auth/invitations/validate', { token: invitation.invitation.token });
  await call('/auth/register', { username: 'pilot-invited-user', password: `synthetic-${randomBytes(24).toString('base64url')}`,
    invitationToken: invitation.invitation.token }, undefined, 'POST', 201);
  await call('/auth/invitations/validate', { token: invitation.invitation.token }, undefined, 'POST', 400);
  report.checks.push('account_invitation_signup_and_reuse_denied');
  stage = 'create invite join assign';
  await director.fill('#roomName', 'Piloto privado ARMv7'); await director.locator('#createRoomForm button').click();
  await director.waitForFunction(() => document.getElementById('roomState').textContent.startsWith('Partida conectada'));
  await open(director);
  const code = await director.inputValue('#admissionCode');
  const roomId = await director.locator('#currentRoom').getAttribute('data-room-id');
  for (let index = 1; index < 3; index++) {
    await director.fill('#inviteUserId', accounts[index].id); await director.check('#inviteMovement');
    await director.locator('#inviteRoomForm button').click();
    await director.waitForFunction(() => document.getElementById('multiplayerStatus').textContent.startsWith('Invitación a partida'));
    await pages[index].fill('#roomCode', code); await pages[index].locator('#joinRoomForm button').click();
    await pages[index].waitForFunction(() => document.getElementById('roomState').textContent.startsWith('Partida conectada'));
  }
  await director.click('#refreshMembers'); await director.waitForFunction(() => document.querySelectorAll('.member-row').length === 2);
  const initial = await tokens(director);
  for (let index = 0; index < 2; index++) {
    await director.selectOption('#assignedToken', initial[index].id); await director.selectOption('#assignedUsers', accounts[index + 1].id);
    await director.locator('#assignForm button').click(); await director.waitForFunction(() => document.getElementById('multiplayerStatus').textContent.startsWith('Asignación guardada'));
  }
  report.checks.push('named_invitations_and_room_code', 'token_assignments');
  stage = 'movements permissions'; await wait(1000);
  await arrow(one, initial[0].id, 'ArrowRight'); let confirmed = await tokens(one); await same(pages, confirmed);
  await two.locator(`[data-token-id="${initial[0].id}"]`).click(); await two.locator('#boardCanvas').focus(); await two.keyboard.press('ArrowRight');
  assert.match(await two.locator('#toast').innerText(), /Sin permiso/); await same(pages, confirmed);
  await call(`/rooms/${roomId}/members/${accounts[2].id}`, { permissions: { moveAssignedTokens: false } }, ownerAuth.token, 'PATCH');
  const rejected = await two.evaluate(async ({ api, token, roomId, item }) => {
    const { io } = await import('./frontend/vendor/socket.io-4.8.4.esm.min.js');
    const peer = io(api, { forceNew: true, auth: { token, roomId } });
    try {
      const authority = await new Promise((resolve, reject) => { peer.once('room:authority', resolve); peer.once('connect_error', reject); });
      return await peer.timeout(10000).emitWithAck('token:move:request', { version: 1, roomId, epoch: authority.epoch, eventId: crypto.randomUUID(),
        baseRevision: authority.revision, tokenId: item.id, tokenVersion: item.tokenVersion, position: { x: 99, y: 99 } });
    } finally { peer.disconnect(); }
  }, { api, token: playerAuth.token, roomId, item: confirmed[1] });
  assert.equal(rejected.error.code, 'FORBIDDEN'); await same(pages, confirmed);
  await call(`/rooms/${roomId}/members/${accounts[2].id}`, { permissions: { moveAssignedTokens: true } }, ownerAuth.token, 'PATCH');
  await arrow(director, initial[1].id, 'ArrowDown'); confirmed = await tokens(director); await same(pages, confirmed);
  report.checks.push('convergence', 'unassigned_move_denied', 'revoked_permission_backend_denied', 'director_move');
  stage = 'logout and recovery';
  await open(director); await director.click('#logout');
  for (const page of [one, two]) await page.waitForFunction(() => document.getElementById('roomState').textContent.includes('En espera'));
  await login(director, accounts[0]); await director.getByRole('button', { name: 'Abrir Piloto privado ARMv7', exact: true }).click();
  await director.waitForFunction(() => document.getElementById('roomState').textContent.startsWith('Partida conectada')); await same(pages, confirmed);
  await director.reload(); await director.waitForFunction(() => window.NaufragioBoard); await login(director, accounts[0]);
  await director.getByRole('button', { name: 'Abrir Piloto privado ARMv7', exact: true }).click();
  await director.waitForFunction(() => document.getElementById('roomState').textContent.startsWith('Partida conectada')); await same(pages, confirmed);
  report.checks.push('waiting_on_logout', 'same_browser_login_recovery', 'indexeddb_reload_recovery');
  stage = 'backend restart';
  await marker('restart');
  await director.waitForFunction(() => document.getElementById('roomState').textContent.includes('En espera'));
  await director.waitForFunction(() => document.getElementById('roomState').textContent.startsWith('Partida conectada'), null, { timeout: 45000 });
  await same(pages, confirmed); report.checks.push('backend_restart_sqlite_and_authority_recovery');
  stage = 'five minute three-client stability';
  const began = performance.now();
  for (let index = 0; index < 30; index++) {
    const actor = [one, two, director][index % 3];
    const id = initial[index % 3 === 1 ? 1 : 0].id;
    await arrow(actor, id, index % 2 ? 'ArrowLeft' : 'ArrowRight');
    confirmed = await tokens(actor); await same(pages, confirmed); report.steadyMoves++;
    for (let j = 0; j < 2; j++) { await call('/health'); await wait(5000); }
    if (index % 5 === 4) console.log(JSON.stringify({ state: 'steady', moves: report.steadyMoves, seconds: Math.round((performance.now() - began) / 1000) }));
  }
  report.steadySeconds = (performance.now() - began) / 1000;
  report.finalTokenVersions = confirmed.map(item => item.tokenVersion);
  report.checks.push('three_clients_stable_for_five_minutes');
  assert.deepEqual(pageErrors, []);
  if (process.env.PILOT_EVIDENCE_DIR) {
    await mkdir(process.env.PILOT_EVIDENCE_DIR, { recursive: true });
    for (let index = 0; index < 3; index++) { await close(pages[index]); await pages[index].screenshot({ path: resolve(process.env.PILOT_EVIDENCE_DIR, `armv7-client-${index}.png`) }); }
  }
  report.result = 'pass'; report.latency = { login: summary(loginSamples), health: summary(healthSamples), movementWire: summary(movementSamples) };
} catch (error) {
  report.result = 'fail'; report.stage = stage; report.errorCode = error.code ?? error.name;
  // Assertion messages/objects can contain synthetic secrets; do not print them.
  process.exitCode = 1;
} finally {
  for (const context of contexts) await context.close();
  for (const browser of browsers) await browser.close();
  if (frontend) await new Promise(resolve => { frontend.close(resolve); frontend.closeAllConnections(); });
  await rm(fixturePath, { force: true });
  if (process.env.PILOT_REPORT) await writeFile(process.env.PILOT_REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
