import { createHash, randomUUID } from 'node:crypto';
import { HttpError } from '../errors.js';

// Relay-only media. No image buffers, coordinates, manifests or game assets in SQLite.
// At most one outstanding chunk per transfer (receiver acknowledgement is backpressure).
// 32 KiB stays below the 64 KiB Socket.IO frame limit after base64 encoding.
const CHUNK = 32768;
const MAX_MAP = 12 * 1024 * 1024;
const MAX_TOKEN = 2 * 1024 * 1024;
const MAX_TRANSFERS = 4;
const MAX_TOTAL = 24 * 1024 * 1024;
const TIMEOUT = 15000;
const bad = (code, status = 400) => { throw new HttpError(status, code); };
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const number = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => plain(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const types = new Set(['image/png', 'image/jpeg', 'image/webp']);

function validateManifest(value) {
  if (!exact(value, ['version', 'roomId', 'epoch', 'revision', 'tokens', 'map', 'assets']) || value.version !== 1 ||
      !uuid(value.epoch) || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      !Array.isArray(value.tokens) || value.tokens.length > 64 || !Array.isArray(value.assets) ||
      value.assets.length > 65) bad('ASSET_MANIFEST_INVALID');
  const tokenIds = new Set();
  const tokens = value.tokens.map(token => {
    if (!exact(token, ['id', 'name', 'color', 'size', 'imageId']) || !uuid(token.id) || tokenIds.has(token.id) ||
        !text(token.name, 64) || !/^#[0-9a-fA-F]{6}$/.test(token.color) ||
        !number(token.size, 0.25, 4) || (token.imageId !== null && token.imageId !== 'token:' + token.id)) bad('ASSET_MANIFEST_INVALID');
    tokenIds.add(token.id);
    return { ...token };
  });
  if (value.map !== null && (!exact(value.map, ['name', 'widthPx', 'heightPx', 'widthCells', 'heightCells', 'xCells', 'yCells', 'imageId']) ||
      !text(value.map.name, 100) || value.map.imageId !== 'map' ||
      !number(value.map.widthPx, 1, 8000) || !number(value.map.heightPx, 1, 8000) ||
      value.map.widthPx * value.map.heightPx > 20000000 ||
      !number(value.map.widthCells, 1, 200) || !number(value.map.heightCells, 1, 200) ||
      !number(value.map.xCells, -1000, 1000) || !number(value.map.yCells, -1000, 1000))) bad('ASSET_MANIFEST_INVALID');
  const assetIds = new Set();
  const assets = value.assets.map(item => {
    if (!exact(item, ['id', 'sha256', 'mime', 'bytes']) || !types.has(item.mime) ||
        !hex(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes < 1 ||
        (item.id !== 'map' && !(typeof item.id === 'string' && item.id.startsWith('token:') && uuid(item.id.slice(6)))) ||
        item.bytes > (item.id === 'map' ? MAX_MAP : MAX_TOKEN) || assetIds.has(item.id)) bad('ASSET_MANIFEST_INVALID');
    assetIds.add(item.id);
    return { ...item };
  });
  if (assets.reduce((total, item) => total + item.bytes, 0) > MAX_TOTAL) bad('ASSET_MANIFEST_INVALID');
  if (Boolean(value.map) !== assetIds.has('map') ||
      tokens.some(token => token.imageId && !assetIds.has(token.imageId)) ||
      [...assetIds].some(id => id !== 'map' && !tokenIds.has(id.slice(6)))) bad('ASSET_MANIFEST_INVALID');
  return { version: 1, roomId: value.roomId, epoch: value.epoch, revision: value.revision,
    map: value.map, tokens, assets };
}

export function createAssetRelay({ namespace, rooms, game, clock = Date.now }) {
  const sessions = new Map();
  const transfers = new Map();
  const access = socket => rooms.access(socket.data.token, socket.data.roomId);
  function active(socket) {
    access(socket);
    const epoch = game.authorityEpoch(socket.data.roomId);
    if (!epoch) bad('DIRECTOR_NOT_READY', 409);
    return epoch;
  }
  function owner(socket) {
    const epoch = active(socket);
    if (!game.isDirectorSocket(socket.data.roomId, socket)) bad('FORBIDDEN', 403);
    return epoch;
  }
  function clean(id, error = 'TRANSFER_INTERRUPTED') {
    const transfer = transfers.get(id);
    if (!transfer) return;
    transfers.delete(id);
    clearTimeout(transfer.timer);
    const receiver = namespace.sockets.get(transfer.receiver);
    if (receiver?.connected) receiver.emit('assets:failed', { version: 1, roomId: transfer.roomId, transferId: id, code: error });
  }
  function drop(roomId) {
    sessions.delete(roomId);
    for (const [id, t] of transfers) if (t.roomId === roomId) clean(id);
  }
  function publish(socket, input) {
    const epoch = owner(socket);
    const manifest = validateManifest(input);
    if (manifest.roomId !== socket.data.roomId || manifest.epoch !== epoch) bad('STALE_EPOCH', 409);
    const current = sessions.get(socket.data.roomId);
    if (current && manifest.revision <= current.manifest.revision) bad('STALE_ASSET_MANIFEST', 409);
    // Each declared token must be in the public official token set.
    const ids = game.tokenIds(socket.data.roomId);
    if (manifest.tokens.length !== ids.length || manifest.tokens.some(t => !ids.includes(t.id))) bad('ASSET_MANIFEST_INVALID');
    drop(socket.data.roomId);
    sessions.set(socket.data.roomId, { owner: socket.id, manifest });
    for (const peer of namespace.sockets.values()) {
      if (!peer.connected || peer.data.roomId !== socket.data.roomId) continue;
      try { access(peer); peer.emit('assets:manifest', manifest); } catch { peer.disconnect(true); }
    }
    return { revision: manifest.revision };
  }
  function request(socket, input) {
    const epoch = active(socket);
    if (!exact(input, ['version', 'roomId', 'epoch', 'assetId', 'revision']) || input.version !== 1 ||
        input.roomId !== socket.data.roomId || input.epoch !== epoch || !Number.isSafeInteger(input.revision)) bad('INVALID_MESSAGE');
    const session = sessions.get(socket.data.roomId);
    if (!session || session.manifest.epoch !== epoch || session.manifest.revision !== input.revision) bad('ASSETS_NOT_READY', 409);
    const asset = session.manifest.assets.find(a => a.id === input.assetId);
    if (!asset) bad('ASSET_NOT_FOUND', 404);
    if ([...transfers.values()].some(t => t.receiver === socket.id) || transfers.size >= 8) bad('TRANSFER_BUSY', 409);
    if ([...transfers.values()].filter(t => t.roomId === socket.data.roomId).length >= MAX_TRANSFERS) bad('TRANSFER_BUSY', 409);
    const sender = namespace.sockets.get(session.owner);
    if (!sender?.connected || !game.isDirectorSocket(socket.data.roomId, sender)) bad('DIRECTOR_NOT_READY', 409);
    const transferId = randomUUID();
    const timer = setTimeout(() => clean(transferId), TIMEOUT);
    timer.unref?.();
    transfers.set(transferId, { roomId: socket.data.roomId, receiver: socket.id,
      owner: sender.id, asset, received: 0, digest: createHash('sha256'), timer, busy: false });
    sender.emit('assets:requested', { version: 1, roomId: socket.data.roomId, epoch, revision: input.revision, transferId, asset });
    return { transferId };
  }
  function chunk(socket, input) {
    const epoch = owner(socket);
    if (!exact(input, ['version', 'roomId', 'epoch', 'transferId', 'offset', 'data']) ||
        input.version !== 1 || input.roomId !== socket.data.roomId || input.epoch !== epoch ||
        !uuid(input.transferId) || !Number.isSafeInteger(input.offset) || input.offset < 0 ||
        typeof input.data !== 'string' || input.data.length > Math.ceil(CHUNK / 3) * 4 + 4 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(input.data)) bad('INVALID_MESSAGE');
    const t = transfers.get(input.transferId);
    if (!t || t.owner !== socket.id || t.busy) bad('TRANSFER_NOT_FOUND', 409);
    const data = Buffer.from(input.data, 'base64');
    if (!data.length || data.length > CHUNK || data.toString('base64') !== input.data ||
        input.offset !== t.received || t.received + data.length > t.asset.bytes) {
      clean(input.transferId, 'INVALID_CHUNK'); bad('INVALID_CHUNK');
    }
    const recipient = namespace.sockets.get(t.receiver);
    if (!recipient?.connected) { clean(input.transferId); bad('TRANSFER_NOT_FOUND', 409); }
    try { access(recipient); } catch { clean(input.transferId); bad('ROOM_ACCESS_DENIED', 403); }
    t.busy = true;
    // Acknowledge upstream only after downstream consumed this fragment.
    recipient.timeout(8000).emit('assets:chunk', { version: 1, roomId: t.roomId, transferId: input.transferId,
      offset: input.offset, data: input.data }, (error, response) => {
      if (!transfers.has(input.transferId)) return;
      if (error || response?.ok !== true) { clean(input.transferId); return; }
      t.digest.update(data); t.received += data.length; t.busy = false;
      clearTimeout(t.timer);
      t.timer = setTimeout(() => clean(input.transferId), TIMEOUT);
      t.timer.unref?.();
      const sender = namespace.sockets.get(t.owner);
      // Completion is explicit; sender must still call assets:finish.
      sender?.emit('assets:chunk:acked', { version: 1, roomId: t.roomId, transferId: input.transferId, offset: input.offset });
    });
    return { pending: true };
  }
  function finish(socket, input) {
    const epoch = owner(socket);
    if (!exact(input, ['version', 'roomId', 'epoch', 'transferId']) ||
      input.version !== 1 || input.roomId !== socket.data.roomId || input.epoch !== epoch || !uuid(input.transferId)) bad('INVALID_MESSAGE');
    const t = transfers.get(input.transferId);
    if (!t || t.owner !== socket.id || t.busy) bad('TRANSFER_NOT_FOUND', 409);
    if (t.received !== t.asset.bytes || t.digest.digest('hex') !== t.asset.sha256) {
      clean(input.transferId, 'HASH_MISMATCH'); bad('HASH_MISMATCH', 409);
    }
    transfers.delete(input.transferId);
    clearTimeout(t.timer);
    const recipient = namespace.sockets.get(t.receiver);
    if (recipient?.connected) recipient.emit('assets:finished', { version: 1, roomId: t.roomId,
      transferId: input.transferId, assetId: t.asset.id, sha256: t.asset.sha256 });
    return { status: 'sent' };
  }
  const handlers = { 'assets:publish': publish, 'assets:request': request, 'assets:chunk': chunk, 'assets:finish': finish };
  return {
    handles(event) { return Object.hasOwn(handlers, event); },
    handle(socket, event, input) { return handlers[event](socket, input); },
    connected(socket) {
      const existing = sessions.get(socket.data.roomId);
      if (existing && existing.manifest.epoch === game.authorityEpoch(socket.data.roomId)) {
        socket.emit('assets:manifest', existing.manifest);
      }
    },
    disconnected(socket) {
      if (sessions.get(socket.data.roomId)?.owner === socket.id) drop(socket.data.roomId);
      for (const [id, t] of transfers) if (t.receiver === socket.id || t.owner === socket.id) clean(id);
    },
    refresh() {
      for (const [id, t] of transfers) {
        const sender = namespace.sockets.get(t.owner);
        const receiver = namespace.sockets.get(t.receiver);
        try { if (!sender?.connected || !receiver?.connected ||
          !game.isDirectorSocket(t.roomId, sender)) throw new Error();
          access(sender); access(receiver); }
        catch { clean(id); }
      }
      for (const [roomId, session] of sessions) {
        const sender = namespace.sockets.get(session.owner);
        if (!sender?.connected || !game.isDirectorSocket(roomId, sender)) drop(roomId);
      }
    },
    stop() { for (const id of [...transfers.keys()]) clean(id); sessions.clear(); }
  };
}
