import { io } from 'socket.io-client';
import { randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { origin } from './helpers.js';
import { stateDigest } from '../client/token-client.js';
import { claimText } from '../shared/token-state.js';

export const token = () => ({ id: randomUUID(), tokenVersion: 0, x: 0, y: 0 });
export function localAuthority(tokens = [token()]) {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { keys, current: { stateId: randomUUID(), revision: 0, tokens } };
}
export function rawSocket(t, f, account, roomId = f.created.room.id, extra = {}) {
  const socket = io(f.url, { autoConnect: false, reconnection: false, forceNew: true, timeout: 2000,
    transports: ['websocket'], extraHeaders: { Origin: origin }, auth: { token: account.token, roomId }, ...extra });
  socket.roomId = roomId;
  socket.on('authority:challenge', message => { socket.challenge = message; });
  t.after(() => socket.disconnect());
  return socket;
}
export async function connect(socket) {
  const ready = once(socket, 'connect', { signal: AbortSignal.timeout(4000) });
  socket.connect(); await ready;
  return socket;
}
export const send = (socket, event, body = {}) => socket.timeout(3000).emitWithAck(event, { version: 1, roomId: socket.roomId, ...body });
export async function waitFor(predicate, message = 'condition', milliseconds = 5000) {
  const until = Date.now() + milliseconds;
  while (!predicate()) {
    if (Date.now() > until) throw new Error(`Timed out: ${message}`);
    await delay(10);
  }
}
export async function prove(socket, record = localAuthority()) {
  await waitFor(() => socket.challenge, 'authority challenge');
  const digest = await stateDigest(record.current);
  const result = await send(socket, 'authority:claim', { challenge: socket.challenge.challenge, snapshot: record.current,
    publicKey: record.keys.publicKey.export({ format: 'jwk' }),
    signature: sign('sha256', Buffer.from(claimText(socket.roomId, socket.challenge.challenge,
      record.current.stateId, record.current.revision, digest)), { key: record.keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') });
  return { result, record, epoch: result.epoch };
}
export function memoryStore(initial = null) {
  let value = structuredClone(initial);
  return { async load() { return structuredClone(value); }, async save(next) { value = structuredClone(next); } };
}
export const moveInput = (owner, item, revision = owner.record.current.revision) => ({ epoch: owner.epoch, eventId: randomUUID(),
  baseRevision: revision, tokenId: item.id, tokenVersion: item.tokenVersion, position: { x: 4, y: 7 } });
export async function accept(socket, owner, input) {
  const next = structuredClone(owner.record.current);
  const item = next.tokens.find(item => item.id === input.tokenId);
  Object.assign(item, input.position, { tokenVersion: item.tokenVersion + 1 });
  next.revision++;
  const result = await send(socket, 'token:move:accept', { epoch: owner.epoch, eventId: input.eventId,
    revision: next.revision, stateDigest: await stateDigest(next) });
  if (result.status === 'committed') owner.record.current = next;
  return result;
}
export const assign = (socket, owner, tokenId, userIds, assignmentVersion = 0) => send(socket, 'token:assign', {
  epoch: owner.epoch, eventId: randomUUID(), tokenId, userIds, assignmentVersion });
