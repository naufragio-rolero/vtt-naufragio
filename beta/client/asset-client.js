// Shared browser-side media client. The director owns Blob originals; players
// receive only the active public manifest and verified bytes, never hidden assets.
// 32 KiB -> 43.7 KiB base64, inside the backend's 64 KiB frame limit.
const CHUNK = 32768;
// The server accepts 2400 chunks/minute per authenticated socket. Keep a
// shared conservative budget across ALL recipients of this director.
const CHUNK_INTERVAL_MS = 40;
const encoder = new TextEncoder();
const toBase64 = bytes => {
  let output = '';
  for (let i = 0; i < bytes.length; i += 2048) output += String.fromCharCode(...bytes.subarray(i, i + 2048));
  return btoa(output);
};
const digest = async blob => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
  .map(b => b.toString(16).padStart(2, '0')).join('');
const clone = data => structuredClone(data);

export function createAssetClient(socket, { roomId, director = false, getSource = async () => null,
  onUpdate = () => {}, onError = () => {} } = {}) {
  let epoch = null, revision = 0, manifest = null, stopped = false;
  let generation = 0;
  let nextChunkSlot = 0;
  async function paceChunk() {
    const now = Date.now();
    const slot = Math.max(now, nextChunkSlot);
    nextChunkSlot = slot + CHUNK_INTERVAL_MS;
    if (slot > now) await new Promise(resolve => setTimeout(resolve, slot - now));
  }
  const received = new Map(), incoming = new Map(), pending = new Map(), listeners = [];
  // Every pending operation owns its deadline. Settling, superseding or
  // closing a client MUST clear the timer as well as its Map entry.
  function settlePending(key, error = null) {
    const waiter = pending.get(key);
    if (!waiter) return false;
    pending.delete(key);
    if (waiter.timer !== undefined) clearTimeout(waiter.timer);
    if (error) waiter.reject(error);
    else waiter.resolve();
    return true;
  }
  function cancelPending(reason = 'TRANSFER_INTERRUPTED') {
    for (const key of [...pending.keys()]) settlePending(key, new Error(reason));
  }
  const listen = (event, handler) => { socket.on(event, handler); listeners.push([event, handler]); };
  const command = async (event, fields) => {
    const answer = await socket.timeout(12000).emitWithAck(event, { version: 1, roomId, ...fields });
    if (!answer.ok) throw new Error(answer.error?.code || 'ASSET_RELAY_FAILED');
    return answer;
  };
  const emit = () => onUpdate({ manifest: manifest && clone(manifest), blobs: new Map(received) });
  const fail = error => { if (!stopped) onError(error instanceof Error ? error.message : String(error)); };
  function reset() {
    generation++;
    manifest = null; received.clear(); incoming.clear(); revision = 0;
    cancelPending(); emit();
  }
  listen('disconnect', reset);
  listen('room:authority', value => {
    if (value.roomId !== roomId || value.state !== 'active' || !value.epoch) { epoch = null; reset(); return; }
    if (epoch !== value.epoch) { epoch = value.epoch; reset(); }
  });
  listen('assets:manifest', value => {
    if (stopped || value.roomId !== roomId || !epoch || value.epoch !== epoch ||
        !Array.isArray(value.assets) || !Array.isArray(value.tokens)) return;
    if (manifest && value.revision < manifest.revision) return;
    const previous = new Map(received);
    const old = manifest;
    manifest = clone(value); revision = value.revision; generation++;
    cancelPending(); incoming.clear();
    received.clear();
    for (const asset of manifest.assets) if (old?.assets.some(item =>
      item.id === asset.id && item.sha256 === asset.sha256) && previous.has(asset.id)) received.set(asset.id, previous.get(asset.id));
    emit();
    if (!director) void downloadAll(generation).catch(fail);
  });
  async function downloadAll(version) {
    for (const asset of manifest?.assets ?? []) {
      if (stopped || version !== generation) return;
      if (received.has(asset.id)) continue;
      const receiving = { asset, chunks: [], offset: 0, transferId: null };
      incoming.set(asset.id, receiving);
      try {
        let result;
        for (let attempt = 0; attempt < 90 && !stopped && version === generation; attempt++) {
          try { result = await command('assets:request', { epoch, revision, assetId: asset.id }); break; }
          catch (error) {
            if (error.message !== 'TRANSFER_BUSY') throw error;
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        if (!result) throw new Error('TRANSFER_BUSY');
        if (stopped || version !== generation) return;
        const entry = incoming.get(asset.id);
        if (entry) entry.transferId = result.transferId;
        // assets:finished may arrive before the request's ack; handled by the
        // shared promise installed before sending the request below.
        await new Promise((resolve, reject) => {
          const key = result.transferId;
          const timer = setTimeout(() => {
            settlePending(key, new Error('TRANSFER_TIMEOUT'));
          }, 600000);
          pending.set(key, { resolve, reject, timer });
          const entry = incoming.get(asset.id);
          if (entry?.finished) {
            settlePending(key, entry.finished === true ? null : new Error(entry.finished));
          }
        });
      } catch (error) { fail(error); }
      finally { if (incoming.get(asset.id) === receiving) incoming.delete(asset.id); }
    }
  }
  listen('assets:chunk', (message, ack) => {
    try {
      if (stopped || message.roomId !== roomId || !manifest || !message.transferId ||
          !Number.isSafeInteger(message.offset) || typeof message.data !== 'string') throw new Error('INVALID_CHUNK');
      const entry = [...incoming.values()].find(value =>
        (!value.transferId || value.transferId === message.transferId) && value.offset === message.offset);
      if (!entry || (entry.transferId && entry.transferId !== message.transferId)) throw new Error('UNKNOWN_TRANSFER');
      entry.transferId = message.transferId;
      const binary = atob(message.data);
      const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
      if (!bytes.length || bytes.length > CHUNK || entry.offset + bytes.length > entry.asset.bytes) throw new Error('INVALID_CHUNK');
      entry.chunks.push(bytes); entry.offset += bytes.length;
      ack?.({ ok: true });
    } catch { ack?.({ ok: false }); }
  });
  listen('assets:finished', async message => {
    if (message.roomId !== roomId) return;
    const entry = incoming.get(message.assetId);
    if (!entry || (entry.transferId && entry.transferId !== message.transferId)) return;
    let error;
    try {
      if (entry.offset !== entry.asset.bytes) throw new Error('ASSET_INCOMPLETE');
      const blob = new Blob(entry.chunks, { type: entry.asset.mime });
      if (blob.size !== entry.asset.bytes || await digest(blob) !== entry.asset.sha256) throw new Error('HASH_MISMATCH');
      received.set(entry.asset.id, blob);
      emit();
    } catch (cause) { error = cause.message; }
    if (!settlePending(message.transferId, error ? new Error(error) : null)) {
      entry.finished = error || true;
    }
  });
  listen('assets:failed', message => {
    if (message.roomId !== roomId) return;
    settlePending(message.transferId, new Error(message.code));
    const entry = [...incoming.values()].find(value => value.transferId === message.transferId);
    if (entry) entry.finished = message.code;
  });
  listen('assets:requested', async message => {
    if (!director || stopped || !epoch || message.epoch !== epoch || message.roomId !== roomId ||
        message.revision !== revision) return;
    try {
      const blob = await getSource(message.asset.id);
      if (!(blob instanceof Blob) || blob.size !== message.asset.bytes ||
          await digest(blob) !== message.asset.sha256) throw new Error('ASSET_SOURCE_MISMATCH');
      for (let offset = 0; offset < blob.size; offset += CHUNK) {
        if (stopped || epoch !== message.epoch || revision !== message.revision) return;
        // Shared pacing prevents a perfectly legitimate map from exhausting the
        // director's aggregate per-minute budget when many members download it.
        await paceChunk();
        if (stopped || epoch !== message.epoch || revision !== message.revision) return;
        const bytes = new Uint8Array(await blob.slice(offset, offset + CHUNK).arrayBuffer());
        const transferId = message.transferId;
        const key = transferId + ':' + offset;
        // A resolved Error (not a rejected detached Promise) avoids unhandled
        // rejections if the Socket.IO command fails before its downstream ack.
        let finishAck;
        const acknowledged = new Promise(resolve => { finishAck = resolve; });
        const waiter = { resolve: () => finishAck(null), reject: error => finishAck(error) };
        pending.set(key, waiter);
        waiter.timer = setTimeout(() => {
          settlePending(key, new Error('TRANSFER_TIMEOUT'));
        }, 12000);
        const deadline = waiter.timer;
        try {
          const response = await command('assets:chunk', { epoch, transferId, offset, data: toBase64(bytes) });
          if (!response.pending) throw new Error('INVALID_CHUNK_ACK');
          const outcome = await acknowledged;
          if (outcome) throw outcome;
        } finally {
          clearTimeout(deadline);
          settlePending(key);
        }
      }
      await command('assets:finish', { epoch, transferId: message.transferId });
    } catch (error) { fail(error); }
  });
  listen('assets:chunk:acked', message => {
    if (message.roomId !== roomId) return;
    const key = message.transferId + ':' + message.offset;
    settlePending(key);
  });
  return {
    async publish(source) {
      if (!director || !epoch || stopped) throw new Error('DIRECTOR_NOT_READY');
      const assets = [];
      for (const [id, blob] of Object.entries(source.files)) {
        if (!(blob instanceof Blob)) throw new Error('INVALID_ASSET');
        assets.push({ id, sha256: await digest(blob), mime: blob.type, bytes: blob.size });
      }
      const next = { version: 1, roomId, epoch, revision: revision + 1,
        map: source.map, tokens: source.tokens, assets };
      const result = await command('assets:publish', next);
      revision = result.revision; manifest = next;
      received.clear();
      for (const [id, blob] of Object.entries(source.files)) received.set(id, blob);
      emit();
      return result;
    },
    get epoch() { return epoch; },
    close() {
      stopped = true;
      for (const [event, handler] of listeners) socket.off(event, handler);
      cancelPending(); incoming.clear(); received.clear();
    }
  };
}
