import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { loadConfig } from '../src/config.js';
import { roomFixture } from './room-helpers.js';
import { rawSocket, connect } from './token-helpers.js';

test('beta session bounds remain finite and guest maximum stays four hours', () => {
  const config = loadConfig({ SESSION_TTL_SECONDS: '16200', GUEST_SESSION_TTL_SECONDS: '14400' });
  assert.equal(config.sessionTtlSeconds, 16200);
  assert.equal(config.guestSessionTtlSeconds, 14400);
  for (const value of ['0', '59', '16201', '-1', 'Infinity', '1e4', '']) {
    assert.throws(() => loadConfig({ SESSION_TTL_SECONDS: value }));
  }
  assert.throws(() => loadConfig({ GUEST_SESSION_TTL_SECONDS: '14401' }));
});

test('accelerated clock: QR expiry leaves admitted guests and director valid after three hours; reconnect, revoke and expiry still work', async t => {
  let now = Date.now();
  const f = await roomFixture(t, { SESSION_TTL_SECONDS: '16200', GUEST_SESSION_TTL_SECONDS: '14400' }, { clock: () => now });
  const g = f.app.guests, roomId = f.created.room.id;
  const qr = g.open(f.director.token, roomId, { expiresInSeconds: 60 }).admission;
  const guests = [];
  for (let i = 0; i < 3; i++) {
    const request = g.request({ admissionToken: qr.token, displayName: 'Long guest ' + i });
    const row = g.list(f.director.token, roomId).requests.find(r => r.displayName === 'Long guest ' + i);
    g.decide(f.director.token, roomId, row.id, { approve: true });
    guests.push(g.claim({ requestToken: request.requestToken }));
  }
  const sockets = await Promise.all(guests.map(guest => connect(rawSocket(t, f, guest))));
  now += 10800 * 1000;
  g.cleanup();
  assert.throws(() => g.request({ admissionToken: qr.token, displayName: 'Too late' }), /ADMISSION_EXPIRED/);
  assert.equal(f.auth.session(f.director.token).id, f.director.user.id);
  for (const guest of guests) assert.equal(f.rooms.access(guest.token, roomId).room.id, roomId);
  sockets[0].disconnect();
  await connect(sockets[0]);
  assert.ok(sockets.every(s => s.connected));
  const disconnected = once(sockets[1], 'disconnect', { signal: AbortSignal.timeout(3000) });
  f.rooms.revokeMember(f.director.token, roomId, guests[1].user.id);
  await disconnected;
  assert.throws(() => f.auth.session(guests[1].token), /UNAUTHENTICATED/);
  now += 3600 * 1000;
  for (const guest of guests) assert.throws(() => f.auth.session(guest.token), /UNAUTHENTICATED/);
  assert.equal(f.auth.session(f.director.token).id, f.director.user.id);
  now += 1800 * 1000;
  assert.throws(() => f.auth.session(f.director.token), /UNAUTHENTICATED/);
});
