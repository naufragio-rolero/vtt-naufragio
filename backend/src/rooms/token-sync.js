import { createHash, randomUUID, createPublicKey, verify } from 'node:crypto';
import { HttpError } from '../errors.js';
import { requirePermission } from '../auth/permissions.js';
import { exact, uuid, counter, snapshot, position, tokenText, checkpointText, claimText } from '../../shared/token-state.js';

const hash = text => createHash('sha256').update(text).digest('hex');
const fail = (code, status = 409) => { throw new HttpError(status, code); };
const TIMEOUT_MS = 10000;
const HISTORY_MS = 60000;
const HISTORY_LIMIT = 128;

// Coordinates exist only in bounded relay messages. Runtime tokens hold versions/digests.
export function createTokenSync({ store, rooms, namespace, clock = Date.now, onStatusChange = () => {} }) {
  const { db } = store;
  const runtime = new Map();
  const access = socket => rooms.access(socket.data.token, socket.data.roomId);
  function stateFor(roomId) {
    let state = runtime.get(roomId);
    if (!state) { state = { roomId, owner: null, epoch: null, tokens: new Map(), records: new Map(), syncs: new Map(), assignments: new Map() }; runtime.set(roomId, state); }
    return state;
  }
  const checkpoint = roomId => db.prepare('SELECT * FROM room_authority WHERE room_id=?').get(roomId);
  function send(roomId, event, message) {
    // Revalidate recipients at emission time, even when a periodic sweep has not run.
    for (const socket of namespace.sockets.values()) {
      if (socket.data.roomId !== roomId || !socket.connected) continue;
      try { access(socket); socket.emit(event, message); } catch { socket.disconnect(true); }
    }
  }
  function ownerSocket(state) {
    const socket = namespace.sockets.get(state.owner);
    if (!socket?.connected || !access(socket).isOwner) fail('DIRECTOR_NOT_READY');
    return socket;
  }
  function ready(socket, ownerOnly = false) {
    const actor = access(socket);
    if (ownerOnly && !actor.isOwner) fail('FORBIDDEN', 403);
    const state = stateFor(socket.data.roomId);
    if (!state.epoch) fail('DIRECTOR_NOT_READY');
    ownerSocket(state);
    if (actor.isOwner && socket.id !== state.owner) fail('DIRECTOR_NOT_READY');
    if (ownerOnly && socket.id !== state.owner) fail('FORBIDDEN', 403);
    return { state, actor };
  }
  const status = state => ({ version: 1, roomId: state.roomId, state: state.epoch ? 'active' : 'waiting', epoch: state.epoch,
    revision: checkpoint(state.roomId)?.revision ?? null });
  function reject(state, record, reason) {
    record.result = { status: 'rejected', eventId: record.input.eventId, reason, revision: checkpoint(state.roomId)?.revision ?? 0 };
    record.until = clock() + HISTORY_MS;
    const message = { version: 1, roomId: state.roomId, epoch: record.input.epoch, ...record.result };
    const requester = namespace.sockets.get(record.socketId);
    if (requester?.connected) { try { access(requester); requester.emit('token:move:rejected', message); } catch { requester.disconnect(true); } }
    const owner = namespace.sockets.get(state.owner);
    if (owner?.connected && owner !== requester) owner.emit('token:move:rejected', message);
  }
  function suspend(state) {
    if (!state.owner && !state.epoch) return;
    for (const record of state.records.values()) if (!record.result) reject(state, record, 'DIRECTOR_DISCONNECTED');
    state.owner = null; state.epoch = null; state.tokens.clear(); state.syncs.clear(); state.assignments.clear();
    send(state.roomId, 'room:authority', status(state));
    onStatusChange();
  }
  function allowed(socket, state, tokenId) {
    const current = access(socket);
    const assigned = db.prepare('SELECT token_id FROM token_assignments WHERE room_id=? AND user_id=? AND token_id=?')
      .get(state.roomId, current.actor.id, tokenId);
    requirePermission(current.actor, 'tokens:move', { member: true, ownerId: current.room.ownerId,
      directorOnline: true, moveAssignedTokens: current.permissions.moveAssignedTokens, tokenId,
      assignedTokenIds: new Set(assigned ? [tokenId] : []) });
    return current;
  }
  function prune(state) {
    for (const [key, record] of state.records) {
      if (!record.result && record.until <= clock()) reject(state, record, 'MOVE_EXPIRED');
      else if (record.result && record.until <= clock()) state.records.delete(key);
    }
    for (const [key, request] of state.syncs) if (request.until <= clock()) state.syncs.delete(key);
  }
  function metadata(value) {
    return new Map(value.tokens.map(token => [token.id, { id: token.id, tokenVersion: token.tokenVersion, digest: hash(tokenText(token)) }]));
  }
  const digestFor = (stateId, revision, tokens) => hash(checkpointText(stateId, revision, tokens.values()));
  function common(socket, input, required, optional = []) {
    exact(input, ['version', 'roomId', ...required], optional);
    if (input.version !== 1 || input.roomId !== socket.data.roomId) fail('INVALID_MESSAGE', 400);
    for (const key of ['eventId', 'epoch', 'tokenId', 'syncId']) if (Object.hasOwn(input, key) && !uuid(input[key])) fail('INVALID_MESSAGE', 400);
  }
  function matchesEpoch(state, input) { if (input.epoch !== state.epoch) fail('STALE_EPOCH'); }

  function claim(socket, input) {
    common(socket, input, ['challenge', 'snapshot', 'publicKey', 'signature']);
    if (!access(socket).isOwner) fail('FORBIDDEN', 403);
    if (!socket.data.authorityChallenge || input.challenge !== socket.data.authorityChallenge) fail('INVALID_CHALLENGE');
    const value = snapshot(input.snapshot);
    exact(input.publicKey, ['kty', 'crv', 'x', 'y']);
    if (input.publicKey.kty !== 'EC' || input.publicKey.crv !== 'P-256' ||
        ![input.publicKey.x, input.publicKey.y].every(part => typeof part === 'string' && /^[A-Za-z0-9_-]{43}$/.test(part)) ||
        typeof input.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(input.signature)) fail('INVALID_PROOF', 400);
    const publicKey = JSON.stringify({ kty: 'EC', crv: 'P-256', x: input.publicKey.x, y: input.publicKey.y });
    const tokens = metadata(value);
    const digest = digestFor(value.stateId, value.revision, tokens);
    const previous = checkpoint(input.roomId);
    if (previous && (previous.state_id !== value.stateId || previous.public_key !== publicKey ||
        previous.revision !== value.revision || previous.state_digest !== digest)) fail('OFFICIAL_STATE_MISMATCH');
    if (!previous && (value.revision !== 0 || value.tokens.some(token => token.tokenVersion !== 0))) fail('INVALID_INITIAL_STATE', 400);
    let valid;
    try { valid = verify('sha256', Buffer.from(claimText(input.roomId, input.challenge, value.stateId, value.revision, digest)),
      { key: createPublicKey({ key: input.publicKey, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(input.signature, 'base64url')); }
    catch { fail('INVALID_PROOF', 400); }
    if (!valid) fail('INVALID_PROOF', 400);
    if (!previous) db.prepare('INSERT INTO room_authority VALUES (?,?,?,?,?)').run(input.roomId, value.stateId, publicKey, value.revision, digest);
    const state = stateFor(input.roomId);
    const previousOwner = namespace.sockets.get(state.owner);
    if (state.epoch) suspend(state);
    state.records.clear(); state.syncs.clear(); state.assignments.clear(); state.owner = socket.id; state.epoch = randomUUID(); state.tokens = tokens;
    socket.data.authorityChallenge = null;
    if (previousOwner?.connected && previousOwner !== socket) {
      previousOwner.emit('room:replaced', { version: 1, roomId: state.roomId });
      previousOwner.disconnect(true);
    }
    send(input.roomId, 'room:authority', status(state));
    send(input.roomId, 'tokens:snapshot', { version: 1, roomId: input.roomId, epoch: state.epoch, snapshot: value });
    onStatusChange();
    return { epoch: state.epoch, revision: value.revision };
  }
  function requestMove(socket, input) {
    common(socket, input, ['epoch', 'eventId', 'baseRevision', 'tokenId', 'tokenVersion', 'position']);
    const { state, actor } = ready(socket);
    matchesEpoch(state, input);
    if (!counter(input.baseRevision) || !counter(input.tokenVersion)) fail('INVALID_MESSAGE', 400);
    const point = position(input.position);
    allowed(socket, state, input.tokenId);
    prune(state);
    const fingerprint = hash(JSON.stringify([input.epoch, input.baseRevision, input.tokenId, input.tokenVersion, point]));
    const duplicate = state.records.get(input.eventId);
    if (duplicate) {
      if (duplicate.actorId !== actor.actor.id || duplicate.fingerprint !== fingerprint) fail('EVENT_ID_REUSED');
      return duplicate.result ?? { status: 'pending', eventId: input.eventId };
    }
    const current = checkpoint(input.roomId);
    if (input.baseRevision !== current.revision || state.tokens.get(input.tokenId)?.tokenVersion !== input.tokenVersion) fail('STALE_MOVE');
    if ([...state.records.values()].some(record => !record.result && record.input.tokenId === input.tokenId)) fail('TOKEN_BUSY');
    if (state.records.size >= HISTORY_LIMIT) fail('MOVE_CAPACITY', 429);
    const record = { actorId: actor.actor.id, socketId: socket.id, fingerprint, input: { ...input, position: point }, until: clock() + TIMEOUT_MS };
    state.records.set(input.eventId, record);
    ownerSocket(state).emit('token:move:requested', { ...record.input, actorId: record.actorId });
    return { status: 'pending', eventId: input.eventId };
  }
  function decide(socket, input, accept) {
    common(socket, input, ['epoch', 'eventId', ...(accept ? ['revision', 'stateDigest'] : ['reason'])]);
    const { state } = ready(socket, true);
    matchesEpoch(state, input);
    prune(state);
    const record = state.records.get(input.eventId);
    if (!record) fail('MOVE_NOT_PENDING');
    if (record.result) {
      if (record.result.status === 'rejected' || accept) return record.result;
      fail('MOVE_ALREADY_RESOLVED');
    }
    const requester = namespace.sockets.get(record.socketId);
    try {
      if (!requester?.connected) fail('REQUESTER_DISCONNECTED');
      allowed(requester, state, record.input.tokenId);
    } catch { reject(state, record, 'PERMISSION_REVOKED'); return record.result; }
    if (!accept) {
      if (input.reason !== 'DIRECTOR_REJECTED') fail('INVALID_MESSAGE', 400);
      reject(state, record, input.reason); return record.result;
    }
    const current = checkpoint(input.roomId);
    const token = state.tokens.get(record.input.tokenId);
    if (!token || token.tokenVersion !== record.input.tokenVersion) { reject(state, record, 'STALE_MOVE'); return record.result; }
    if (!counter(input.revision) || input.revision !== current.revision + 1 || token.tokenVersion + 1 >= Number.MAX_SAFE_INTEGER) fail('STALE_MOVE');
    const nextToken = { id: token.id, tokenVersion: token.tokenVersion + 1, ...record.input.position };
    const next = new Map(state.tokens);
    next.set(token.id, { id: token.id, tokenVersion: nextToken.tokenVersion, digest: hash(tokenText(nextToken)) });
    const digest = digestFor(current.state_id, input.revision, next);
    if (input.stateDigest !== digest) fail('OFFICIAL_STATE_MISMATCH');
    // Durable checkpoint only; never write the snapshot, positions or pending moves.
    db.prepare('UPDATE room_authority SET revision=?,state_digest=? WHERE room_id=?').run(input.revision, digest, state.roomId);
    state.tokens = next;
    const movement = { version: 1, roomId: state.roomId, epoch: state.epoch, eventId: input.eventId,
      actorId: record.actorId, revision: input.revision, tokenId: token.id, tokenVersion: nextToken.tokenVersion, position: record.input.position };
    record.result = { status: 'committed', eventId: input.eventId, movement };
    record.until = clock() + HISTORY_MS;
    send(state.roomId, 'token:move:committed', movement);
    return record.result;
  }
  function assign(socket, input) {
    common(socket, input, ['epoch', 'eventId', 'tokenId', 'assignmentVersion', 'userIds']);
    const { state } = ready(socket, true);
    matchesEpoch(state, input);
    if (!state.tokens.has(input.tokenId) || !Array.isArray(input.userIds) || input.userIds.length > 32 ||
        !counter(input.assignmentVersion) || new Set(input.userIds).size !== input.userIds.length || !input.userIds.every(uuid)) fail('INVALID_MESSAGE', 400);
    const previous = state.assignments.get(input.tokenId);
    const fingerprint = hash(JSON.stringify([input.tokenId, input.assignmentVersion, [...input.userIds].sort()]));
    if (previous?.eventId === input.eventId) {
      if (previous.fingerprint !== fingerprint) fail('EVENT_ID_REUSED');
      return previous.result;
    }
    if (input.assignmentVersion !== (previous?.result.assignmentVersion ?? 0)) fail('STALE_ASSIGNMENT');
    store.transaction(() => {
      for (const userId of input.userIds) {
        if (!db.prepare(`SELECT 1 FROM room_memberships m JOIN users u ON u.id=m.user_id
          WHERE m.room_id=? AND m.user_id=? AND m.active=1 AND u.disabled=0`).get(state.roomId, userId)) fail('ROOM_ACCESS_DENIED', 404);
      }
      db.prepare('DELETE FROM token_assignments WHERE room_id=? AND token_id=?').run(state.roomId, input.tokenId);
      for (const userId of input.userIds) db.prepare('INSERT INTO token_assignments VALUES (?,?,?)').run(state.roomId, input.tokenId, userId);
    });
    for (const record of state.records.values()) if (!record.result && record.input.tokenId === input.tokenId) reject(state, record, 'ASSIGNMENT_CHANGED');
    const result = { tokenId: input.tokenId, userIds: [...input.userIds], assignmentVersion: input.assignmentVersion + 1 };
    state.assignments.set(input.tokenId, { eventId: input.eventId, fingerprint, result });
    refreshPermissions();
    return result;
  }
  function permissions(socket) {
    const current = access(socket);
    const state = runtime.get(socket.data.roomId);
    const own = db.prepare('SELECT token_id FROM token_assignments WHERE room_id=? AND user_id=? ORDER BY token_id')
      .all(socket.data.roomId, current.actor.id).map(row => row.token_id);
    const result = { isOwner: current.isOwner, moveAssignedTokens: current.permissions.moveAssignedTokens, assignedTokenIds: own };
    if (current.isOwner) result.assignments = db.prepare('SELECT token_id,user_id FROM token_assignments WHERE room_id=? ORDER BY token_id,user_id')
      .all(socket.data.roomId).map(row => ({ tokenId: row.token_id, userId: row.user_id }));
    if (current.isOwner) result.assignmentVersions = Object.fromEntries([...state?.assignments ?? []].map(([id, row]) => [id, row.result.assignmentVersion]));
    return result;
  }
  function refreshPermissions() {
    for (const socket of namespace.sockets.values()) {
      if (!socket.connected) continue;
      try {
        const value = permissions(socket);
        const encoded = JSON.stringify(value);
        if (socket.data.lastTokenPermissions !== encoded) {
          socket.data.lastTokenPermissions = encoded;
          socket.emit('tokens:permissions', { version: 1, roomId: socket.data.roomId, permissions: value });
        }
      } catch { socket.disconnect(true); }
    }
  }
  function syncRequest(socket, input) {
    common(socket, input, ['epoch', 'eventId']);
    const { state } = ready(socket);
    matchesEpoch(state, input);
    prune(state);
    if (state.syncs.size >= 32) fail('SYNC_CAPACITY', 429);
    const syncId = randomUUID();
    state.syncs.set(syncId, { socketId: socket.id, until: clock() + TIMEOUT_MS });
    ownerSocket(state).emit('tokens:sync:requested', { version: 1, roomId: state.roomId, epoch: state.epoch, syncId });
    return { status: 'pending', syncId };
  }
  function syncProvide(socket, input) {
    common(socket, input, ['epoch', 'syncId', 'snapshot']);
    const { state } = ready(socket, true);
    matchesEpoch(state, input);
    prune(state);
    const request = state.syncs.get(input.syncId);
    if (!request) fail('SYNC_NOT_PENDING');
    const recipient = namespace.sockets.get(request.socketId);
    if (!recipient?.connected) fail('SYNC_NOT_PENDING');
    access(recipient);
    const value = snapshot(input.snapshot);
    const current = checkpoint(state.roomId);
    if (value.stateId !== current.state_id || value.revision !== current.revision ||
        digestFor(value.stateId, value.revision, metadata(value)) !== current.state_digest) fail('OFFICIAL_STATE_MISMATCH');
    recipient.emit('tokens:snapshot', { version: 1, roomId: state.roomId, epoch: state.epoch, snapshot: value });
    state.syncs.delete(input.syncId);
    return { status: 'sent' };
  }
  const handlers = { 'authority:claim': claim, 'token:move:request': requestMove,
    'tokens:permissions:get': (socket, input) => { common(socket, input, []); return { permissions: permissions(socket) }; },
    'token:move:accept': (socket, input) => decide(socket, input, true),
    'token:move:reject': (socket, input) => decide(socket, input, false),
    'token:assign': assign, 'tokens:sync:request': syncRequest, 'tokens:sync:provide': syncProvide };
  return {
    isReady(roomId) { return Boolean(runtime.get(roomId)?.epoch); },
    authorityEpoch(roomId) { return runtime.get(roomId)?.epoch ?? null; },
    isDirectorSocket(roomId, socket) { const state = runtime.get(roomId); return Boolean(state?.epoch && state.owner === socket?.id); },
    tokenIds(roomId) { return [...(runtime.get(roomId)?.tokens.keys() ?? [])]; },
    handles(event) { return Object.hasOwn(handlers, event); },
    handle(socket, event, input) {
      try { return handlers[event](socket, input); }
      catch (error) { if (error instanceof HttpError) throw error; if (error.message === 'INVALID_MESSAGE') fail('INVALID_MESSAGE', 400); throw error; }
    },
    connected(socket) {
      const current = access(socket);
      const state = stateFor(socket.data.roomId);
      socket.emit('room:authority', status(state));
      refreshPermissions();
      if (current.isOwner) {
        socket.data.authorityChallenge = randomUUID();
        const expected = checkpoint(state.roomId);
        socket.emit('authority:challenge', { version: 1, roomId: state.roomId, challenge: socket.data.authorityChallenge,
          expected: expected ? { stateId: expected.state_id, revision: expected.revision, digest: expected.state_digest } : null });
      }
    },
    disconnected(socket) {
      const state = runtime.get(socket.data.roomId);
      if (!state) return;
      if (state.owner === socket.id) suspend(state);
      for (const record of state.records.values()) if (!record.result && record.socketId === socket.id) reject(state, record, 'REQUESTER_DISCONNECTED');
      if (![...namespace.sockets.values()].some(other => other.connected && other.data.roomId === state.roomId)) runtime.delete(state.roomId);
    },
    refresh() {
      refreshPermissions();
      for (const state of runtime.values()) {
        if (state.epoch) { try { ownerSocket(state); } catch { suspend(state); } }
        prune(state);
        for (const record of state.records.values()) if (!record.result) {
          const requester = namespace.sockets.get(record.socketId);
          try { if (!requester?.connected) throw new Error(); allowed(requester, state, record.input.tokenId); }
          catch { reject(state, record, 'PERMISSION_REVOKED'); }
        }
      }
    },
    stop() { runtime.clear(); }
  };
}
