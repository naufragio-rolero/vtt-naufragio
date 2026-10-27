import { validateSiteConfig } from '../backend/public/site-config.js';
import { createTokenClient } from '../backend/client/token-client.js';
import { createIndexedDbStore } from '../backend/client/indexeddb-store.js';
import { io } from './vendor/socket.io-4.8.4.esm.min.js';
import { initialRoomTokens, publicTokens, socketDestination } from './board-model.js';

if (!window.NaufragioBoard) await new Promise(resolve => window.addEventListener('naufragio:board:ready', resolve, { once: true }));
const board = window.NaufragioBoard;
const get = id => document.getElementById(id);
const CONFIG_KEY = 'naufragio-vtt-public-config-v1';
const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
let config = null, session = null, room = null, socket = null, client = null, storage = null, expiry = null;
let rights = null, members = [], pending = new Map(), generation = 0, validatedSignup = null;
const errors = {
  INVALID_CREDENTIALS: 'Usuario o contraseña incorrectos.', INVALID_INVITATION: 'Invitación de alta caducada, usada, revocada o inválida.',
  ROOM_ACCESS_DENIED: 'No tienes autorización o el código de sala no es válido.', FORBIDDEN: 'No tienes permiso para esta operación.',
  DIRECTOR_NOT_READY: 'En espera del director y de su estado local.', OFFICIAL_STATE_UNAVAILABLE: 'Falta el estado oficial o la clave en este navegador. Usa el mismo navegador y origen; la sala permanece en espera.',
  OFFICIAL_STATE_MISMATCH: 'El estado local no coincide con el confirmado. Se conserva la sala en espera.', LOCAL_STATE_IN_USE: 'Esta partida ya está abierta en otra pestaña de este navegador.',
  LOCAL_LOCK_UNAVAILABLE: 'Este navegador no dispone de Web Locks en un contexto seguro.', TOKEN_LIMIT: 'Prepara un máximo de 64 tokens en la mesa local antes de crear la partida. No se ha eliminado ninguno.',
  TOKEN_BUSY: 'Otro movimiento de este token está pendiente. Inténtalo tras la confirmación.', STALE_MOVE: 'Ha cambiado el estado. Espera la sincronización y vuelve a intentarlo.',
  UNAUTHENTICATED: 'La sesión ha caducado o ha sido revocada. Inicia sesión de nuevo.', RATE_LIMITED: 'Se ha alcanzado el límite de mensajes. Espera antes de reconectar.',
  INVALID_INPUT: 'Revisa los campos y la política de contraseña (15–128 caracteres).', DESTINATION_REQUIRED: 'Configura y confirma los destinos antes de enviar credenciales.',
  PERMISSION_REVOKED: 'El movimiento se rechazó porque se retiró el permiso.', DIRECTOR_DISCONNECTED: 'Movimiento cancelado: el director se ha desconectado.'
};
function status(message, error = false) {
  get('multiplayerStatus').textContent = message; get('multiplayerStatus').dataset.error = String(error);
  if (error) board.notify(message);
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
  document.querySelector('.table-title h1').textContent = room?.room.name || 'Mesa sin nombre';
  document.querySelector('.topbar-overline').textContent = room ? 'PARTIDA COMPARTIDA' : 'TABLERO LOCAL';
  get('tableModeLabel').textContent = room ? 'COMPARTIDA' : 'LOCAL';
  get('tableModeHelp').textContent = room ? 'Solo las posiciones confirmadas son oficiales. Los ajustes de vista son personales.' : 'Tu propio tablero de pruebas. Los cambios se guardan en este navegador.';
  get('currentRoom').hidden = !room;
  get('roomAdministration').hidden = !room?.isOwner;
  if (!room) { get('connectionState').textContent = 'Solo este navegador'; return; }
  const ready = Boolean(client?.state.ready && client.state.snapshot && socket?.connected);
  const message = client?.state.error ? describe(new Error(client.state.error)) : ready ? 'Partida conectada' : 'En espera del director';
  get('connectionState').textContent = message;
  get('roomState').textContent = `${message}${client?.state.snapshot ? ` · Revisión ${client.state.snapshot.revision}` : ''}`;
  get('currentRoomName').textContent = room.room.name;
  get('currentRoom').dataset.roomId = room.room.id;
  get('assignForm').querySelector('button').disabled = !ready || !room.isOwner;
}
function canMove(id) {
  return Boolean(room && client?.state.ready && client.state.snapshot && socket?.connected && pending.size === 0 && rights &&
    (rights.isOwner || rights.moveAssignedTokens && rights.assignedTokenIds.includes(id)));
}
async function move(id, point) {
  if (!canMove(id)) { status(errors.FORBIDDEN, true); return; }
  const eventId = crypto.randomUUID(); pending.set(eventId, id);
  try {
    const result = await client.move(id, point, eventId);
    if (result.status !== 'pending') pending.delete(eventId);
  } catch (error) { pending.delete(eventId); status(describe(error), true); }
}
async function leave() {
  generation++; const old = client, oldStorage = storage;
  client = null; socket?.disconnect(); socket = null; storage = null; room = null; rights = null; pending.clear(); members = [];
  if (old) { old.close(); await old.settled(); }
  oldStorage?.close(); board.exitShared();
  get('admissionCode').value = ''; get('presence').textContent = ''; get('members').replaceChildren(); roomView();
}
async function clearSession(revoke = true) {
  await leave();
  try { if (revoke && session) await api('/auth/logout', { method: 'POST', body: {} }); }
  finally { session = null; clearTimeout(expiry); get('signupOutput').value = ''; get('roomCode').value = ''; get('roomList').replaceChildren(); sessionView(); }
}
async function enter(selected, initialTokens, admissionCode) {
  await leave(); room = selected;
  const current = ++generation;
  board.enterShared({ canMove, move, identityName: session.user.username, roleLabel: config.roleLabels[session.user.role] });
  const destination = socketDestination(config);
  socket = io(destination.origin, { path: destination.path, autoConnect: false, forceNew: true, reconnection: true,
    auth: { token: session.token, roomId: room.room.id } });
  const live = socket;
  storage = room.isOwner ? createIndexedDbStore(`${config.apiBaseUrl.replace(/\/$/, '')}|${session.user.id}|${room.room.id}`) : null;
  client = createTokenClient(live, { roomId: room.room.id, director: room.isOwner, store: storage, initialTokens,
    onChange: value => {
      if (current !== generation) return;
      if (value.snapshot) board.applyShared(publicTokens(value.snapshot));
      if (value.error) status(describe(new Error(value.error)), true);
      fillTokens(); roomView();
    } });
  live.on('tokens:permissions', value => { if (current === generation) { rights = value.permissions; fillAssignments(); roomView(); } });
  live.on('room:presence', value => {
    if (current !== generation) return;
    get('presence').textContent = value.participants.map(person => `${person.username} (${person.role === 'director' ? config.roleLabels.director : config.roleLabels.user})`).join(' · ') || 'Sin participantes conectados';
    roomView();
  });
  live.on('token:move:committed', value => { if (current === generation) { pending.delete(value.eventId); status('Movimiento confirmado.'); } });
  live.on('token:move:rejected', value => { if (current === generation) { pending.delete(value.eventId); status(errors[value.reason] || 'Movimiento rechazado; se conserva la posición confirmada.', true); } });
  live.on('disconnect', () => { if (current === generation) { pending.clear(); roomView(); } });
  live.on('connect_error', error => { if (current === generation) { status(describe(error), true); roomView(); } });
  live.io.on('reconnect_attempt', () => { if (current === generation) get('roomState').textContent = 'Reconectando…'; });
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
}
function fillAssignments() {
  const select = get('assignedUsers'); const tokenId = get('assignedToken').value;
  select.replaceChildren(...members.filter(member => member.userId !== session?.user.id).map(member => {
    const option = new Option(member.username, member.userId);
    option.selected = rights?.assignments?.some(row => row.tokenId === tokenId && row.userId === member.userId) || false;
    return option;
  }));
}
async function refreshMembers() {
  if (!room?.isOwner) return;
  const id = room.room.id;
  const value = await api(`/rooms/${id}/members`);
  if (room?.room.id !== id) return;
  members = value.members; get('members').replaceChildren();
  for (const member of members.filter(member => member.userId !== session.user.id)) {
    const row = document.createElement('div'); row.className = 'member-row'; row.dataset.userId = member.userId;
    const label = document.createElement('label'); label.textContent = `${member.username}: permitir movimiento asignado `;
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = member.permissions.moveAssignedTokens; label.append(checkbox); row.append(label);
    appendButton(row, 'Actualizar permiso', async () => {
      await api(`/rooms/${id}/members/${member.userId}`, { method: 'PATCH', body: { permissions: { moveAssignedTokens: checkbox.checked } } }); status('Permiso actualizado.'); await refreshMembers();
    });
    appendButton(row, 'Retirar acceso', async () => { await api(`/rooms/${id}/members/${member.userId}/revoke`, { method: 'POST', body: {} }); await refreshMembers(); });
    get('members').append(row);
  }
  fillAssignments();
}
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
  const tokens = initialRoomTokens(board.localTokens());
  const created = await api('/rooms', { method: 'POST', body: { name: get('roomName').value } });
  const selected = await api(`/rooms/${created.room.id}`); await enter(selected, tokens, created.admissionCode); await refreshRooms();
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
try {
  const saved = localStorage.getItem(CONFIG_KEY);
  if (saved) config = validateConfig(JSON.parse(saved));
  else {
    const response = await fetch(new URL('../site.config.json', import.meta.url), { credentials: 'omit', redirect: 'error', cache: 'no-store' });
    if (response.ok) config = validateConfig(await response.json());
  }
} catch { status('Sin configuración válida. Puedes continuar en local o revisar Configuración del sitio.'); }
showConfig(); sessionView();
