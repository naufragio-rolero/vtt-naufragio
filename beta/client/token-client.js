import { snapshot, tokenText, checkpointText, claimText, position } from '../shared/token-state.js';

const encoder = new TextEncoder();
const clone = value => structuredClone(value);
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
export async function stateDigest(value) {
  const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))]
    .map(n => n.toString(16).padStart(2, '0')).join('');
  const state = snapshot(value);
  const entries = await Promise.all(state.tokens.map(async token => ({ id: token.id, tokenVersion: token.tokenVersion, digest: await digest(tokenText(token)) })));
  return digest(checkpointText(state.stateId, state.revision, entries));
}

// Isolated protocol client; not loaded by the published board. The director store
// must resolve save() only after its durable transaction has committed.
export function createTokenClient(socket, { roomId, director = false, store, initialTokens,
  acceptMove = () => true, onChange = () => {} } = {}) {
  let view = null;
  let epoch = null;
  let claimedEpoch = null;
  let ready = false;
  let record;
  let lastError = null;
  let failed = false;
  let acquired = false;
  let queue = Promise.resolve();
  const assignmentVersions = new Map();
  const listeners = [];
  const update = () => onChange({ ready, epoch, snapshot: view && clone(view), error: lastError });
  const releaseStore = () => { if (acquired) { store.release?.(); acquired = false; } };
  const command = async (event, body) => {
    const result = await socket.timeout(3000).emitWithAck(event, { version: 1, roomId, ...body });
    if (!result.ok) throw new Error(result.error.code);
    return result;
  };
  function on(event, work) {
    const listener = message => {
      queue = queue.then(() => { if (!failed) return work(message); }).catch(error => {
        failed = true;
        lastError = error.message;
        ready = false; epoch = null; claimedEpoch = null;
        socket.disconnect();
        releaseStore();
        update();
      });
    };
    socket.on(event, listener);
    listeners.push([event, listener]);
  }
  async function persist(next) { await store.save(clone(next)); record = next; }
  async function sync() {
    if (!director && socket.connected && ready && epoch) await command('tokens:sync:request', { epoch, eventId: crypto.randomUUID() });
  }
  on('room:authority', async message => {
    if (message.roomId !== roomId || message.version !== 1) return;
    const changed = epoch !== message.epoch;
    ready = message.state === 'active' && (!director || claimedEpoch === message.epoch);
    // Only a successful signed claim establishes authority in this browser.
    epoch = director && !ready ? null : message.epoch;
    update();
    if (changed && ready && !director) await sync();
  });
  on('disconnect', async () => { ready = false; epoch = null; claimedEpoch = null; releaseStore(); update(); });
  on('authority:challenge', async message => {
    if (!director || message.roomId !== roomId) return;
    if (!store) throw new Error('DURABLE_STORE_REQUIRED');
    if (store.acquire) { await store.acquire(); acquired = true; }
    record = await store.load();
    if (!record) {
      if (message.expected || !Array.isArray(initialTokens)) throw new Error('OFFICIAL_STATE_UNAVAILABLE');
      const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const publicJwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
      await persist({ privateKey: await crypto.subtle.exportKey('jwk', keys.privateKey),
        publicKey: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y },
        current: snapshot({ stateId: crypto.randomUUID(), revision: 0, tokens: initialTokens }), staged: null });
    }
    const candidates = [record.current, record.staged].filter(Boolean);
    let selected;
    for (const candidate of candidates) {
      const digest = await stateDigest(candidate);
      if ((!message.expected && candidate.revision === 0) || (message.expected && candidate.stateId === message.expected.stateId &&
          candidate.revision === message.expected.revision && digest === message.expected.digest)) { selected = snapshot(candidate); break; }
    }
    if (!selected) throw new Error('OFFICIAL_STATE_UNAVAILABLE');
    await persist({ ...record, current: selected, staged: null });
    const digest = await stateDigest(selected);
    const privateKey = await crypto.subtle.importKey('jwk', record.privateKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey,
      encoder.encode(claimText(roomId, message.challenge, selected.stateId, selected.revision, digest)));
    const result = await command('authority:claim', { challenge: message.challenge, snapshot: selected,
      publicKey: record.publicKey, signature: b64(signature) });
    assignmentVersions.clear();
    claimedEpoch = result.epoch; epoch = result.epoch; view = selected; ready = true; update();
  });
  on('tokens:snapshot', async message => {
    if (message.roomId !== roomId || message.version !== 1 || message.epoch !== epoch) return;
    const value = snapshot(message.snapshot);
    if (view && value.stateId === view.stateId && value.revision < view.revision) return;
    if (director && (value.revision !== record.current.revision || await stateDigest(value) !== await stateDigest(record.current))) {
      throw new Error('OFFICIAL_STATE_MISMATCH');
    }
    view = value; update();
  });
  on('token:move:requested', async request => {
    if (!director || request.roomId !== roomId || request.epoch !== epoch || !ready) return;
    const token = record.current.tokens.find(token => token.id === request.tokenId);
    if (!token || token.tokenVersion !== request.tokenVersion || !await acceptMove(clone(request), clone(record.current))) {
      await command('token:move:reject', { epoch, eventId: request.eventId, reason: 'DIRECTOR_REJECTED' }); return;
    }
    const next = clone(record.current);
    const moving = next.tokens.find(token => token.id === request.tokenId);
    Object.assign(moving, position(request.position), { tokenVersion: moving.tokenVersion + 1 });
    next.revision++;
    // Journal first: a crash/lost ack can be reconciled against the server's
    // checkpoint using either current or staged, never by guessing a device.
    await persist({ ...record, staged: next });
    const result = await command('token:move:accept', { epoch, eventId: request.eventId,
      revision: next.revision, stateDigest: await stateDigest(next) });
    if (result.status === 'committed') {
      await persist({ ...record, current: next, staged: null });
      view = next;
    } else await persist({ ...record, staged: null });
    update();
  });
  on('token:move:committed', async message => {
    if (message.roomId !== roomId || message.version !== 1 || message.epoch !== epoch) return;
    if (!view || message.revision > view.revision + 1) { await sync(); return; }
    if (message.revision <= view.revision) return;
    const next = clone(view);
    const token = next.tokens.find(token => token.id === message.tokenId);
    if (!token || message.tokenVersion !== token.tokenVersion + 1) { await sync(); return; }
    Object.assign(token, position(message.position), { tokenVersion: message.tokenVersion });
    next.revision = message.revision;
    if (director) throw new Error('UNEXPECTED_DIRECTOR_COMMIT');
    view = snapshot(next); update();
  });
  on('tokens:sync:requested', async request => {
    if (!director || request.roomId !== roomId || request.epoch !== epoch || !ready) return;
    await command('tokens:sync:provide', { epoch, syncId: request.syncId, snapshot: record.current });
  });
  return {
    get state() { return { ready, epoch, snapshot: view && clone(view), error: lastError }; },
    settled() { return queue; },
    async move(tokenId, point, eventId = crypto.randomUUID()) {
      if (!ready || !view) throw new Error('DIRECTOR_NOT_READY');
      const token = view.tokens.find(token => token.id === tokenId);
      if (!token) throw new Error('TOKEN_NOT_FOUND');
      return command('token:move:request', { epoch, eventId, baseRevision: view.revision,
        tokenId, tokenVersion: token.tokenVersion, position: position(point) });
    },
    async assign(tokenId, userIds) {
      const result = await command('token:assign', { epoch, eventId: crypto.randomUUID(), tokenId,
        assignmentVersion: assignmentVersions.get(tokenId) ?? 0, userIds });
      assignmentVersions.set(tokenId, result.assignmentVersion);
      return result;
    },
    sync,
    close() {
      failed = true;
      for (const [event, listener] of listeners) socket.off(event, listener);
      socket.disconnect();
      void queue.finally(releaseStore);
    }
  };
}
