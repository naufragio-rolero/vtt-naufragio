import { validateSiteConfig } from '../backend/public/site-config.js';
import { createTokenClient } from '../backend/client/token-client.js';
import { createIndexedDbStore } from '../backend/client/indexeddb-store.js';
import { createAssetClient } from '../backend/client/asset-client.js';
import { createRoomMediaStore } from './room-media-store.js';
import { io } from './vendor/socket.io-4.8.4.esm.min.js';
import { initialRoomTokens, publicTokens, socketDestination } from './board-model.js';
import { initQr } from './qr.js';
import { insideBounds, mapBounds } from '../backend/shared/board-bounds.js';
import { parseDice } from '../backend/shared/dice.js';

if (!window.NaufragioBoard) await new Promise(resolve => window.addEventListener('naufragio:board:ready', resolve, { once: true }));
const board = window.NaufragioBoard;
const get = id => document.getElementById(id);
const CONFIG_KEY = 'naufragio-vtt-public-config-v1';
const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
let config = null, session = null, room = null, socket = null, client = null, storage = null, expiry = null;
let rights = null, members = [], pending = new Map(), generation = 0, validatedSignup = null;
let assetClient = null, mediaStore = null, mediaSource = null, lastPublishedEpoch = null;
let publishQueue = Promise.resolve();
let presence = [];
let scene = {revision:0,mode:'map',bounds:null,sizes:{}};
let sharedRolls = [], localRolls = [], diceBusy = false;
async function command(event, body = {}) {
  if (!socket?.connected || !room) throw new Error('DIRECTOR_NOT_READY');
  const answer = await socket.timeout(12000).emitWithAck(event,{version:1,roomId:room.room.id,...body});
  if (!answer.ok) throw new Error(answer.error?.code || 'INVALID_MESSAGE');
  return answer;
}
const errors = {
  INVALID_CREDENTIALS: 'Usuario o contraseña incorrectos.', INVALID_INVITATION: 'Invitación de alta caducada, usada, revocada o inválida.',
  ROOM_ACCESS_DENIED: 'No tienes autorización o el código de sala no es válido.', FORBIDDEN: 'No tienes permiso para esta operación.',
  DIRECTOR_NOT_READY: 'En espera del director y de su estado local.', OFFICIAL_STATE_UNAVAILABLE: 'Falta el estado oficial o la clave en este navegador. Usa el mismo navegador y origen; la sala permanece en espera.',
  OFFICIAL_STATE_MISMATCH: 'El estado local no coincide con el confirmado. Se conserva la sala en espera.', LOCAL_STATE_IN_USE: 'Esta partida ya está abierta en otra pestaña de este navegador.',
  LOCAL_LOCK_UNAVAILABLE: 'Este navegador no dispone de Web Locks en un contexto seguro.', TOKEN_LIMIT: 'Prepara un máximo de 64 tokens en la mesa local antes de crear la partida. No se ha eliminado ninguno.',
  TOKEN_BUSY: 'Otro movimiento de este token está pendiente. Inténtalo tras la confirmación.', STALE_MOVE: 'Ha cambiado el estado. Espera la sincronización y vuelve a intentarlo.',
  UNAUTHENTICATED: 'La sesión ha caducado o ha sido revocada. Inicia sesión de nuevo.', RATE_LIMITED: 'Se ha alcanzado el límite de mensajes. Espera antes de reconectar.',
  INVALID_INPUT: 'Revisa los campos y la política de contraseña (15–128 caracteres).', DESTINATION_REQUIRED: 'Configura y confirma los destinos antes de enviar credenciales.',
  PERMISSION_REVOKED: 'El movimiento se rechazó porque se retiró el permiso.', DIRECTOR_DISCONNECTED: 'Movimiento cancelado: el director se ha desconectado.',
  ASSET_MANIFEST_INVALID: 'Los metadatos de imágenes no son válidos.', TRANSFER_INTERRUPTED: 'Transferencia interrumpida; reconecta para repetirla.',
  OUTSIDE_BOARD: 'Fuera del área jugable. Se conserva la última posición válida.',
  TOKENS_OUTSIDE_BOARD: 'Hay fichas fuera del área propuesta. Ajusta sus posiciones o cambia/desactiva los límites antes de confirmar.',
  STALE_SCENE: 'Los límites han cambiado. Reabre el panel para actualizarlos.',
  INVALID_DICE: 'Notación inválida. Usa 1–50 dados d4, d6, d8, d10, d12, d20 o d100 y modificador entre -1000 y 1000.',
  DICE_RATE_LIMITED: 'Máximo seis tiradas cada diez segundos. Espera antes de lanzar de nuevo.',
  ROLL_REPLAYED: 'La petición de tirada ya se utilizó. Consulta el historial antes de repetir.',
  STALE_ROLL: 'Petición de tirada caducada. Comprueba la hora del dispositivo y vuelve a lanzar.',
  HASH_MISMATCH: 'La imagen no coincide con SHA-256.', TRANSFER_BUSY: 'Hay demasiadas transferencias.', ASSET_SOURCE_MISMATCH: 'La imagen del director no coincide con lo publicado.'
};
function status(message, error = false) {
  get('multiplayerStatus').textContent = message; get('multiplayerStatus').dataset.error = String(error);
  if (error) board.notify(message);
  get('admissionNotice').textContent = message;
}
const describe = error => errors[error?.message] || 'No se pudo completar la operación. Revisa la conexión, los permisos y los campos.';
function action(element, event, work) {
  get(element).addEventListener(event, async e => {
    e.preventDefault(); const button = e.submitter || (e.currentTarget.tagName === 'BUTTON' ? e.currentTarget : null);
    if (button) button.disabled = true;
    try { await work(); } catch (error) { status(describe(error), true); }
    finally { if (button) button.disabled = false; }
  });
}
function validateConfig(value) { return validateSiteConfig(value, { development: localHost }); }
function showConfig() {
  get('apiDestination').textContent = config ? `API: ${config.apiBaseUrl} · Tiempo real: ${config.realtimeBaseUrl} · Ruta Socket.IO: ${socketDestination(config).path}` : 'Sin backend configurado. La mesa local sigue disponible.';
  get('trustDestination').checked = false;
}
function requireDestination() { if (!config || !get('trustDestination').checked) throw new Error('DESTINATION_REQUIRED'); }
async function api(path, { method = 'GET', body, authenticated = true } = {}) {
  if (!config) throw new Error('DESTINATION_REQUIRED');
  const response = await fetch(config.apiBaseUrl.replace(/\/$/, '') + path, { method, credentials: 'omit', redirect: 'error', cache: 'no-store',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(authenticated && session ? { Authorization: `Bearer ${session.token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
  const value = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    if (response.status === 401 && authenticated) await clearSession(false);
    throw new Error(value?.error?.code || 'API_ERROR');
  }
  return value;
}
function sessionView() {
  get('signedIn').hidden = !session; get('signedOut').hidden = Boolean(session);
  get('directorAccess').hidden = session?.user.role !== 'director';
  get('adminAccess').hidden = session?.user.role !== 'admin';
  get('openSettings').disabled = Boolean(session || room);
  get('accountLabel').textContent = session ? `${session.user.username} · ${config.roleLabels[session.user.role]}` : '';
  get('accountId').value = session?.user.id || '';
}
function roomView() {
  renderDice();
  document.querySelector('.table-title h1').textContent = room?.room.name || 'Mesa sin nombre';
  document.querySelector('.topbar-overline').textContent = room ? 'PARTIDA COMPARTIDA' : 'TABLERO LOCAL';
  get('tableModeLabel').textContent = room ? 'COMPARTIDA' : 'LOCAL';
  get('tableModeHelp').textContent = room ? 'Solo las posiciones confirmadas son oficiales. Los ajustes de vista son personales.' : 'Tu propio tablero de pruebas. Los cambios se guardan en este navegador.';
  get('currentRoom').hidden = !room;
  get('openPlayers').hidden = !room;
  get('tableInvite').hidden = !room?.isOwner;
  get('openMap').hidden = Boolean(room && !room.isOwner);
  get('openBounds').hidden = Boolean(room && !room.isOwner);
  get('playersAdministration').hidden = !room?.isOwner;
  get('playersConnection').textContent = room ? (socket?.connected ? 'Conectado a la sala' : 'Desconectado · reconectando…') : 'Sin sala';
  if (!room) get('playersPanel').hidden = true;
  get('roomAdministration').hidden = !room?.isOwner;
  if (!room) { get('connectionState').textContent = 'Solo este navegador'; return; }
  const ready = Boolean(client?.state.ready && client.state.snapshot && socket?.connected);
  const message = client?.state.error ? describe(new Error(client.state.error)) : ready ? 'Partida conectada' : 'En espera del director';
  get('connectionState').textContent = message;
  get('roomState').textContent = `${message}${client?.state.snapshot ? ` · Revisión ${client.state.snapshot.revision}` : ''}`;
  get('currentRoomName').textContent = room.room.name;
  get('currentRoom').dataset.roomId = room.room.id;
  get('assignForm').querySelector('button').disabled = !ready || !room.isOwner;
  get('sharedMediaEditor').hidden = !room.isOwner;
}
function canMove(id) {
  return Boolean(room && client?.state.ready && client.state.snapshot && socket?.connected && pending.size === 0 && rights &&
    (rights.isOwner || rights.moveAssignedTokens && rights.assignedTokenIds.includes(id)));
}
async function move(id, point) {
  if (!canMove(id)) { status(errors.FORBIDDEN, true); return; }
  if (!insideBounds(point,scene.sizes[id]||1,scene.bounds)) { status(errors.OUTSIDE_BOARD,true); return; }
  const eventId = crypto.randomUUID(); pending.set(eventId, id);
  try {
    const result = await client.move(id, point, eventId);
    if (result.status !== 'pending') pending.delete(eventId);
  } catch (error) { pending.delete(eventId); status(describe(error), true); }
}
async function leave() {
  qrControls?.reset();
  sharedRolls = [];
  generation++; const old = client, oldStorage = storage;
  assetClient?.close(); assetClient = null; mediaStore = null; mediaSource = null; lastPublishedEpoch = null;
  client = null; socket?.disconnect(); socket = null; storage = null; room = null; rights = null; pending.clear(); members = []; presence = []; renderPeople();
  if (old) { old.close(); await old.settled(); }
  oldStorage?.close(); board.exitShared();
  get('admissionCode').value = ''; get('presence').textContent = ''; get('members').replaceChildren(); roomView();
}
async function clearSession(revoke = true) {
  await leave();
  try { if (revoke && session) await api('/auth/logout', { method: 'POST', body: {} }); }
  finally { sessionStorage.removeItem('naufragio-guest-session-v1'); sessionStorage.removeItem('naufragio-guest-pending-v1'); session = null; clearTimeout(expiry); get('signupOutput').value = ''; get('roomCode').value = ''; get('roomList').replaceChildren(); sessionView(); }
}
async function publishMedia() {
  if (!room?.isOwner || !mediaSource || !assetClient?.epoch || !client?.state.ready) return;
  const bridge = assetClient, roomId = room.room.id, epoch = bridge.epoch;
  // Serialize publications so one slow SHA-256 calculation never reuses a revision.
  lastPublishedEpoch = epoch;
  publishQueue = publishQueue.catch(() => {}).then(async () => {
    if (assetClient !== bridge || room?.room.id !== roomId || bridge.epoch !== epoch) return;
    try {
      await bridge.publish(mediaSource);
      status('Mapa y recursos públicos compartidos.');
    } catch (error) { lastPublishedEpoch = null; throw error; }
  });
  return publishQueue;
}
function genericMedia(tokens) {
  const colors = ['#85dcd2', '#e7c47e', '#dd8e88', '#a6a1e9', '#a8c984', '#90b7e7'];
  return { map: null, tokens: tokens.map((token, index) => ({
    id: token.id, name: 'Token ' + (index + 1), color: colors[index % colors.length], size: 1, imageId: null
  })), files: {} };
}
async function saveMedia() {
  if (!room?.isOwner || !mediaStore || !mediaSource) throw new Error('FORBIDDEN');
  await mediaStore.save(mediaSource);
  await publishMedia();
}
async function prepareMedia(selected, initialMedia) {
  if (!selected.isOwner) return;
  mediaStore = createRoomMediaStore(config.apiBaseUrl + '|' + session.user.id + '|' + selected.room.id);
  mediaSource = initialMedia || await mediaStore.load();
  if (initialMedia) await mediaStore.save(initialMedia);
}
async function enter(selected, initialTokens, admissionCode, initialMedia) {
  await leave(); room = selected;
  await prepareMedia(selected, initialMedia);
  const current = ++generation;
  board.enterShared({ canMove, move, canEdit: () => Boolean(room?.isOwner && client?.state.ready), identityName: session.user.username, roleLabel: config.roleLabels[session.user.role] });
  const destination = socketDestination(config);
  socket = io(destination.origin, { path: destination.path, autoConnect: false, forceNew: true, reconnection: true,
    auth: { token: session.token, roomId: room.room.id } });
  const live = socket;
  live.on('dice:history', value => { if (current === generation) { sharedRolls = value.rolls; renderDice(); } });
  live.on('dice:result', value => { if (current === generation) { sharedRolls = [value.roll,...sharedRolls.filter(r=>r.id!==value.roll.id)].slice(0,50); renderDice(); } });
  live.on('room:scene', value => { if (current === generation) { scene = value; board.applyBounds(value); } });
  storage = room.isOwner ? createIndexedDbStore(`${config.apiBaseUrl.replace(/\/$/, '')}|${session.user.id}|${room.room.id}`) : null;
  client = createTokenClient(live, { roomId: room.room.id, director: room.isOwner, store: storage, initialTokens,
    onChange: value => {
      if (current !== generation) return;
      if (value.snapshot) {
        board.applyShared(publicTokens(value.snapshot));
        if (room?.isOwner && !mediaSource) {
          mediaSource = genericMedia(publicTokens(value.snapshot));
          void saveMedia().catch(error => status(describe(error), true));
        }
        if (room?.isOwner && value.ready && assetClient?.epoch === value.epoch &&
            lastPublishedEpoch !== value.epoch && mediaSource) {
          void publishMedia().catch(error => status(describe(error), true));
        }
      }
      if (value.error) status(describe(new Error(value.error)), true);
      fillTokens(); roomView();
    } });
  assetClient = createAssetClient(live, {
    roomId: room.room.id, director: room.isOwner, getSource: async id => mediaSource?.files?.[id] || null,
    onUpdate: value => { if (current === generation) void board.applySharedResources(value); },
    onError: error => { if (current === generation) { status(describe(new Error(error)), true); get('mapTransferStatus').textContent = describe(new Error(error)) + ' Se conserva el último mapa verificado; reconecta para reintentar.'; } },
    onProgress: value => { if (current === generation && value.assetId === 'map') get('mapTransferStatus').textContent = `Enviando mapa · ${value.percent}% de una transferencia. Cada participante verifica SHA-256 al finalizar.`; }
  });
  live.on('room:authority', value => {
    if (current !== generation || !room?.isOwner || !mediaSource || value.state !== 'active') return;
    setTimeout(() => {
      if (current === generation && assetClient?.epoch === value.epoch && client?.state.ready &&
          lastPublishedEpoch !== value.epoch) void publishMedia().catch(error => status(describe(error), true));
    }, 0);
  });
  live.on('tokens:permissions', value => { if (current === generation) { rights = value.permissions; fillAssignments(); roomView(); } });
  live.on('room:presence', value => {
    if (current !== generation) return;
    get('presence').textContent = value.participants.map(person => `${person.username} (${person.role === 'director' ? config.roleLabels.director : config.roleLabels.user})`).join(' · ') || 'Sin participantes conectados';
    presence = value.participants; renderPeople();
    if (room?.isOwner) void refreshMembers().catch(error => status(describe(error), true));
    roomView();
  });
  live.on('token:move:committed', value => { if (current === generation) { pending.delete(value.eventId); status('Movimiento confirmado.'); } });
  live.on('token:move:rejected', value => { if (current === generation) { pending.delete(value.eventId); status(errors[value.reason] || 'Movimiento rechazado; se conserva la posición confirmada.', true); } });
  live.on('disconnect', reason => { if (current === generation) {
    pending.clear(); roomView();
    if(session?.user.guest && reason==='io server disconnect') void clearSession(false).then(()=>status('Tu acceso temporal ha terminado o ha sido retirado.',true));
  } });
  live.on('connect_error', error => { if (current === generation) { status(describe(error), true); roomView(); } });
  live.io.on('reconnect_attempt', () => { if (current === generation) get('roomState').textContent = 'Reconectando…'; });
  qrControls.start();
  get('admissionCode').value = admissionCode?.code || '';
  get('multiplayerDialog').close(); live.connect(); roomView();
  if (room.isOwner) await refreshMembers();
}
function appendButton(container, text, work) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
  button.addEventListener('click', () => { void work().catch(error => status(describe(error), true)); }); container.append(button);
}
async function refreshRooms() {
  const [list, invites] = await Promise.all([api('/rooms'), api('/room-invitations')]);
  get('roomList').replaceChildren();
  for (const entry of list.rooms) appendButton(get('roomList'), `Abrir ${entry.name}`, async () => enter(await api(`/rooms/${entry.id}`)));
  get('roomInvitations').replaceChildren();
  for (const invite of invites.invitations) { const p = document.createElement('p'); p.textContent = `Invitación a ${invite.name}: pide su código al director para unirte.`; get('roomInvitations').append(p); }
}
function fillTokens() {
  const select = get('assignedToken'); const before = select.value;
  const ids = board.tokens();
  if ([...select.options].map(option => option.value).join() === ids.map(token => token.id).join()) return;
  select.replaceChildren(...ids.map(token => new Option(token.code, token.id)));
  if (ids.some(token => token.id === before)) select.value = before;
  fillAssignments();
  const selected = mediaSource?.tokens.find(token => token.id === select.value);
  if (selected) {
    get('sharedTokenName').value = selected.name;
    get('sharedTokenColor').value = selected.color;
    get('sharedTokenSize').value = String(selected.size);
  }
}
function fillAssignments() {
  const select = get('assignedUsers'); const tokenId = get('assignedToken').value;
  select.replaceChildren(...members.filter(member => member.userId !== session?.user.id).map(member => {
    const option = new Option(member.username, member.userId);
    option.selected = rights?.assignments?.some(row => row.tokenId === tokenId && row.userId === member.userId) || false;
    return option;
  }));
}
function renderPeople() {
  get('connectedPlayers').replaceChildren();
  for (const person of presence) {
    const row = document.createElement('p');
    row.textContent = `${person.username} · ${person.role === 'director' ? 'Director' : 'Jugador'} · conectado`;
    get('connectedPlayers').append(row);
  }
}
async function refreshMembers() {
  if (!room?.isOwner) return;
  const id = room.room.id;
  const value = await api(`/rooms/${id}/members`);
  if (room?.room.id !== id) return;
  members = value.members; get('members').replaceChildren();
  for (const member of members.filter(member => member.userId !== session.user.id)) {
    const row = document.createElement('div'); row.className = 'member-row'; row.dataset.userId = member.userId;
    const name = document.createElement('strong'); name.textContent = `${member.username} · ${presence.some(p => p.id === member.userId) ? 'conectado' : 'autorizado, desconectado'}`; row.append(name);
    const controls = {};
    for (const [key, text] of [['moveAssignedTokens', 'Permitir movimiento asignado'], ['diceAllowed', 'Permitir tiradas']]) {
      const label = document.createElement('label'); label.textContent = text;
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = member.permissions[key];
      label.prepend(checkbox); row.append(label); controls[key] = checkbox;
    }
    appendButton(row, 'Actualizar permiso', async () => {
      await api(`/rooms/${id}/members/${member.userId}`, { method:'PATCH', body:{permissions:Object.fromEntries(Object.entries(controls).map(([key, checkbox]) => [key, checkbox.checked]))} });
      status('Permisos actualizados.'); await refreshMembers();
    });
    appendButton(row, 'Retirar acceso', async () => { await api(`/rooms/${id}/members/${member.userId}/revoke`, {method:'POST', body:{}}); await refreshMembers(); });
    get('members').append(row);
  }
  fillAssignments();
}
get('tableAssignments').append(get('assignForm'));
function togglePlayers(open) {
  if (open) { get('dicePanel').hidden = true; get('openDice').setAttribute('aria-expanded','false'); }
  get('playersPanel').hidden = !open; get('openPlayers').setAttribute('aria-expanded', String(open));
  if (open) get('closePlayers').focus(); else get('openPlayers').focus();
}
get('openPlayers').addEventListener('click', () => togglePlayers(get('playersPanel').hidden));
get('closePlayers').addEventListener('click', () => togglePlayers(false));
get('playersPanel').addEventListener('keydown', event => { if (event.key === 'Escape') togglePlayers(false); });
get('tableInvite').addEventListener('click', () => get('inviteQr').click());
get('openMultiplayer').addEventListener('click', () => get('multiplayerDialog').showModal());
get('closeMultiplayer').addEventListener('click', () => get('multiplayerDialog').close());
get('openSettings').addEventListener('click', () => {
  if (session || room) return;
  get('settingsDialog').showModal();
  if (config) get('settingsFrame').contentWindow.postMessage({ type: 'naufragio:settings:load', config }, location.origin);
});
get('closeSettings').addEventListener('click', () => get('settingsDialog').close());
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== get('settingsFrame').contentWindow) return;
  if (event.data?.type === 'naufragio:settings:ready' && config) event.source.postMessage({ type: 'naufragio:settings:load', config }, location.origin);
  if (event.data?.type !== 'naufragio:settings:apply' || session || room) return;
  try { config = validateConfig(event.data.config); localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); showConfig(); get('settingsDialog').close(); status('Configuración pública aplicada solo en este navegador.'); }
  catch { status('Configuración rechazada: revisa HTTPS, localhost y los campos.', true); }
});
action('loginForm', 'submit', async () => {
  requireDestination();
  try { session = await api('/auth/login', { method: 'POST', authenticated: false, body: { username: get('loginUser').value, password: get('loginPassword').value } }); }
  finally { get('loginPassword').value = ''; }
  sessionView();
  clearTimeout(expiry); expiry = setTimeout(() => { void clearSession(false).then(() => status(errors.UNAUTHENTICATED, true)); }, Math.max(1, session.expiresAt - Date.now()));
  try { const labels = await api('/roles'); config = validateConfig({ ...config, roleLabels: labels.roleLabels }); } catch { /* Public labels can be retried; identity always uses stable role IDs. */ }
  if (!session) throw new Error('UNAUTHENTICATED');
  sessionView(); status('Sesión iniciada. Selecciona una partida autorizada.'); await refreshRooms();
});
action('validateSignupForm', 'submit', async () => {
  requireDestination(); validatedSignup = null; get('signupFields').disabled = true;
  const invitation = await api('/auth/invitations/validate', { method: 'POST', authenticated: false, body: { token: get('signupInvitation').value } });
  if (invitation.valid !== true || invitation.kind !== 'account_signup' || invitation.role !== 'user') throw new Error('INVALID_INVITATION');
  validatedSignup = get('signupInvitation').value; get('signupFields').disabled = false; status('Invitación de alta válida. Puedes crear una cuenta ordinaria.');
});
get('signupInvitation').addEventListener('input', () => { validatedSignup = null; get('signupFields').disabled = true; });
action('signupForm', 'submit', async () => {
  requireDestination(); if (!validatedSignup || validatedSignup !== get('signupInvitation').value) throw new Error('INVALID_INVITATION');
  try { await api('/auth/register', { method: 'POST', authenticated: false, body: { username: get('signupUser').value, password: get('signupPassword').value, invitationToken: validatedSignup } }); }
  finally { get('signupPassword').value = ''; }
  get('signupInvitation').value = ''; validatedSignup = null; get('signupFields').disabled = true; status('Cuenta ordinaria creada. Inicia sesión.');
});
action('logout', 'click', async () => { await clearSession(); status('Sesión cerrada. Tus datos locales y el diario de la partida se conservan.'); });
action('createDirectorForm', 'submit', async () => {
  try { await api('/users', { method: 'POST', body: { username: get('newDirectorUser').value, password: get('newDirectorPassword').value, role: 'director' } }); }
  finally { get('newDirectorPassword').value = ''; }
  status('Perfil de dirección creado. Comunica sus credenciales por un canal privado.');
});
action('createRoomForm', 'submit', async () => {
  const local = await board.localResources();
  const tokens = initialRoomTokens(local.tokens);
  const media = {
    map: local.map ? { ...local.map, imageId: 'map' } : null,
    tokens: local.tokens.map((token, index) => ({
      id: tokens[index].id, name: (token.name || token.code || ('Token ' + (index + 1))).slice(0, 64),
      color: /^#[0-9a-fA-F]{6}$/.test(token.color) ? token.color : '#85dcd2',
      size: token.size || 1, imageId: local.files[token.imageId] ? 'token:'+tokens[index].id : null
    })),
    files: { ...(local.map && local.blob ? { map: local.blob } : {}),
      ...Object.fromEntries(local.tokens.flatMap((token,index)=>local.files[token.imageId] ? [['token:'+tokens[index].id,local.files[token.imageId]]] : [])) }
  };
  const created = await api('/rooms', { method: 'POST', body: { name: get('roomName').value } });
  const selected = await api('/rooms/' + created.room.id);
  await enter(selected, tokens, created.admissionCode, media);
  await refreshRooms();
});
action('joinRoomForm', 'submit', async () => { const selected = await api('/rooms/join', { method: 'POST', body: { code: get('roomCode').value } }); get('roomCode').value = ''; await enter(selected); await refreshRooms(); });
action('refreshRooms', 'click', refreshRooms);
action('leaveRoom', 'click', async () => { await leave(); status('De vuelta a tu mesa local; los datos anteriores se conservan.'); });
action('reconnectRoom', 'click', async () => { const selected = room; if (selected) await enter(selected); });
action('createSignup', 'click', async () => { const value = await api('/invitations', { method: 'POST', body: {} }); get('signupOutput').value = value.invitation.token; status('Invitación de alta generada. Compártela en privado; no es un código de sala.'); });
action('inviteRoomForm', 'submit', async () => { await api(`/rooms/${room.room.id}/invitations`, { method: 'POST', body: { userId: get('inviteUserId').value, permissions: { moveAssignedTokens: get('inviteMovement').checked } } }); status('Invitación a partida emitida. Comparte también el código de sala.'); });
action('rotateCode', 'click', async () => { const value = await api(`/rooms/${room.room.id}/code/rotate`, { method: 'POST', body: {} }); get('admissionCode').value = value.admissionCode.code; status('Código nuevo. El anterior ya no permite admisiones.'); });
action('revokeCode', 'click', async () => { await api(`/rooms/${room.room.id}/code/revoke`, { method: 'POST', body: {} }); get('admissionCode').value = ''; status('Código revocado. Los participantes autorizados conservan su pertenencia.'); });
action('refreshMembers', 'click', refreshMembers);
get('assignedToken').addEventListener('change', fillAssignments);
action('assignForm', 'submit', async () => { await client.assign(get('assignedToken').value, [...get('assignedUsers').selectedOptions].map(option => option.value)); status('Asignación guardada en el backend.'); });

async function validateImage(file, max) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size < 1 || file.size > max) throw new Error('ASSET_MANIFEST_INVALID');
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width > 8000 || bitmap.height > 8000 ||
        bitmap.width * bitmap.height > 20000000) throw new Error('ASSET_MANIFEST_INVALID');
    return { widthPx: bitmap.width, heightPx: bitmap.height };
  } finally { bitmap.close(); }
}
action('sharedTokenUpload', 'change', async () => {
  if (!room?.isOwner || !mediaSource) throw new Error('FORBIDDEN');
  const file = get('sharedTokenUpload').files?.[0], id = get('assignedToken').value;
  try {
    if (!file) return;
    await validateImage(file, 2 * 1024 * 1024);
    const token = mediaSource.tokens.find(token => token.id === id);
    if (!token) throw new Error('TOKEN_NOT_FOUND');
    token.imageId = 'token:' + id; mediaSource.files[token.imageId] = file; await saveMedia();
  } finally { get('sharedTokenUpload').value = ''; }
});
action('sharedRemoveTokenImage', 'click', async () => {
  const token = mediaSource?.tokens.find(token => token.id === get('assignedToken').value);
  if (!room?.isOwner || !token) throw new Error('FORBIDDEN');
  if (token.imageId) delete mediaSource.files[token.imageId];
  token.imageId = null; await saveMedia();
});
action('sharedTokenAppearance', 'submit', async () => {
  const token = mediaSource?.tokens.find(token => token.id === get('assignedToken').value);
  if (!room?.isOwner || !token) throw new Error('FORBIDDEN');
  const name = get('sharedTokenName').value.trim().slice(0, 64);
  const color = get('sharedTokenColor').value, size = Number(get('sharedTokenSize').value);
  if (!name || !/^#[0-9a-fA-F]{6}$/.test(color) || !(size >= 0.25 && size <= 4)) throw new Error('INVALID_INPUT');
  token.name = name; token.color = color; token.size = size;
  await saveMedia();
});
get('assignedToken').addEventListener('change', () => {
  const token = mediaSource?.tokens.find(token => token.id === get('assignedToken').value);
  if (!token) return;
  get('sharedTokenName').value = token.name;
  get('sharedTokenColor').value = token.color;
  get('sharedTokenSize').value = String(token.size);
});

function renderDice() {
  const allowed = !room || Boolean(socket?.connected && client?.state.ready && (rights?.isOwner || rights?.diceAllowed));
  get('rollDice').disabled = diceBusy || !allowed;
  get('diceMode').textContent = room ? (allowed ? 'Pública para la sala · resultado verificado por el servidor' : 'Pública para la sala · sin permiso o esperando conexión con el director') : 'Tirada local · solo este navegador, sin verificación del servidor';
  get('diceHistory').replaceChildren();
  for (const roll of room ? sharedRolls : localRolls) {
    const item = document.createElement('li'); item.dataset.rollId = roll.id;
    const modifier = roll.modifier ? ` ${roll.modifier > 0 ? '+' : '−'} ${Math.abs(roll.modifier)}` : '';
    item.textContent = `${roll.author.name} · ${roll.notation}: [${roll.results.join(', ')}]${modifier} = ${roll.total} · ${new Date(roll.time).toLocaleTimeString()} · ${roll.verified ? 'Servidor' : 'Local'}`;
    get('diceHistory').append(item);
  }
}
get('openDice').addEventListener('click', () => {
  const open = get('dicePanel').hidden;
  get('dicePanel').hidden = !open; get('openDice').setAttribute('aria-expanded',String(open));
  if (open) { get('playersPanel').hidden = true; get('openPlayers').setAttribute('aria-expanded','false'); get('diceNotation').focus(); }
  renderDice();
});
function closeDice() { get('dicePanel').hidden = true; get('openDice').setAttribute('aria-expanded','false'); get('openDice').focus(); }
get('closeDice').addEventListener('click',closeDice);
get('dicePanel').addEventListener('keydown', event => { if (event.key==='Escape') closeDice(); });
for (const id of ['dieSides','dieCount','dieModifier']) get(id).addEventListener('input', () => {
  const modifier = Number(get('dieModifier').value);
  get('diceNotation').value = `${get('dieCount').value}d${get('dieSides').value}${modifier ? (modifier > 0 ? '+' : '') + modifier : ''}`;
});
get('diceForm').addEventListener('submit', async event => {
  event.preventDefault(); if (diceBusy || get('rollDice').disabled) return;
  diceBusy = true; renderDice();
  try {
    const notation = get('diceNotation').value;
    let dice; try { dice = parseDice(notation); } catch { throw new Error('INVALID_DICE'); }
    get('dieSides').value = String(dice.sides); get('dieCount').value = String(dice.count); get('dieModifier').value = String(dice.modifier);
    if (room) {
      get('diceStatus').textContent = 'Esperando resultado del servidor…';
      await command('dice:roll',{eventId:crypto.randomUUID(),issuedAt:Date.now(),notation});
    } else {
      const sample = () => {
        const data = new Uint32Array(1), cap = Math.floor(4294967296/dice.sides)*dice.sides;
        do { crypto.getRandomValues(data); } while (data[0]>=cap);
        return data[0]%dice.sides+1;
      };
      const results = Array.from({length:dice.count},sample);
      localRolls = [{id:crypto.randomUUID(),author:{name:get('profileName').textContent||'Mesa local'},notation,...dice,results,total:results.reduce((a,b)=>a+b,0)+dice.modifier,time:Date.now(),verified:false},...localRolls].slice(0,50);
    }
    get('diceStatus').textContent = 'Tirada recibida en el historial.';
  } catch(error) { get('diceStatus').textContent = describe(error); }
  finally { diceBusy = false; renderDice(); }
});

let editingTokenId = null;
get('editSelected').addEventListener('click', async () => {
  const token = board.selected();
  if (!token || room && (!room.isOwner || !client?.state.ready)) return;
  editingTokenId = token.id;
  get('contextCode').value = token.code; get('contextName').value = token.name;
  get('contextColor').value = token.color; get('contextSize').value = String(token.size || 1);
  get('contextPortrait').value = ''; get('contextRemovePortrait').checked = false;
  get('contextAssignment').hidden = !room;
  get('tokenEditStatus').textContent = '';
  if (room) {
    try { await refreshMembers(); } catch(error) { status(describe(error),true); return; }
    get('contextUsers').replaceChildren(...members.filter(m=>m.userId!==session.user.id).map(member=>{
      const option = new Option(member.username,member.userId);
      option.selected = rights?.assignments?.some(a=>a.tokenId===token.id && a.userId===member.userId) || false;
      return option;
    }));
    renderContextPermissions();
  }
  get('tokenDialog').showModal();
});
function renderContextPermissions() {
  get('contextPermissions').replaceChildren();
  for (const option of get('contextUsers').selectedOptions) {
    const member = members.find(m=>m.userId===option.value); if (!member) continue;
    const section = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent = member.username; section.append(legend);
    for (const [key,text] of [['moveAssignedTokens','Movimiento de fichas asignadas'],['diceAllowed','Tiradas públicas']]) {
      const label = document.createElement('label'), checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.dataset.userId = member.userId; checkbox.dataset.permission = key; checkbox.checked = member.permissions[key];
      label.append(checkbox,document.createTextNode(text)); section.append(label);
    }
    get('contextPermissions').append(section);
  }
}
get('contextUsers').addEventListener('change',renderContextPermissions);
get('cancelToken').addEventListener('click', () => get('tokenDialog').close());
get('contextTokenForm').addEventListener('submit', async event => {
  event.preventDefault();
  const id = editingTokenId, current = generation, target = room?.room.id;
  if (!id || room && !room.isOwner) return;
  const name = get('contextName').value.trim(), color = get('contextColor').value, size = Number(get('contextSize').value);
  if (!name || name.length>64 || !/^#[0-9a-fA-F]{6}$/.test(color) || !Number.isFinite(size) || size<.25 || size>4) return;
  get('saveContextToken').disabled = true;
  try {
    const portrait = get('contextPortrait').files?.[0], remove = get('contextRemovePortrait').checked;
    if (portrait) await validateImage(portrait,2*1024*1024);
    if (current !== generation || target !== room?.room.id) throw new Error('DIRECTOR_NOT_READY');
    if (!room) await board.editLocalToken(id,{name,color,size},portrait,remove);
    else {
      const token = mediaSource?.tokens.find(t=>t.id===id); if (!token) throw new Error('TOKEN_NOT_FOUND');
      const previous = structuredClone(mediaSource);
      Object.assign(token,{name,color,size});
      if (portrait) { token.imageId = 'token:'+id; mediaSource.files[token.imageId] = portrait; }
      else if (remove && token.imageId) { delete mediaSource.files[token.imageId]; token.imageId = null; }
      try { await saveMedia(); } catch(error) { mediaSource = previous; await mediaStore.save(previous); throw error; }
      await client.assign(id,[...get('contextUsers').selectedOptions].map(o=>o.value));
      const updates = new Map();
      for (const checkbox of get('contextPermissions').querySelectorAll('input')) {
        if (!updates.has(checkbox.dataset.userId)) updates.set(checkbox.dataset.userId,{});
        updates.get(checkbox.dataset.userId)[checkbox.dataset.permission] = checkbox.checked;
      }
      for (const [userId,permissions] of updates) await api(`/rooms/${target}/members/${userId}`,{method:'PATCH',body:{permissions}});
      await refreshMembers();
    }
    get('tokenDialog').close();
  } catch(error) { get('tokenEditStatus').textContent = describe(error); }
  finally { get('saveContextToken').disabled = false; }
});

let candidate = null, candidateUrl = null, candidateVersion = 0, mapBusy = false;
get('openBounds').addEventListener('click', () => {
  if (room && !room.isOwner) return;
  const value = room ? scene : board.bounds();
  const bounds = value.bounds || mapBounds(board.map()) || {x:-10,y:-10,width:20,height:20};
  get('boundsMode').value = value.mode;
  for (const key of ['x','y','width','height']) get('bounds'+key[0].toUpperCase()+key.slice(1)).value = String(bounds[key]);
  get('boundsStatus').textContent = ''; get('boundsDialog').showModal();
});
get('closeBounds').addEventListener('click', () => get('boundsDialog').close());
get('boundsForm').addEventListener('submit', async event => {
  event.preventDefault();
  const mode = get('boundsMode').value;
  const bounds = mode === 'free' ? null : mode === 'map' ? mapBounds(board.map()) : Object.fromEntries(['x','y','width','height'].map(key=>[key,Number(get('bounds'+key[0].toUpperCase()+key.slice(1)).value)]));
  try {
    if (room) await command('scene:set',{epoch:client.state.epoch,revision:scene.revision,mode,bounds});
    else board.setBounds(mode,bounds);
    get('boundsDialog').close();
  } catch(error) { get('boundsStatus').textContent = describe(error); }
});
function clearCandidate() {
  candidateVersion++; candidate = null;
  if (candidateUrl) URL.revokeObjectURL(candidateUrl);
  candidateUrl = null; get('mapPreview').hidden = true; get('mapPreview').removeAttribute('src');
  get('mapCandidate').value = ''; get('useMap').disabled = true;
}
function openMapManager() {
  if (room && !room.isOwner) return;
  clearCandidate(); get('multiplayerDialog').close();
  get('mapCandidateInfo').textContent = 'PNG, JPEG o WebP · máximo 12 MiB, 20 Mpx y 8000 px por lado.';
  get('mapTransferStatus').textContent = room ? 'El mapa se comparte solo con esta sala. Original en IndexedDB del director.' : 'Mapa local: se guarda exclusivamente en este navegador.';
  if (!get('mapDialog').open) get('mapDialog').showModal();
  const existing = room ? mediaSource?.files.map : null;
  if (existing) void stageMap(existing);
  else if (!room && board.map()) void board.localResources().then(value=>{if (value.blob && get('mapDialog').open) void stageMap(value.blob);});
}
async function stageMap(file) {
  if (!file || mapBusy || (room && !room.isOwner)) return;
  clearCandidate(); const version = candidateVersion;
  get('mapCandidateInfo').textContent = 'Comprobando imagen…';
  try {
    const dimensions = await validateImage(file, 12 * 1024 * 1024);
    if (version !== candidateVersion || !get('mapDialog').open) return;
    candidate = {file, dimensions, generation};
    candidateUrl = URL.createObjectURL(file); get('mapPreview').src = candidateUrl; get('mapPreview').hidden = false;
    const old = board.map();
    get('candidateWidth').value = String(old?.widthCells || 20);
    get('candidateHeight').value = String(old?.heightCells || Math.max(1, Math.min(200, 20 * dimensions.heightPx / dimensions.widthPx)));
    get('candidateX').value = String(old?.xCells ?? -10);
    get('candidateY').value = String(old?.yCells ?? -Number(get('candidateHeight').value) / 2);
    get('mapCandidateInfo').textContent = `${file.name} · ${dimensions.widthPx} × ${dimensions.heightPx} px · ${file.type} · ${(file.size / 1048576).toFixed(2)} MiB`;
    get('useMap').disabled = false;
  } catch { if (version === candidateVersion) get('mapCandidateInfo').textContent = 'Imagen no válida: revisa formato, tamaño y dimensiones.'; }
}
get('openMap').addEventListener('click', openMapManager);
get('chooseMap').addEventListener('click', event => { event.stopPropagation(); get('mapCandidate').click(); });
get('mapDrop').addEventListener('click', event => { if (event.target === get('mapDrop')) get('mapCandidate').click(); });
get('mapDrop').addEventListener('keydown', event => { if (event.target === get('mapDrop') && ['Enter',' '].includes(event.key)) { event.preventDefault(); get('mapCandidate').click(); } });
get('mapCandidate').addEventListener('change', () => void stageMap(get('mapCandidate').files?.[0]));
for (const type of ['dragenter','dragover','dragleave','drop']) get('mapDrop').addEventListener(type, event => {
  event.preventDefault(); get('mapDrop').classList.toggle('drag-over', type === 'dragenter' || type === 'dragover');
  if (type === 'drop') void stageMap(event.dataTransfer?.files?.[0]);
});
window.addEventListener('naufragio:map:candidate', event => { openMapManager(); void stageMap(event.detail); });
get('sharedMapUpload').addEventListener('change', () => { const file = get('sharedMapUpload').files?.[0]; openMapManager(); void stageMap(file); get('sharedMapUpload').value = ''; });
get('sharedClearMap').addEventListener('click', openMapManager);
get('closeMapManager').addEventListener('click', () => { if (!mapBusy) get('mapDialog').close(); });
get('mapDialog').addEventListener('cancel', event => { if (mapBusy) event.preventDefault(); });
get('mapDialog').addEventListener('close', clearCandidate);
async function commitMap(map, file) {
  if (!room) { await board.setLocalMap(file, map); return; }
  if (!room.isOwner || !mediaSource || !client?.state.ready) throw new Error('FORBIDDEN');
  const previous = mediaSource;
  mediaSource = {...previous, map: map && {...map, imageId:'map'}, files:{...previous.files}};
  if (map) mediaSource.files.map = file; else delete mediaSource.files.map;
  try { await saveMedia(); }
  catch (error) { mediaSource = previous; await mediaStore.save(previous); throw error; }
}
get('mapConfirm').addEventListener('submit', async event => {
  event.preventDefault(); if (!candidate || mapBusy || candidate.generation !== generation) return;
  const fields = ['candidateWidth','candidateHeight','candidateX','candidateY'].map(id => Number(get(id).value));
  if (!fields.every(Number.isFinite) || fields.slice(0,2).some(n => n < 1 || n > 200) || fields.slice(2).some(n => Math.abs(n)>1000)) return;
  const [widthCells,heightCells,xCells,yCells] = fields;
  const map = {name:candidate.file.name.slice(0,100)||'Mapa', ...candidate.dimensions, widthCells,heightCells,xCells,yCells};
  mapBusy = true; get('useMap').disabled = true; get('closeMapManager').disabled = true;
  get('mapTransferStatus').textContent = room ? 'Calculando SHA-256 y publicando el mapa… Los participantes verifican cada transferencia.' : 'Guardando mapa local…';
  try {
    await commitMap(map, candidate.file);
    if (get('candidateFit').checked) board.fitMap();
    get('mapTransferStatus').textContent = room ? 'Mapa publicado. Transferencia verificada en curso para los participantes conectados.' : 'Mapa guardado en este navegador.';
    get('openMap').textContent = 'Gestionar mapa'; clearCandidate();
  } catch (error) { get('mapTransferStatus').textContent = describe(error) + ' El mapa anterior se conserva.'; get('useMap').disabled = false; }
  finally { mapBusy = false; get('closeMapManager').disabled = false; }
});
get('managerRemoveMap').addEventListener('click', async () => {
  if (mapBusy) return;
  mapBusy = true;
  try { await commitMap(null, null); clearCandidate(); get('mapTransferStatus').textContent = 'Mapa retirado. Las fichas conservan sus posiciones.'; }
  catch (error) { get('mapTransferStatus').textContent = describe(error); }
  finally { mapBusy = false; }
});

const qrControls = initQr({ api, getRoom: () => room, refreshMembers, status, notify: board.notify });
window.addEventListener('pagehide', () => clearTimeout(expiry));
try {
  const saved = localStorage.getItem(CONFIG_KEY);
  if (saved) config = validateConfig(JSON.parse(saved));
  else {
    const response = await fetch(new URL('../site.config.json', import.meta.url), { credentials: 'omit', redirect: 'error', cache: 'no-store' });
    if (response.ok) config = validateConfig(await response.json());
  }
} catch { status('Sin configuración válida. Puedes continuar en local o revisar Configuración del sitio.'); }
showConfig(); sessionView();
try {
  const saved=JSON.parse(sessionStorage.getItem('naufragio-guest-session-v1')||'null');
  if(saved&&config&&saved.apiBaseUrl===config.apiBaseUrl&&saved.expiresAt>Date.now()&&/^sess_[A-Za-z0-9_-]{43}$/.test(saved.token)){
    session={token:saved.token,expiresAt:saved.expiresAt};
    const current=await api('/auth/me');
    if(!current.user.guest)throw new Error('UNAUTHENTICATED');
    session.user=current.user;sessionView();
    expiry=setTimeout(()=>void clearSession(false).then(()=>status(errors.UNAUTHENTICATED,true)),Math.max(1,saved.expiresAt-Date.now()));
    await enter(await api('/rooms/'+current.user.roomId));
    sessionStorage.removeItem('naufragio-guest-pending-v1');status('Te has unido como invitado temporal.');
  }else if(saved){sessionStorage.removeItem('naufragio-guest-session-v1');}
}catch{await clearSession(false);status('La admisión temporal ha caducado o se ha retirado. Solicita un nuevo acceso al director.',true);}
