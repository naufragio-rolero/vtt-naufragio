// Shared browser-side media client. The director owns Blob originals; players
// receive only the active public manifest and verified bytes, never hidden assets.
const CHUNK = 8192;
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
  const received = new Map(), incoming = new Map(), pending = new Map(), listeners = [];
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
    for (const item of pending.values()) item.reject(new Error('TRANSFER_INTERRUPTED'));
    pending.clear(); emit();
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
    incoming.clear();
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
      incoming.set(asset.id, { asset, chunks: [], offset: 0, transferId: null });
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
        const entry = incoming.get(asset.id);
        if (entry) entry.transferId = result.transferId;
        // assets:finished may arrive before the request's ack; handled by the
        // shared promise installed before sending the request below.
        await new Promise((resolve, reject) => {
          const key = result.transferId;
          pending.set(key, { resolve, reject });
          const entry = incoming.get(asset.id);
          if (entry?.finished) { pending.delete(key); entry.finished === true ? resolve() : reject(new Error(entry.finished)); }
          setTimeout(() => { if (pending.has(key)) { pending.delete(key); reject(new Error('TRANSFER_TIMEOUT')); } }, 600000);
        });
      } catch (error) { fail(error); }
      finally { incoming.delete(asset.id); }
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
    const waiter = pending.get(message.transferId);
    if (waiter) { pending.delete(message.transferId); error ? waiter.reject(new Error(error)) : waiter.resolve(); }
    else entry.finished = error || true;
  });
  listen('assets:failed', message => {
    if (message.roomId !== roomId) return;
    const waiter = pending.get(message.transferId);
    if (waiter) { pending.delete(message.transferId); waiter.reject(new Error(message.code)); }
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
        const bytes = new Uint8Array(await blob.slice(offset, offset + CHUNK).arrayBuffer());
        const transferId = message.transferId;
        const acknowledged = new Promise((resolve, reject) => {
          const key = transferId + ':' + offset;
          pending.set(key, { resolve, reject });
          setTimeout(() => { if (pending.has(key)) { pending.delete(key); reject(new Error('TRANSFER_TIMEOUT')); } }, 12000);
        });
        try {
          const response = await command('assets:chunk', { epoch, transferId, offset, data: toBase64(bytes) });
          if (!response.pending) throw new Error('INVALID_CHUNK_ACK');
          await acknowledged;
        } catch (error) {
          // If the command itself fails, do not leave a rejected ack promise unobserved.
          pending.get(key)?.resolve();
          pending.delete(key);
          throw error;
        }
      }
      await command('assets:finish', { epoch, transferId: message.transferId });
    } catch (error) { fail(error); }
  });
  listen('assets:chunk:acked', message => {
    if (message.roomId !== roomId) return;
    const key = message.transferId + ':' + message.offset;
    pending.get(key)?.resolve();
    pending.delete(key);
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
      for (const waiter of pending.values()) waiter.reject(new Error('TRANSFER_INTERRUPTED'));
      pending.clear(); incoming.clear(); received.clear();
    }
  };
}
