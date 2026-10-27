import { createLimiter } from '../limits.js';
import { fields } from '../auth/validation.js';
import { HttpError } from '../errors.js';

export function attachRoomPresence(io, auth, rooms, config, { clock = Date.now, reportError = () => {} } = {}) {
  const namespace = io.of('/');
  const knownRooms = new Set();
  const lastPresence = new Map();
  const expiryTimers = new Map();
  let stopped = false;
  let refreshing = false;
  let dirty = false;
  const channel = roomId => `party:${roomId}`;

  function snapshot(roomId) {
    const people = new Map();
    let ownerId;
    let active = false;
    for (const socket of namespace.sockets.values()) {
      if (!socket.connected || socket.data.access?.room.id !== roomId) continue;
      const access = socket.data.access;
      ownerId = access.room.ownerId;
      active ||= access.isOwner;
      people.set(access.actor.id, { id: access.actor.id, username: access.actor.username,
        role: access.isOwner ? 'director' : 'participant' });
    }
    return { version: 1, roomId, ownerId, state: active ? 'active' : 'waiting',
      participants: [...people.values()].sort((a, b) => a.id.localeCompare(b.id)) };
  }
  function refresh() {
    if (stopped) return;
    if (refreshing) { dirty = true; return; }
    refreshing = true;
    try {
      do {
        dirty = false;
        for (const socket of [...namespace.sockets.values()]) {
          try { socket.data.access = rooms.access(socket.data.token, socket.data.roomId); }
          catch { socket.disconnect(true); }
        }
        for (const roomId of knownRooms) {
          const value = snapshot(roomId);
          if (!value.participants.length) { knownRooms.delete(roomId); lastPresence.delete(roomId); }
          else {
            const encoded = JSON.stringify(value);
            if (lastPresence.get(roomId) !== encoded) {
              lastPresence.set(roomId, encoded);
              io.to(channel(roomId)).emit('room:presence', value);
            }
          }
        }
      } while (dirty);
    } finally { refreshing = false; }
  }
  function safeRefresh() {
    try { refresh(); }
    catch {
      reportError({ code: 'PRESENCE_REFRESH_FAILED' });
      // Failing closed also applies to unexpected storage failures.
      for (const socket of [...namespace.sockets.values()]) socket.disconnect(true);
    }
  }
  io.use((socket, next) => {
    try {
      const input = socket.handshake.auth;
      auth.session(input?.token);
      fields(input, ['token', 'roomId']);
      const access = rooms.access(input.token, input.roomId);
      socket.data = { token: input.token, roomId: input.roomId, access };
      next();
    } catch (cause) {
      const code = cause instanceof HttpError ? cause.code : 'ACCESS_UNAVAILABLE';
      const error = new Error(code);
      error.data = { code };
      next(error);
    }
  });
  namespace.on('connection', socket => {
    let expiresAt;
    try {
      socket.data.access = rooms.access(socket.data.token, socket.data.roomId);
      expiresAt = auth.sessionInfo(socket.data.token).expiresAt;
    }
    catch { socket.disconnect(true); return; }
    const roomId = socket.data.roomId;
    knownRooms.add(roomId);
    socket.join(channel(roomId));
    socket.on('disconnect', () => {
      clearTimeout(expiryTimers.get(socket.id));
      expiryTimers.delete(socket.id);
      safeRefresh();
    });
    const remaining = expiresAt - clock();
    const deadline = setTimeout(safeRefresh, Math.max(1, remaining));
    deadline.unref();
    expiryTimers.set(socket.id, deadline);
    // A reconnect may replace only the same persisted owner, never another participant.
    if (socket.data.access.isOwner) {
      for (const other of [...namespace.sockets.values()]) {
        if (other !== socket && other.data.roomId === roomId && other.data.access?.isOwner) {
          other.emit('room:replaced', { version: 1, roomId });
          other.disconnect(true);
        }
      }
    }
    const accept = createLimiter(config.eventRateLimit, config.rateWindowMs, { clock });
    socket.onAny((event, ...args) => {
      const ack = typeof args.at(-1) === 'function' ? args.pop() : () => {};
      try {
        socket.data.access = rooms.access(socket.data.token, roomId);
        if (!accept(socket.id)) throw new HttpError(429, 'RATE_LIMITED');
        if (event !== 'room:presence:get') throw new HttpError(400, 'EVENT_NOT_AVAILABLE');
        if (args.length !== 1) throw new HttpError(400, 'INVALID_MESSAGE');
        fields(args[0], ['version']);
        if (args[0].version !== 1) throw new HttpError(400, 'INVALID_MESSAGE');
        refresh();
        ack({ ok: true, presence: snapshot(roomId) });
      } catch (error) {
        ack({ ok: false, error: { code: error instanceof HttpError ? error.code : 'ACCESS_UNAVAILABLE' } });
        if (!(error instanceof HttpError) || [401, 403, 404, 429].includes(error.status)) socket.disconnect(true);
      }
    });
    safeRefresh();
    if (socket.connected) socket.emit('room:presence', snapshot(roomId));
  });
  const offAuth = auth.onChanged(safeRefresh);
  const offRooms = rooms.onChanged(safeRefresh);
  // Covers changes made by a separate administrative connection, in addition to exact session deadlines.
  const sweep = setInterval(safeRefresh, 1000);
  sweep.unref();
  return {
    refresh: safeRefresh,
    stop() {
      stopped = true;
      clearInterval(sweep);
      offAuth();
      offRooms();
      for (const deadline of expiryTimers.values()) clearTimeout(deadline);
      expiryTimers.clear();
    }
  };
}
