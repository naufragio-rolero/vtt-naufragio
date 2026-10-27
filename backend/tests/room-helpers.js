import { setup, password } from './auth-helpers.js';

export async function roomFixture(t, env = {}, options = {}) {
  const base = await setup(t, { HANDSHAKE_RATE_LIMIT: '100', ROOM_JOIN_RATE_LIMIT: '100', ...env }, options);
  async function account(username, role) {
    const secret = password();
    const user = await base.auth.createUser(base.token, { username, role, password: secret });
    const session = await base.auth.login({ username, password: secret });
    return { ...session, user, secret };
  }
  const director = await account('director-room-test', 'director');
  const member = await account('member-room-test', 'user');
  const created = base.app.rooms.create(director.token, { name: 'Synthetic party' });
  function admit(session, room = created, permissions) {
    base.app.rooms.invite(director.token, room.room.id, { userId: session.user.id, ...(permissions ? { permissions } : {}) });
    return base.app.rooms.join(session.token, { code: room.admissionCode.code });
  }
  return { ...base, director, member, created, rooms: base.app.rooms, account, admit };
}
